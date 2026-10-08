package red.sjer.facet.host

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

data class FacetReminderDelivery(val scheduled: Int, val beyondBudget: ULong, val problemCount: ULong)
class FacetReminderPermissionException : Exception("Allow notifications in Android settings before enabling reminders.")

/** Opt-in, inexact OS alarms. Rust owns every firing instant and occurrence. */
object FacetReminders {
    private const val PREFERENCES = "facet.reminders"
    private const val CHANNEL = "facet.task-reminders"
    private const val BUDGET = 64
    private val mutex = Mutex()
    private val generation = AtomicLong()
    @Volatile private var deliveryFenced = false

    fun permissionGranted(context: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()

    fun enabled(context: Context): Boolean = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getBoolean("enabled", false)

    /** Immediate account/lifecycle fence; call before awaiting cancellation. */
    fun fence() { beginFence() }
    private fun beginFence(): Long { deliveryFenced = true; return generation.incrementAndGet() }

    suspend fun setEnabled(context: Context, enabled: Boolean) = withContext(Dispatchers.IO) {
        if (enabled && !permissionGranted(context)) throw FacetReminderPermissionException()
        fence()
        mutex.withLock {
            check(context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putBoolean("enabled", enabled).commit())
            if (!enabled) replace(context, emptyList(), records(context))
        }
    }

    suspend fun cancelProfiles(context: Context, profileIds: Set<String>) = withContext(Dispatchers.IO) {
        val attempt = beginFence()
        mutex.withLock {
            val previous = records(context)
            replace(context, previous.filter { it.profileId !in profileIds }, previous)
            if (attempt == generation.get()) deliveryFenced = false
        }
    }

    suspend fun refresh(context: Context, engine: FacetEngineRunner, profileIds: Set<String>): FacetReminderDelivery = withContext(Dispatchers.IO) {
        val attempt = generation.get()
        mutex.withLock {
            if (!enabled(context) || !permissionGranted(context)) return@withLock FacetReminderDelivery(0, 0uL, 0uL)
            val old = records(context)
            val retained = old.filter { it.profileId !in profileIds && Instant.parse(it.fireAt).isAfter(Instant.now()) }
            val capacity = (BUDGET - retained.size).coerceAtLeast(0)
            val now = Instant.now()
            val window = FacetReminderWindow(now.toString(), ZoneId.systemDefault().id, now.toString(), now.plusSeconds(30L * 86400).toString())
            val plans = profileIds.sorted().map { profile ->
                FacetReminderPlanReader.read(profile, window, capacity) { engine.features(profile, it) }
            }
            val selected = plans.flatMap { it.rows }.sortedWith(compareBy({ Instant.parse(it.fireAt) }, { it.notificationId })).take(capacity)
            if (attempt != generation.get()) throw CancellationException("This reminder refresh was superseded by an account change.")
            replace(context, retained + selected, old, attempt)
            deliveryFenced = false
            FacetReminderDelivery(selected.size, plans.sumOf { it.totalCount } - selected.size.toULong(), plans.sumOf { it.problemCount })
        }
    }

    private fun replace(context: Context, desired: List<FacetReminderRow>, previous: List<FacetReminderRow>, attempt: Long? = null) {
        require(desired.size <= BUDGET && desired.map { it.notificationId }.distinct().size == desired.size)
        val notifications = context.getSystemService(NotificationManager::class.java)
        val alarms = context.getSystemService(AlarmManager::class.java)
        notifications.createNotificationChannel(NotificationChannel(CHANNEL, "Task reminders", NotificationManager.IMPORTANCE_DEFAULT))
        val json = JsonArray(desired.map { row -> buildJsonObject {
            put("id", row.notificationId); put("profile", row.profileId); put("path", row.taskPath); put("title", row.title)
            put("at", row.fireAt); put("occurrence", row.occurrenceDate?.let(::JsonPrimitive) ?: JsonNull)
            put("description", row.description?.let(::JsonPrimitive) ?: JsonNull)
        } })
        check(context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString("records", json.toString()).commit())
        previous.filter { old -> desired.none { it.notificationId == old.notificationId } }.forEach {
            alarms.cancel(pending(context, it)); notifications.cancel(it.notificationId, 0)
        }
        desired.forEach {
            if (attempt != null && attempt != generation.get()) throw CancellationException("This reminder refresh was superseded.")
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, Instant.parse(it.fireAt).toEpochMilli(), pending(context, it))
        }
    }

    private fun pending(context: Context, row: FacetReminderRow): PendingIntent = PendingIntent.getBroadcast(
        context, 0, Intent(context, FacetReminderReceiver::class.java).setData(Uri.parse("facet-reminder://${row.notificationId.removePrefix("facet:")}"))
            .putExtra("id", row.notificationId).putExtra("at", row.fireAt), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun records(context: Context): List<FacetReminderRow> {
        val text = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString("records", null) ?: return emptyList()
        val array = Json.parseToJsonElement(text).jsonArray
        require(array.size <= BUDGET)
        return array.map { raw ->
            val value = raw.jsonObject
            require(value.keys == setOf("id", "profile", "path", "title", "at", "occurrence", "description"))
            val id = value.getValue("id").jsonPrimitive.content
            require(Regex("facet:[0-9a-f]{64}").matches(id))
            FacetReminderRow(id, value.getValue("profile").jsonPrimitive.content, value.getValue("path").jsonPrimitive.content,
                value.getValue("title").jsonPrimitive.content, value.getValue("at").jsonPrimitive.content,
                value.getValue("occurrence").jsonPrimitive.contentOrNull, value.getValue("description").jsonPrimitive.contentOrNull)
        }
    }

    internal fun deliver(context: Context, intent: Intent) {
        if (deliveryFenced || !enabled(context) || !permissionGranted(context)) return
        val row = records(context).singleOrNull { it.notificationId == intent.getStringExtra("id") && it.fireAt == intent.getStringExtra("at") } ?: return
        val identities = context.getSharedPreferences("facet.remote-vaults", Context.MODE_PRIVATE)
        identities.getString(row.profileId, null)?.let { raw ->
            val owner = Json.parseToJsonElement(raw).jsonObject.getValue("owner").jsonPrimitive.content
            if (owner != identities.getString("activeOwner", null)) return
        }
        val open = requireNotNull(context.packageManager.getLaunchIntentForPackage(context.packageName))
        open.action = Intent.ACTION_VIEW
        open.data = Uri.Builder().scheme("tasknotes").authority("reminder").appendQueryParameter("profileId", row.profileId)
            .appendQueryParameter("path", row.taskPath).build()
        val action = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_stat_facet).setContentTitle(row.title)
            .setContentText(row.description ?: "Task reminder").setAutoCancel(true).setContentIntent(action).build()
        context.getSystemService(NotificationManager::class.java).notify(row.notificationId, 0, notification)
    }
}

/** Non-exported receiver has no credentials or vault/file capabilities. */
class FacetReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) { FacetReminders.deliver(context, intent) }
}
