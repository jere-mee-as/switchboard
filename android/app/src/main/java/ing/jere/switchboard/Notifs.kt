package ing.jere.switchboard

import android.app.Notification
import android.app.RemoteInput
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Notification access. Feeds [Notifs] (the history behind Messages and Activity) and is the component
 * that lets Native read media sessions.
 */
class NotifService : NotificationListenerService() {

    override fun onListenerConnected() {
        Notifs.service = this
        Notifs.connected(this, try { activeNotifications } catch (e: Exception) { null } ?: emptyArray())
    }

    override fun onListenerDisconnected() {
        if (Notifs.service === this) Notifs.service = null
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn != null) Notifs.posted(this, sbn)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        if (sbn != null) Notifs.removed(sbn.key)
    }
}

/**
 * About 48 hours of notifications (newest 300), one entry per message for chat apps, kept on disk so the
 * history survives a restart. "live" = still in the shade. The user's own messages are skipped.
 * Shape per entry: {id, pkg, kind: msg|call|email|other, title, text, person, convo, group, time, live,
 * canReply, actions:[title]}.
 */
object Notifs {

    private data class Entry(
        val id: String, val key: String, val pkg: String, val kind: String, val title: String, val text: String,
        val person: String, val convo: String, val group: Boolean, val time: Long, val canReply: Boolean,
        val actions: List<String>,
    )

    private const val KEEP_MS = 48 * 3_600_000L
    private const val KEEP_N = 300
    private const val FILE = "notifs.json"

    private val lock = Any()
    private val entries = ArrayList<Entry>()          // oldest first
    private val live = HashSet<String>()              // StatusBarNotification keys in the shade
    private val latest = HashMap<String, Notification>()
    private var loaded = false

    @Volatile
    var service: NotificationListenerService? = null

    /** Set by MainActivity while it is alive; called on the listener's thread. */
    @Volatile
    var onChange: (() -> Unit)? = null

    private val saver = Executors.newSingleThreadScheduledExecutor()
    @Volatile private var savePending = false

    // ---------------------------------------------------------------- listener side

    fun connected(ctx: Context, active: Array<StatusBarNotification>) {
        load(ctx)
        synchronized(lock) {
            live.clear()
            latest.clear()
        }
        active.forEach { add(ctx, it) }
        changed(ctx)
    }

    fun posted(ctx: Context, sbn: StatusBarNotification) {
        load(ctx)
        if (add(ctx, sbn)) changed(ctx)
    }

    fun removed(key: String) {
        val had = synchronized(lock) {
            latest.remove(key)
            live.remove(key)
        }
        if (had) onChange?.invoke()
    }

    /** Records [sbn]. Returns true if anything the page sees changed. */
    private fun add(ctx: Context, sbn: StatusBarNotification): Boolean {
        val found = entriesOf(ctx, sbn)
        if (found.isEmpty()) return false
        synchronized(lock) {
            live.add(sbn.key)
            latest[sbn.key] = sbn.notification
            for (e in found) {
                val i = entries.indexOfFirst { it.id == e.id }
                if (i >= 0) entries[i] = e else entries.add(e)
            }
            entries.sortBy { it.time }
            trim()
        }
        return true
    }

    private fun trim() {
        val cutoff = System.currentTimeMillis() - KEEP_MS
        entries.removeAll { it.time < cutoff }
        while (entries.size > KEEP_N) entries.removeAt(0)
    }

