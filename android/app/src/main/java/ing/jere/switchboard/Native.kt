package ing.jere.switchboard

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.ContentUris
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.ContactsContract
import android.provider.Settings
import android.util.Base64
import android.view.HapticFeedbackConstants
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * window.SBNative, the contract in the comment block at the top of the page's main script
 * (switchboard/index.html, "PHONE BRIDGE"). Every method runs on WebView's JavaBridge thread.
 * Reads return JSON strings (the page JSON.parses any string it gets back) or primitives.
 *
 * WebView matches a call by name AND argument count, so each signature here takes exactly the
 * arguments the page passes. Numbers that can be epoch milliseconds arrive as Double.
 */
class Native(private val act: MainActivity) {

    private val pm: PackageManager get() = act.packageManager
    private fun ui(block: () -> Unit) = act.runOnUiThread { block() }
    private fun granted(p: String) = ContextCompat.checkSelfPermission(act, p) == PackageManager.PERMISSION_GRANTED

    // ---------------------------------------------------------------- apps

    @Volatile
    private var appsCache: String? = null

    fun invalidateApps() {
        appsCache = null
    }

    /** [{key: "pkg/activity", pkg, label, cat, icon}]. icon is served unmasked by IconHandler; the page shapes it. */
    @JavascriptInterface
    fun apps(): String {
        appsCache?.let { return it }
        val out = JSONArray()
        val query = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        for (ri in pm.queryIntentActivities(query, 0)) {
            val ai = ri.activityInfo ?: continue
            if (ai.packageName == act.packageName) continue
            out.put(
                JSONObject()
                    .put("key", "${ai.packageName}/${ai.name}")
                    .put("pkg", ai.packageName)
                    .put("label", ri.loadLabel(pm).toString())
                    .put("cat", category(ai.applicationInfo.category))
                    .put("icon", "/icon/${ai.packageName}/${ai.name}")
            )
        }
        return out.toString().also { appsCache = it }
    }

    private fun category(c: Int): String = when (c) {
        ApplicationInfo.CATEGORY_AUDIO -> "audio"
        ApplicationInfo.CATEGORY_VIDEO -> "video"
        ApplicationInfo.CATEGORY_IMAGE -> "image"
        ApplicationInfo.CATEGORY_SOCIAL -> "social"
        ApplicationInfo.CATEGORY_PRODUCTIVITY -> "productivity"
        ApplicationInfo.CATEGORY_GAME -> "game"
        ApplicationInfo.CATEGORY_NEWS -> "news"
        ApplicationInfo.CATEGORY_MAPS -> "maps"
        else -> "other"
    }

    @JavascriptInterface
    fun launch(key: String): Boolean = act.launch(key)

    @JavascriptInterface
    fun appInfo(pkg: String) {
        act.start(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", pkg, null)))
    }

    @JavascriptInterface
    fun uninstall(pkg: String) {
        act.start(Intent(Intent.ACTION_DELETE, Uri.fromParts("package", pkg, null)))
    }

    // ---------------------------------------------------------------- notifications

    /** About 48 h of history, newest 300 (see [Notifs]). Empty until notification access is on. */
    @JavascriptInterface
    fun notifs(): String = Notifs.json(act)

    @JavascriptInterface
    fun notifOpen(id: String) {
        ui { if (!Notifs.open(act, id)) Notifs.pkgOf(id)?.let { act.launchPackage(it) } }
    }

    @JavascriptInterface
    fun notifDismiss(id: String) {
        Notifs.dismiss(id)
    }

    @JavascriptInterface
    fun dismissAll() {
        Notifs.dismissAll()
    }

    @JavascriptInterface
    fun notifReply(id: String, text: String): Boolean = Notifs.reply(act, id, text)

    @JavascriptInterface
    fun notifAction(id: String, index: Int) {
        Notifs.action(act, id, index)
    }

    // ---------------------------------------------------------------- media

    private fun controller(): MediaController? {
        val msm = act.getSystemService(MediaSessionManager::class.java) ?: return null
        val sessions = msm.getActiveSessions(ComponentName(act, NotifService::class.java))
        return sessions.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING } ?: sessions.firstOrNull()
    }

