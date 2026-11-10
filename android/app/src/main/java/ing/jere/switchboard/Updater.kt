package ing.jere.switchboard

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Two kinds of update, both from GitHub (jere-mee-as/switchboard):
 *
 *  - The page. The newest index.html on main is fetched into files/live/ and served at /live/index.html.
 *    Most changes are page-only, so they arrive with no install. Safety: the page must call SBNative.ready()
 *    within [READY_MS] of loading, or MainActivity throws the copy away and goes back to the page built into
 *    the APK. A live copy is also dropped whenever the app itself is updated (its versionCode changes).
 *
 *  - The app. The latest release's switchboard.apk is downloaded and handed to Android's installer, which
 *    shows its own confirm screen. This only works when the new APK is signed with the same key as the
 *    installed one (the release key in the SB_KEYSTORE_* secrets).
 *
 * Progress reaches the page as SB.onNative('update', {kind: page|app, state, ...}).
 */
object Updater {
    private const val REPO = "jere-mee-as/switchboard"
    private const val PAGE_URL = "https://raw.githubusercontent.com/$REPO/main/index.html"
    private const val RELEASE_API = "https://api.github.com/repos/$REPO/releases/latest"
    const val READY_MS = 10_000L
    private const val AUTO_EVERY_MS = 3 * 3_600_000L
    private const val ACTION_INSTALLED = "ing.jere.switchboard.INSTALL_STATUS"

    @Volatile private var busy = false
    @Volatile private var lastAuto = 0L

    private fun liveDir(ctx: Context) = File(ctx.filesDir, "live")
    fun liveFile(ctx: Context) = File(liveDir(ctx), "index.html")
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("updater", Context.MODE_PRIVATE)

    private fun versionCode(ctx: Context): Long = try {
        val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode else @Suppress("DEPRECATION") pi.versionCode.toLong()
    } catch (e: Exception) { 0L }

    fun versionName(ctx: Context): String = try {
        ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "0"
    } catch (e: Exception) { "0" }

    /** True when a downloaded page should be loaded instead of the built-in one. */
    fun useLive(ctx: Context): Boolean {
        val f = liveFile(ctx)
        if (!f.exists()) return false
        if (prefs(ctx).getLong("forCode", -1) != versionCode(ctx)) { dropLive(ctx); return false }
        return true
    }

    fun dropLive(ctx: Context) {
        liveDir(ctx).deleteRecursively()
        prefs(ctx).edit().remove("forCode").remove("sha").remove("at").apply()
    }

    fun info(ctx: Context): JSONObject = JSONObject()
        .put("app", versionName(ctx))
        .put("live", liveFile(ctx).exists())
        .put("pageAt", prefs(ctx).getLong("at", 0))
        .put("pageSha", (prefs(ctx).getString("sha", "") ?: "").take(7))

    // ---------------------------------------------------------------- page

    /**
     * Fetches the newest page. If it differs from what is showing, it is saved and [onNew] runs
     * (on a background thread). [quiet] skips the progress events (the automatic check).
     */
    fun checkPage(act: MainActivity, quiet: Boolean, onNew: (() -> Unit)? = null) {
        Thread {
            if (!quiet) emit(act, "page", "checking")
            try {
                val body = get(PAGE_URL)
                val text = String(body, Charsets.UTF_8)
                // Only accept something that is recognisably this page.
                if (body.size < 50_000 || !text.contains("SBNative") || !text.contains("</html>", ignoreCase = true) && !text.contains("</script>")) {
                    if (!quiet) emit(act, "page", "error", "msg" to "GitHub sent back something that isn't the Switchboard page")
                    return@Thread
                }
                val sha = sha(body)
                val showing = if (useLive(act)) prefs(act).getString("sha", "") else sha(builtIn(act))
                if (sha == showing) {
                    if (!quiet) emit(act, "page", "current")
                    return@Thread
                }
                val dir = liveDir(act).apply { mkdirs() }
                val tmp = File(dir, "index.next.html")
                tmp.writeBytes(body)
                if (!tmp.renameTo(liveFile(act))) { liveFile(act).writeBytes(body); tmp.delete() }
                prefs(act).edit().putLong("forCode", versionCode(act)).putString("sha", sha).putLong("at", System.currentTimeMillis()).apply()
                if (!quiet) emit(act, "page", "ready", "sha" to sha.take(7))
                onNew?.invoke()
            } catch (e: Exception) {
                if (!quiet) emit(act, "page", "error", "msg" to (e.message ?: "No connection"))
            }
        }.start()
    }

    /** At most every few hours, on resume: fetch a newer page quietly; MainActivity applies it next time you come home. */
    fun autoCheck(act: MainActivity, onNew: () -> Unit) {
        val now = System.currentTimeMillis()
        if (now - lastAuto < AUTO_EVERY_MS) return
        lastAuto = now
        checkPage(act, quiet = true, onNew = onNew)
    }

    private fun builtIn(ctx: Context): ByteArray = try {
        ctx.assets.open("www/index.html").use { it.readBytes() }
    } catch (e: Exception) { ByteArray(0) }

    // ---------------------------------------------------------------- app