    private fun entriesOf(ctx: Context, sbn: StatusBarNotification): List<Entry> {
        val n = sbn.notification ?: return emptyList()
        val pkg = sbn.packageName
        if (pkg == ctx.packageName || pkg == "android") return emptyList()
        val flags = n.flags
        if (sbn.isOngoing || (flags and Notification.FLAG_GROUP_SUMMARY) != 0 || (flags and Notification.FLAG_FOREGROUND_SERVICE) != 0) {
            return emptyList()
        }
        val cat = n.category
        if (cat == Notification.CATEGORY_PROGRESS || cat == Notification.CATEGORY_SERVICE ||
            cat == Notification.CATEGORY_TRANSPORT || cat == Notification.CATEGORY_SYSTEM
        ) {
            return emptyList()
        }

        val ex = n.extras
        val title = ex?.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty().trim()
        val text = (ex?.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex?.getCharSequence(Notification.EXTRA_TEXT))
            ?.toString().orEmpty().trim()
        val canReply = replyAction(n) != null
        val actions = plainActions(n).mapNotNull { it.title?.toString()?.takeIf { t -> t.isNotBlank() } }

        // Chat apps: one entry per incoming message.
        val style = try {
            NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n)
        } catch (e: Exception) {
            null
        }
        if (style != null && style.messages.isNotEmpty()) {
            val me = style.user.name?.toString()
            val group = style.isGroupConversation
            val convoTitle = style.conversationTitle?.toString()?.takeIf { it.isNotBlank() }
            return style.messages.mapNotNull { m ->
                val sender = m.person?.name?.toString()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                if (me != null && sender == me) return@mapNotNull null
                val body = m.text?.toString()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                val convo = convoTitle ?: if (group && title.isNotEmpty()) title else sender
                val time = if (m.timestamp > 0) m.timestamp else sbn.postTime
                Entry(idOf(pkg, convo, time, body), sbn.key, pkg, "msg", convo, body, sender, convo, group, time, canReply, actions)
            }
        }