    /** {pkg, title, artist, playing, art} or null. Needs notification access. */
    @JavascriptInterface
    fun media(): String {
        val mc = try {
            controller()
        } catch (e: Exception) {
            null
        } ?: return "null"
        val meta = mc.metadata ?: return "null"
        val title = meta.getString(MediaMetadata.METADATA_KEY_TITLE) ?: return "null"
        val artist = meta.getString(MediaMetadata.METADATA_KEY_ARTIST)
            ?: meta.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST) ?: ""
        val art = artwork(meta, mc.packageName + "|" + title + "|" + artist)
        return JSONObject()
            .put("pkg", mc.packageName)
            .put("title", title)
            .put("artist", artist)
            .put("playing", mc.playbackState?.state == PlaybackState.STATE_PLAYING)
            .put("art", if (art.isEmpty()) JSONObject.NULL else art)
            .toString()
    }

    @Volatile private var artKey = ""
    @Volatile private var artUrl = ""

    /** Track art as a small JPEG data URL, encoded once per track. */
    private fun artwork(meta: MediaMetadata, key: String): String {
        if (key == artKey) return artUrl
        val url = try {
            val bmp: Bitmap? = meta.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
                ?: meta.getBitmap(MediaMetadata.METADATA_KEY_ART)
                ?: meta.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
            if (bmp == null || bmp.width <= 0 || bmp.height <= 0) {
                ""
            } else {
                val scale = ART_PX.toFloat() / maxOf(bmp.width, bmp.height)
                val small = if (scale < 1f) {
                    Bitmap.createScaledBitmap(bmp, maxOf(1, (bmp.width * scale).toInt()), maxOf(1, (bmp.height * scale).toInt()), true)
                } else {
                    bmp
                }
                val out = ByteArrayOutputStream()
                small.compress(Bitmap.CompressFormat.JPEG, 85, out)
                "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            }
        } catch (e: Exception) {
            ""
        }
        artUrl = url
        artKey = key
        return url
    }

    /** play, pause, toggle, next, prev. */
    @JavascriptInterface
    fun mediaCmd(cmd: String) {
        ui {
            try {
                val mc = controller() ?: return@ui
                val t = mc.transportControls
                when (cmd) {
                    "play" -> t.play()
                    "pause" -> t.pause()
                    "next" -> t.skipToNext()
                    "prev" -> t.skipToPrevious()
                    else -> if (mc.playbackState?.state == PlaybackState.STATE_PLAYING) t.pause() else t.play()
                }
            } catch (e: Exception) {
                // No access, or the session went away.
            }
        }
    }

    // ---------------------------------------------------------------- calendar

    private val eventBegin = HashMap<String, Long>()

    /** [{id, title, start, end, allDay, loc, color}] from 12 h ago to [days] ahead; [] without permission. */
    @JavascriptInterface
    fun events(days: Int): String {
        val list = JSONArray()
        if (!granted(Manifest.permission.READ_CALENDAR)) return list.toString()
        val now = System.currentTimeMillis()
        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon().also {
            ContentUris.appendId(it, now - 12 * HOUR_MS)
            ContentUris.appendId(it, now + days.coerceIn(1, 31) * DAY_MS)
        }.build()
        val columns = arrayOf(
            CalendarContract.Instances.EVENT_ID,
            CalendarContract.Instances.TITLE,
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.END,
            CalendarContract.Instances.ALL_DAY,
            CalendarContract.Instances.EVENT_LOCATION,
            CalendarContract.Instances.DISPLAY_COLOR,
        )
        try {
            act.contentResolver.query(uri, columns, "${CalendarContract.Instances.VISIBLE}=1", null, "${CalendarContract.Instances.BEGIN} ASC")
                ?.use { c ->
                    synchronized(eventBegin) { eventBegin.clear() }
                    while (c.moveToNext() && list.length() < MAX_EVENTS) {
                        val allDay = c.getInt(4) == 1
                        // All-day instances are stored at UTC midnight; the page thinks in local days.
                        val begin = if (allDay) utcDayToLocal(c.getLong(2)) else c.getLong(2)
                        val end = if (allDay) utcDayToLocal(c.getLong(3)) else c.getLong(3)
                        if (end <= now) continue
                        val id = c.getLong(0).toString()
                        synchronized(eventBegin) { eventBegin[id] = c.getLong(2) }
                        val o = JSONObject()
                            .put("id", id)
                            .put("title", c.getString(1) ?: "")
                            .put("start", begin)
                            .put("end", end)
                            .put("allDay", allDay)
                            .put("loc", c.getString(5) ?: "")
                        if (!c.isNull(6)) o.put("color", String.format(Locale.ROOT, "#%06X", c.getInt(6) and 0xFFFFFF))
                        list.put(o)
                    }
                }
        } catch (e: Exception) {
            // Calendar provider missing or failing: report what we have.
        }
        return list.toString()
    }

    private fun utcDayToLocal(ms: Long): Long {
        val u = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { timeInMillis = ms }
        return Calendar.getInstance().apply {
            clear()
            set(u.get(Calendar.YEAR), u.get(Calendar.MONTH), u.get(Calendar.DAY_OF_MONTH))
        }.timeInMillis
    }

    @JavascriptInterface
    fun openEvent(id: String) {
        val eventId = id.toLongOrNull() ?: return
        val intent = Intent(Intent.ACTION_VIEW, ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId))
        synchronized(eventBegin) { eventBegin[id] }?.let { intent.putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, it) }
        if (!act.start(intent)) {
            act.start(Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_CALENDAR))
        }
    }

    /** Opens the calendar app's new-event screen, filled in. */
    @JavascriptInterface
    fun newEvent(title: String, start: Double, end: Double, allDay: Boolean): Boolean {
        val intent = Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, title)
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start.toLong())
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end.toLong())
            .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, allDay)
        return act.start(intent)
    }

    // ---------------------------------------------------------------- people

    /** Starred contacts with a number: [{id, name, phone}]; [] without permission. */
    @JavascriptInterface
    fun contacts(): String {
        val list = JSONArray()
        if (!granted(Manifest.permission.READ_CONTACTS)) return list.toString()
        val seen = HashSet<String>()
        try {
            act.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(COL_CONTACT_ID, COL_DISPLAY_NAME, COL_NUMBER),
                "$COL_STARRED=1",
                null,
                "$COL_DISPLAY_NAME ASC, $COL_SUPER_PRIMARY DESC",
            )?.use { c ->
                while (c.moveToNext()) {
                    val id = c.getLong(0).toString()
                    if (!seen.add(id)) continue
                    list.put(JSONObject().put("id", id).put("name", c.getString(1) ?: "").put("phone", c.getString(2) ?: ""))
                }
            }
        } catch (e: Exception) {
            // Provider failing: report what we have.
        }
        return list.toString()
    }

    @JavascriptInterface
    fun call(number: String) {
        val uri = Uri.fromParts("tel", number, null)
        val direct = granted(Manifest.permission.CALL_PHONE)
        if (!(direct && act.start(Intent(Intent.ACTION_CALL, uri)))) act.start(Intent(Intent.ACTION_DIAL, uri))
    }

    @JavascriptInterface
    fun sms(number: String, body: String) {
        val intent = Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", number, null))
        if (body.isNotEmpty()) intent.putExtra("sms_body", body)
        act.start(intent)
    }

    @JavascriptInterface
    fun openContact(id: String) {
        val cid = id.toLongOrNull() ?: return
        act.start(Intent(Intent.ACTION_VIEW, ContentUris.withAppendedId(ContactsContract.Contacts.CONTENT_URI, cid)))
    }

    /** The phone owner's card from the contacts profile: {name, phone, email}; {} without permission. */
    @JavascriptInterface
    fun profile(): String {
        val out = JSONObject()
        if (!granted(Manifest.permission.READ_CONTACTS)) return out.toString()
        try {
            act.contentResolver.query(ContactsContract.Profile.CONTENT_URI, arrayOf(COL_DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0)?.let { out.put("name", it) }
            }
            val data = Uri.withAppendedPath(ContactsContract.Profile.CONTENT_URI, ContactsContract.Contacts.Data.CONTENT_DIRECTORY)
            act.contentResolver.query(data, arrayOf(COL_MIMETYPE, COL_DATA1), null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    val value = c.getString(1) ?: continue
                    when (c.getString(0)) {
                        ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE -> if (!out.has("phone")) out.put("phone", value)
                        ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE -> if (!out.has("email")) out.put("email", value)
                    }
                }
            }
        } catch (e: Exception) {
            // No profile on this phone.
        }
        return out.toString()
    }

    // ---------------------------------------------------------------- phone state

    /** {pct, charging}. */
    @JavascriptInterface
    fun battery(): String {
        val bm = act.getSystemService(BatteryManager::class.java)
        val pct = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1
        return JSONObject()
            .put("pct", if (pct in 0..100) pct else JSONObject.NULL)
            .put("charging", bm?.isCharging ?: false)
            .toString()
    }

    /** {model, android, free, total} (storage in bytes). */
    @JavascriptInterface
    fun device(): String {
        val maker = Build.MANUFACTURER.replaceFirstChar { it.titlecase(Locale.ROOT) }
        val model = if (Build.MODEL.startsWith(Build.MANUFACTURER, ignoreCase = true)) Build.MODEL else "$maker ${Build.MODEL}"
        val out = JSONObject().put("model", model).put("android", Build.VERSION.RELEASE)
        try {
            val fs = StatFs(Environment.getDataDirectory().path)
            out.put("free", fs.availableBytes).put("total", fs.totalBytes)
        } catch (e: Exception) {
            // Leave storage out.
        }
        return out.toString()
    }

    /** {notif, calendar, contacts, dnd, phone, alarms, isHome}. */
    @JavascriptInterface
    fun perms(): String {
        val nm = act.getSystemService(NotificationManager::class.java)
        val alarms = if (Build.VERSION.SDK_INT >= 31) act.getSystemService(AlarmManager::class.java)?.canScheduleExactAlarms() ?: false else true
        return JSONObject()
            .put("notif", NotificationManagerCompat.getEnabledListenerPackages(act).contains(act.packageName))
            .put("calendar", granted(Manifest.permission.READ_CALENDAR))
            .put("contacts", granted(Manifest.permission.READ_CONTACTS))
            .put("dnd", nm?.isNotificationPolicyAccessGranted ?: false)
            .put("phone", granted(Manifest.permission.CALL_PHONE))
            .put("alarms", alarms)
            .put("isHome", isHome())
            .toString()
    }

    private fun isHome(): Boolean {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        return pm.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName == act.packageName
    }

    /** notif, calendar, contacts, phone, dnd, alarms, home, post. The page re-reads perms() on the next resume / "perms". */
    @JavascriptInterface
    fun askPerm(name: String) {
        when (name.lowercase(Locale.ROOT)) {
            "notif", "notifs", "notifications" -> act.start(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            "calendar" -> act.askPermissions(arrayOf(Manifest.permission.READ_CALENDAR))
            "contacts", "profile" -> act.askPermissions(arrayOf(Manifest.permission.READ_CONTACTS))
            "phone", "call" -> act.askPermissions(arrayOf(Manifest.permission.CALL_PHONE))
            "dnd" -> act.start(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
            "alarms", "alarm" -> if (Build.VERSION.SDK_INT >= 31) {
                act.start(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.fromParts("package", act.packageName, null)))
            }
            "home", "ishome" -> act.requestHome()
            "post" -> if (Build.VERSION.SDK_INT >= 33) act.askPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
            else -> act.start(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", act.packageName, null)))
        }
    }

    @JavascriptInterface
    fun setHome() {
        act.requestHome()
    }

    /** Do Not Disturb on (priority only) / off. False until DND access is allowed. */
    @JavascriptInterface
    fun setDnd(on: Boolean): Boolean {
        val nm = act.getSystemService(NotificationManager::class.java) ?: return false
        if (!nm.isNotificationPolicyAccessGranted) return false
        return try {
            nm.setInterruptionFilter(if (on) NotificationManager.INTERRUPTION_FILTER_PRIORITY else NotificationManager.INTERRUPTION_FILTER_ALL)
            true
        } catch (e: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun torch(on: Boolean): Boolean {
        val cm = act.getSystemService(CameraManager::class.java) ?: return false
        return try {
            val ids = cm.cameraIdList.filter { cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
            val id = ids.firstOrNull {
                cm.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
            } ?: ids.firstOrNull() ?: return false
            cm.setTorchMode(id, on)
            true
        } catch (e: Exception) {
            false
        }
    }

    /** A countdown in the Clock app, started without opening it. */
    @JavascriptInterface
    fun timer(seconds: Int, label: String): Boolean = act.start(
        Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, seconds.coerceIn(1, 86_400))
            .putExtra(AlarmClock.EXTRA_MESSAGE, label)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
    )

    @JavascriptInterface
    fun alarm(hour: Int, minute: Int, label: String): Boolean = act.start(
        Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, hour.coerceIn(0, 23))
            .putExtra(AlarmClock.EXTRA_MINUTES, minute.coerceIn(0, 59))
            .putExtra(AlarmClock.EXTRA_MESSAGE, label)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
    )

    /** Exact alarm that posts a notification and tells the page ("remind"). Survives restarts. */
    @JavascriptInterface
    fun remind(id: String, at: Double, text: String): Boolean {
        if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) {
            act.askPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
        }
        return Reminders.schedule(act, id, at.toLong(), text)
    }

    @JavascriptInterface
    fun cancelRemind(id: String): Boolean = Reminders.cancel(act, id)

    // ---------------------------------------------------------------- out to other apps

    @JavascriptInterface
    fun web(query: String) {
        if (!act.start(Intent(Intent.ACTION_WEB_SEARCH).putExtra("query", query))) {
            act.openExternal(Uri.parse("https://www.google.com/search?q=" + Uri.encode(query)))
        }
    }

    @JavascriptInterface
    fun url(href: String) {
        act.openExternal(Uri.parse(href))
    }

    @JavascriptInterface
    fun maps(query: String) {
        act.openExternal(Uri.parse("geo:0,0?q=" + Uri.encode(query)))
    }

    /** wifi, bluetooth, display, sound, battery, apps, home, notif, dnd, location, data, storage; else main Settings. */
    @JavascriptInterface
    fun settings(panel: String) {
        val action = when (panel.lowercase(Locale.ROOT)) {
            "wifi" -> Settings.ACTION_WIFI_SETTINGS
            "bt", "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
            "display" -> Settings.ACTION_DISPLAY_SETTINGS
            "sound" -> Settings.ACTION_SOUND_SETTINGS
            "battery" -> Intent.ACTION_POWER_USAGE_SUMMARY
            "apps" -> Settings.ACTION_APPLICATION_SETTINGS
            "home", "launcher" -> Settings.ACTION_HOME_SETTINGS
            "notif", "notifications" -> Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS
            "dnd" -> "android.settings.ZEN_MODE_SETTINGS"
            "location" -> Settings.ACTION_LOCATION_SOURCE_SETTINGS
            "data" -> Settings.ACTION_DATA_ROAMING_SETTINGS
            "storage" -> Settings.ACTION_INTERNAL_STORAGE_SETTINGS
            "airplane" -> Settings.ACTION_AIRPLANE_MODE_SETTINGS
            else -> Settings.ACTION_SETTINGS
        }
        if (!act.start(Intent(action))) act.start(Intent(Settings.ACTION_SETTINGS))
    }

    /** Pulls down the notification shade (hidden StatusBarManager API, needs EXPAND_STATUS_BAR). */
    @SuppressLint("WrongConstant")
    @JavascriptInterface
    fun shade() {
        ui {
            try {
                val sbm = act.getSystemService("statusbar")
                Class.forName("android.app.StatusBarManager").getMethod("expandNotificationsPanel").invoke(sbm)
            } catch (t: Throwable) {
                // Not available on this build.
            }
        }
    }

    @JavascriptInterface
    fun copy(text: String): Boolean {
        ui {
            act.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Switchboard", text))
        }
        return true
    }

    /** long, tick; anything else is a key tap. Follows the system haptics setting. */
    @JavascriptInterface
    fun haptic(kind: String) {
        ui {
            act.web.performHapticFeedback(
                when (kind) {
                    "long", "heavy" -> HapticFeedbackConstants.LONG_PRESS
                    "tick" -> HapticFeedbackConstants.CLOCK_TICK
                    else -> HapticFeedbackConstants.VIRTUAL_KEY
                }
            )
        }
    }

    @JavascriptInterface
    fun version(): String = try {
        pm.getPackageInfo(act.packageName, 0).versionName ?: "?"
    } catch (e: Exception) {
        "?"
    }

    private companion object {
        const val HOUR_MS = 3_600_000L
        const val DAY_MS = 86_400_000L
        const val MAX_EVENTS = 60
        const val ART_PX = 240

        // Contacts column names (stable provider API values; spelled out to keep the queries readable).
        const val COL_CONTACT_ID = "contact_id"
        const val COL_DISPLAY_NAME = "display_name"
        const val COL_NUMBER = "data1"
        const val COL_DATA1 = "data1"
        const val COL_MIMETYPE = "mimetype"
        const val COL_STARRED = "starred"
        const val COL_SUPER_PRIMARY = "is_super_primary"
    }
}