    /** Looks up the latest release. Emits available (with version and notes) or current. */
    fun checkApp(act: MainActivity) {
        Thread {
            emit(act, "app", "checking")
            try {
                val rel = JSONObject(String(get(RELEASE_API, "application/vnd.github+json"), Charsets.UTF_8))
                val tag = rel.optString("tag_name").removePrefix("v")
                val mine = versionName(act)
                val apk = (0 until (rel.optJSONArray("assets")?.length() ?: 0))
                    .map { rel.getJSONArray("assets").getJSONObject(it) }
                    .firstOrNull { it.optString("name").endsWith(".apk") }
                if (apk == null || newer(tag, mine) <= 0) emit(act, "app", "current", "version" to mine, "latest" to tag)
                else emit(act, "app", "available", "version" to tag, "from" to mine,
                    "size" to apk.optLong("size"), "notes" to rel.optString("body").take(600))
            } catch (e: Exception) {
                emit(act, "app", "error", "msg" to (e.message ?: "No connection"))
            }
        }.start()
    }

    /** Downloads the latest APK and opens Android's installer. */
    fun installApp(act: MainActivity) {
        if (busy) return emit(act, "app", "busy")
        if (Build.VERSION.SDK_INT >= 26 && !act.packageManager.canRequestPackageInstalls()) {
            emit(act, "app", "needs-permission")
            act.start(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${act.packageName}")))
            return
        }
        busy = true
        Thread {
            try {
                val rel = JSONObject(String(get(RELEASE_API, "application/vnd.github+json"), Charsets.UTF_8))
                val assets = rel.getJSONArray("assets")
                val apk = (0 until assets.length()).map { assets.getJSONObject(it) }.first { it.optString("name").endsWith(".apk") }
                val tag = rel.optString("tag_name").removePrefix("v")
                val out = File(act.cacheDir, "update.apk")
                download(apk.getString("browser_download_url"), out) { pct -> emit(act, "app", "downloading", "pct" to pct, "version" to tag) }
                emit(act, "app", "installing", "version" to tag)
                install(act, out)
            } catch (e: Exception) {
                emit(act, "app", "error", "msg" to (e.message ?: "Download failed"))
            } finally {
                busy = false
            }
        }.start()
    }

    private fun install(act: MainActivity, apk: File) {
        val pi = act.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(act.packageName)
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = pi.createSession(params)
        pi.openSession(id).use { s ->
            s.openWrite("switchboard.apk", 0, apk.length()).use { o -> apk.inputStream().use { it.copyTo(o) }; s.fsync(o) }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val status = PendingIntent.getBroadcast(act, id, Intent(act, StatusReceiver::class.java).setAction(ACTION_INSTALLED), flags)
            s.commit(status.intentSender)
        }
    }

    /** Status from the installer: asks you to confirm, or reports why it didn't go through. */
    class StatusReceiver : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val act = MainActivity.current?.get()
            when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    @Suppress("DEPRECATION")
                    val confirm = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                    else intent.getParcelableExtra(Intent.EXTRA_INTENT)
                    if (confirm != null) {
                        if (act != null) act.start(confirm) else ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                    if (act != null) emit(act, "app", "confirm")
                }
                PackageInstaller.STATUS_SUCCESS -> if (act != null) emit(act, "app", "done")
                PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ->
                    if (act != null) emit(act, "app", "error", "code" to "key",
                        "msg" to "This copy of Switchboard was signed with a different key. Uninstall it once and install the new version by hand; after that /update works.")
                PackageInstaller.STATUS_FAILURE_ABORTED -> if (act != null) emit(act, "app", "canceled")
                else -> if (act != null) emit(act, "app", "error",
                    "msg" to (intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "The installer stopped"))
            }
        }
    }

    // ---------------------------------------------------------------- helpers

    /** -1, 0 or 1: is version [a] older, the same or newer than [b] ("0.10.1" vs "0.9.3"). */
    fun newer(a: String, b: String): Int {
        val x = a.split('.', '-').map { it.toIntOrNull() ?: 0 }
        val y = b.split('.', '-').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(x.size, y.size)) {
            val d = (x.getOrElse(i) { 0 }).compareTo(y.getOrElse(i) { 0 })
            if (d != 0) return d
        }
        return 0
    }

    private fun open(url: String, accept: String?): HttpURLConnection {
        var u = URL(url)
        repeat(5) {
            val c = (u.openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000; readTimeout = 30_000; instanceFollowRedirects = false
                setRequestProperty("User-Agent", "Switchboard")
                setRequestProperty("Cache-Control", "no-cache")
                if (accept != null) setRequestProperty("Accept", accept)
            }
            val code = c.responseCode
            if (code in 300..399) { u = URL(u, c.getHeaderField("Location")); c.disconnect(); return@repeat }
            if (code != 200) { c.disconnect(); throw Exception("GitHub answered $code") }
            return c
        }
        throw Exception("Too many redirects")
    }

    private fun get(url: String, accept: String? = null): ByteArray {
        val c = open(url, accept)
        return try { c.inputStream.use { it.readBytes() } } finally { c.disconnect() }
    }

    private fun download(url: String, out: File, progress: (Int) -> Unit) {
        val c = open(url, "application/octet-stream")
        try {
            val total = c.contentLengthLong
            var done = 0L; var last = -1
            out.outputStream().use { o ->
                c.inputStream.use { i ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = i.read(buf); if (n < 0) break
                        o.write(buf, 0, n); done += n
                        val pct = if (total > 0) (done * 100 / total).toInt() else -1
                        if (pct != last && (pct - last >= 5 || pct == 100)) { last = pct; progress(pct) }
                    }
                }
            }
        } finally { c.disconnect() }
    }

    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    private fun emit(act: MainActivity, kind: String, state: String, vararg kv: Pair<String, Any?>) {
        val o = JSONObject().put("kind", kind).put("state", state)
        for ((k, v) in kv) o.put(k, v)
        act.emit("update", MainActivity.jsString(o.toString()))
    }
}