        if (title.isEmpty() && text.isEmpty()) return emptyList()
        val kind = when (cat) {
            Notification.CATEGORY_CALL, "missed_call" -> "call"
            Notification.CATEGORY_EMAIL -> "email"
            Notification.CATEGORY_MESSAGE -> "msg"
            else -> "other"
        }
        val person = when (kind) {
            "call" -> if (title.contains("missed", ignoreCase = true) && text.isNotEmpty()) text else title
            "msg" -> title
            else -> ""
        }
        val convo = if (kind == "msg" || kind == "call") person else ""
        // Updates to the same notification with the same words are one entry; new words are a new one.
        return listOf(Entry(idOf(pkg, title, 0L, text), sbn.key, pkg, kind, title, text, person, convo, false, sbn.postTime, canReply, actions))
    }

    private fun idOf(pkg: String, a: String, t: Long, b: String): String =
        Integer.toHexString(pkg.hashCode()) + "-" + java.lang.Long.toString(t, 36) + "-" +
            Integer.toHexString(a.hashCode()) + Integer.toHexString(b.hashCode())

    private fun replyAction(n: Notification): Notification.Action? =
        n.actions?.firstOrNull { a -> a.remoteInputs?.any { it.allowFreeFormInput } == true }

    /** Actions the page lists as buttons: everything except the reply action, in order. */
    private fun plainActions(n: Notification): List<Notification.Action> =
        n.actions?.filter { a -> a.remoteInputs?.any { it.allowFreeFormInput } != true }.orEmpty()

    // ---------------------------------------------------------------- page side

    fun json(ctx: Context): String {
        load(ctx)
        val arr = JSONArray()
        synchronized(lock) {
            trim()
            for (e in entries) {
                arr.put(
                    JSONObject()
                        .put("id", e.id).put("pkg", e.pkg).put("kind", e.kind)
                        .put("title", e.title).put("text", e.text)
                        .put("person", e.person).put("convo", e.convo).put("group", e.group)
                        .put("time", e.time).put("live", live.contains(e.key))
                        .put("canReply", e.canReply && live.contains(e.key))
                        .put("actions", JSONArray(if (live.contains(e.key)) e.actions else emptyList<String>()))
                )
            }
        }
        return arr.toString()
    }

    fun pkgOf(id: String): String? = synchronized(lock) { entries.firstOrNull { it.id == id }?.pkg }

    private fun keyOf(id: String): String? = synchronized(lock) { entries.firstOrNull { it.id == id }?.key }

    private fun notifOf(id: String): Pair<String, Notification>? = synchronized(lock) {
        val key = entries.firstOrNull { it.id == id }?.key ?: return@synchronized null
        val n = latest[key] ?: return@synchronized null
        key to n
    }

    /** Fires the notification's own tap action. False if it is gone from the shade. */
    fun open(ctx: Context, id: String): Boolean {
        val (key, n) = notifOf(id) ?: return false
        val pi = n.contentIntent ?: return false
        return try {
            pi.send()
            if ((n.flags and Notification.FLAG_AUTO_CANCEL) != 0) service?.cancelNotification(key)
            true
        } catch (e: Exception) {
            false
        }
    }

    fun dismiss(id: String) {
        val key = keyOf(id) ?: return
        try {
            service?.cancelNotification(key)
        } catch (e: Exception) {
            // Listener unbound; the next connect re-syncs.
        }
        removed(key)
    }

    fun dismissAll() {
        try {
            service?.cancelAllNotifications()
        } catch (e: Exception) {
            // Listener unbound.
        }
    }

    /** Sends [text] through the app's own reply action. False if there is none or it failed. */
    fun reply(ctx: Context, id: String, text: String): Boolean {
        val (_, n) = notifOf(id) ?: return false
        val action = replyAction(n) ?: return false
        val inputs = action.remoteInputs ?: return false
        return try {
            val intent = Intent()
            val results = Bundle()
            inputs.forEach { results.putCharSequence(it.resultKey, text) }
            RemoteInput.addResultsToIntent(inputs, intent, results)
            action.actionIntent.send(ctx, 0, intent)
            true
        } catch (e: Exception) {
            false
        }
    }

    /** Fires button [index] of the page's actions list (the reply action is not in it). */
    fun action(ctx: Context, id: String, index: Int) {
        val (_, n) = notifOf(id) ?: return
        val a = plainActions(n).getOrNull(index) ?: return
        try {
            a.actionIntent?.send()
        } catch (e: Exception) {
            // Cancelled by the app.
        }
    }

    // ---------------------------------------------------------------- disk

    private fun changed(ctx: Context) {
        onChange?.invoke()
        scheduleSave(ctx.applicationContext)
    }

    private fun scheduleSave(app: Context) {
        if (savePending) return
        savePending = true
        saver.schedule(Runnable {
            savePending = false
            save(app)
        }, 2, TimeUnit.SECONDS)
    }

    private fun save(ctx: Context) {
        val arr = JSONArray()
        synchronized(lock) {
            for (e in entries) {
                arr.put(
                    JSONObject().put("id", e.id).put("key", e.key).put("pkg", e.pkg).put("kind", e.kind)
                        .put("title", e.title).put("text", e.text).put("person", e.person).put("convo", e.convo)
                        .put("group", e.group).put("time", e.time).put("canReply", e.canReply)
                        .put("actions", JSONArray(e.actions))
                )
            }
        }
        try {
            val f = File(ctx.filesDir, FILE)
            val tmp = File(ctx.filesDir, "$FILE.tmp")
            tmp.writeText(arr.toString())
            if (!tmp.renameTo(f)) {
                f.delete()
                tmp.renameTo(f)
            }
        } catch (e: Exception) {
            // History is a convenience; never crash over it.
        }
    }

    private fun load(ctx: Context) {
        synchronized(lock) {
            if (loaded) return
            loaded = true
            try {
                val f = File(ctx.applicationContext.filesDir, FILE)
                if (!f.exists()) return
                val arr = JSONArray(f.readText())
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    val acts = o.optJSONArray("actions")
                    entries.add(
                        Entry(
                            o.getString("id"), o.optString("key"), o.getString("pkg"), o.optString("kind", "other"),
                            o.optString("title"), o.optString("text"), o.optString("person"), o.optString("convo"),
                            o.optBoolean("group"), o.optLong("time"), o.optBoolean("canReply"),
                            List(acts?.length() ?: 0) { j -> acts!!.optString(j) },
                        )
                    )
                }
                entries.sortBy { it.time }
                trim()
            } catch (e: Exception) {
                entries.clear()
            }
        }
    }
}
