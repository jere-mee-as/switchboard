package ing.jere.switchboard

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * /remind from #feed. The page keeps its own list and checks it on every resume; this side makes sure a
 * reminder still fires (as a notification) when Switchboard is closed or the phone restarted.
 */
object Reminders {

    const val CHANNEL = "reminders"
    const val EXTRA_ID = "sb_remind_id"
    private const val ACTION_FIRE = "ing.jere.switchboard.REMIND"
    private const val PREFS = "reminders"

    fun channel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_HIGH))
        }
    }

    fun schedule(ctx: Context, id: String, at: Long, text: String): Boolean {
        if (at <= System.currentTimeMillis()) return false
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(id, JSONObject().put("at", at).put("text", text).toString())
            .apply()
        return set(ctx, id, at, text)
    }

    fun cancel(ctx: Context, id: String): Boolean {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(id).apply()
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return false
        am.cancel(pending(ctx, id, ""))
        return true
    }

    /** After a restart or an update: put every future reminder back; drop the ones that passed. */
    fun rescheduleAll(ctx: Context) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val edit = prefs.edit()
        for ((id, raw) in prefs.all) {
            val o = try {
                JSONObject(raw as? String ?: continue)
            } catch (e: Exception) {
                edit.remove(id)
                continue
            }
            val at = o.optLong("at")
            if (at <= now) edit.remove(id) else set(ctx, id, at, o.optString("text"))
        }
        edit.apply()
    }

    fun forget(ctx: Context, id: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(id).apply()
    }

    private fun pending(ctx: Context, id: String, text: String): PendingIntent {
        val intent = Intent(ctx, ReminderReceiver::class.java)
            .setAction(ACTION_FIRE)
            .setData(android.net.Uri.fromParts("sbremind", id, null))
            .putExtra(EXTRA_ID, id)
            .putExtra("text", text)
        return PendingIntent.getBroadcast(ctx, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun set(ctx: Context, id: String, at: Long, text: String): Boolean {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return false
        val pi = pending(ctx, id, text)
        val exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
        return try {
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            true
        } catch (e: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            true
        }
    }

    /** Posts the reminder; tapping it opens Switchboard, which tells the page. */
    fun notify(ctx: Context, id: String, text: String) {
        channel(ctx)
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val open = Intent(ctx, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_ID, id)
        val pi = PendingIntent.getActivity(ctx, id.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(text.ifBlank { "Reminder" })
            .setContentText("Reminder from #feed")
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(id.hashCode(), n)
        } catch (e: SecurityException) {
            // Notifications switched off for Switchboard.
        }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(Reminders.EXTRA_ID) ?: return
        Reminders.forget(context, id)
        Reminders.notify(context, id, intent.getStringExtra("text").orEmpty())
        MainActivity.current?.get()?.emit("remind", MainActivity.jsString(id))
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> Reminders.rescheduleAll(context)
        }
    }
}
