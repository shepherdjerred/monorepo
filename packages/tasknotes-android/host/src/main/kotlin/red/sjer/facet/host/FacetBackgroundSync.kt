package red.sjer.facet.host

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.put

/** Native OS scheduling only. Rust retains all cursors, payloads and receipts. */
object FacetBackgroundSync {
    private const val WORK = "facet.private-vault-sync"
    private val ownership = FacetSyncOwnership()

    fun resumeForeground(): Long = ownership.resumeForeground()
    suspend fun awaitBackgroundDrain() { ownership.awaitDrain() }
    internal fun suspendAccountTransition(): Long = ownership.suspendAccountTransition()
    internal fun finishAccountTransition(token: Long) { ownership.finishAccountTransition(token) }
    internal fun revokeAccountAuthorization(context: Context, token: Long) {
        ownership.revokeAccountAuthorization(token)
        WorkManager.getInstance(context.applicationContext).cancelUniqueWork(WORK)
        check(context.getSharedPreferences("facet.background", Context.MODE_PRIVATE).edit().putBoolean("authorized", false).commit())
    }

    /** Register writer cleanup before it starts; new foreground/background writers must await the exact owner drain. */
    fun retireForegroundWriter(cleanup: suspend () -> Unit) {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val draining = scope.launch(start = CoroutineStart.LAZY) {
            try { cleanup() }
            catch (failure: Throwable) { Log.e("FacetLifecycle", "phase=writer-drain; ${FacetFailureDiagnostic.from(failure).chain}"); throw failure }
            finally { scope.cancel() }
        }
        ownership.retainDrain(draining)
        draining.start()
    }

    /** Call after the foreground sessions have stopped and drained. */
    fun pauseForeground(context: Context, generation: Long) {
        val sync = authorized(context)
        val reminders = FacetReminders.enabled(context)
        if (!hasBackgroundWork(sync, reminders)) return
        if (reminders) ownership.authorize()
        if (!ownership.pauseForeground(generation)) return
        val request = PeriodicWorkRequestBuilder<FacetSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(if (sync) NetworkType.CONNECTED else NetworkType.NOT_REQUIRED).build())
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun cancel(context: Context) {
        ownership.disable()
        WorkManager.getInstance(context.applicationContext).cancelUniqueWork(WORK)
    }

    internal fun authorize(context: Context) {
        check(context.getSharedPreferences("facet.background", Context.MODE_PRIVATE).edit().putBoolean("authorized", true).commit())
        ownership.authorize()
    }
    internal fun disableAuthorization(context: Context) {
        cancel(context)
        check(context.getSharedPreferences("facet.background", Context.MODE_PRIVATE).edit().putBoolean("authorized", false).commit())
    }
    internal fun authorized(context: Context): Boolean =
        context.getSharedPreferences("facet.background", Context.MODE_PRIVATE).getBoolean("authorized", false)

    internal fun begin(job: Job): Long? = ownership.begin(job)
    internal fun retain(token: Long, session: ObsidianReplicaSession): Boolean =
        ownership.retain(token, session::requestStop)
    internal fun end(token: Long) { ownership.end(token) }
    internal fun hasBackgroundWork(syncAuthorized: Boolean, remindersEnabled: Boolean): Boolean = syncAuthorized || remindersEnabled
}

/** A process-local lease immediately cancels background effects on app resume. */
internal class FacetSyncOwnership {
    private var foreground = false
    private var generation = 0L
    private var authorized = true
    private var nextSuspension = 0L
    private val accountSuspensions = mutableSetOf<Long>()
    private var job: Job? = null
    private val stopSessions = mutableListOf<() -> Unit>()
    private val retired = mutableSetOf<Job>()

    @Synchronized fun resumeForeground(): Long {
        foreground = true
        generation++
        job?.let { retired.add(it); it.cancel() }
        job = null
        stopSessions.forEach { it() }
        stopSessions.clear()
        return generation
    }
    @Synchronized fun pauseForeground(expectedGeneration: Long? = null): Boolean {
        if (expectedGeneration != null && expectedGeneration != generation) return false
        foreground = false; return authorized
    }
    @Synchronized fun retainDrain(owner: Job) {
        retired.add(owner)
        owner.invokeOnCompletion { synchronized(this) { retired.remove(owner) } }
    }
    @Synchronized fun authorize() { authorized = true }
    @Synchronized fun disable() { resumeForeground(); authorized = false }
    /** Preserve OS scheduling and the foreground lease while authentication is unproven. */
    @Synchronized fun suspendAccountTransition(): Long {
        val token = ++nextSuspension
        accountSuspensions.add(token)
        job?.let { retired.add(it); it.cancel() }
        job = null
        stopSessions.forEach { it() }
        stopSessions.clear()
        return token
    }
    @Synchronized fun finishAccountTransition(token: Long) {
        check(accountSuspensions.remove(token)) { "The account transition suspension is no longer owned." }
    }
    @Synchronized fun revokeAccountAuthorization(token: Long) {
        check(token in accountSuspensions) { "Account authorization may only be revoked by an active transition." }
        authorized = false
    }
    @Synchronized fun begin(owner: Job): Long? {
        if (foreground || !authorized || accountSuspensions.isNotEmpty() || job != null || retired.any { !it.isCompleted }) return null
        generation++
        job = owner
        owner.invokeOnCompletion { synchronized(this) { retired.remove(owner) } }
        return generation
    }
    suspend fun awaitDrain() {
        while (true) {
            val draining = synchronized(this) { retired.filter { !it.isCompleted } }
            if (draining.isEmpty()) return
            draining.forEach { it.join() }
        }
    }
    @Synchronized fun retain(token: Long, stop: () -> Unit): Boolean {
        if (foreground || token != generation || job == null) { stop(); return false }
        stopSessions.add(stop)
        return true
    }
    @Synchronized fun end(token: Long) {
        if (token != generation) return
        stopSessions.forEach { it() }
        job = null
        stopSessions.clear()
    }
}

class FacetSyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val syncAuthorized = FacetBackgroundSync.authorized(applicationContext)
        if (!FacetBackgroundSync.hasBackgroundWork(syncAuthorized, FacetReminders.enabled(applicationContext))) return Result.success()
        val job = currentCoroutineContext()[Job] ?: error("WorkManager must provide a cancellable job.")
        val token = FacetBackgroundSync.begin(job) ?: return Result.success()
        var engine: FacetEngineRunner? = null
        var account: ObsidianAccountHost? = null
        val sessions = mutableListOf<Pair<String, ObsidianReplicaSession>>()
        var cleanupFailure: Throwable? = null
        var runFailure: Throwable? = null
        val result = try {
            withTimeout(45_000) {
                val opened = FacetEngineRunner.open(applicationContext) { candidate -> engine = candidate; true }
                engine = opened
                val signedIn = ObsidianAccountHost(applicationContext, opened)
                account = signedIn
                for (profile in opened.profiles().filter { syncAuthorized && it.kind == "obsidian_sync" && signedIn.belongsToActiveAccount(it.id) }) {
                    currentCoroutineContext().ensureActive()
                    ObsidianReplicaSession.open(opened, signedIn, profile.id, {}, {}, retain = { session ->
                        sessions.add(profile.id to session)
                        FacetBackgroundSync.retain(token, session)
                    })
                }
                while (!settled(opened, sessions)) { currentCoroutineContext().ensureActive(); delay(1000) }
                if (FacetReminders.enabled(applicationContext)) {
                    val authorized = signedIn.eligibleReminderProfileIds()
                    val eligible = opened.profiles().filter { it.kind == "local_folder" || it.id in authorized }.map { it.id }.toSet()
                    FacetReminders.refresh(applicationContext, opened, eligible)
                }
                Result.success()
            }
        } catch (_: TimeoutCancellationException) { Result.retry() }
        catch (cancelled: CancellationException) { runFailure = cancelled; throw cancelled }
        catch (_: FacetNetworkException) { Result.retry() }
        catch (failure: Exception) {
            runFailure = failure
            failed(failure, "run", "Open Facet to check storage and reconnect this vault.")
        }
        finally {
            withContext(NonCancellable) {
                val cleanup = sessions.map { session -> suspend { session.second.requestStop() } } +
                    sessions.map { session -> suspend { session.second.stop() } } +
                    listOf<suspend () -> Unit>({ account?.close() }, { engine?.close() })
                cleanupFailure = cleanupBackgroundResources(cleanup) { FacetBackgroundSync.end(token) }
                if (runFailure is CancellationException) {
                    cleanupFailure?.let { failure ->
                        runFailure.addSuppressed(failure)
                        Log.e("FacetBackgroundSync", "phase=cancelled_cleanup; ${FacetFailureDiagnostic.from(failure).chain}")
                    }
                }
            }
        }
        val cleanup = cleanupFailure ?: return result
        val first = runFailure?.apply { addSuppressed(cleanup) } ?: cleanup
        return failed(first, "cleanup", "Background Sync cleanup could not finish. Open Facet before retrying.")
    }

    private fun failed(failure: Throwable, phase: String, action: String): Result {
        val diagnostic = FacetFailureDiagnostic.from(failure)
        Log.e("FacetBackgroundSync", "phase=$phase; ${diagnostic.chain}")
        return Result.failure(workDataOf(
            "action" to action, "failurePhase" to phase,
            "failureClassification" to diagnostic.classification, "failureChain" to diagnostic.chain,
        ))
    }

    private suspend fun settled(engine: FacetEngineRunner, sessions: List<Pair<String, ObsidianReplicaSession>>): Boolean {
        for ((profile, session) in sessions) {
            if (!session.isIdle() || engine.uploads(profile).isNotEmpty()) return false
            val discovery = engine.features(profile, buildJsonObject { put("kind", "discovery") })
            if (!discovery.getValue("initialSyncComplete").jsonPrimitive.boolean) return false
        }
        return true
    }
}

/** Every close is attempted before lease release; the original failure wins. */
internal suspend fun cleanupBackgroundResources(
    actions: List<suspend () -> Unit>, release: () -> Unit,
): Throwable? {
    var first: Throwable? = null
    for (action in actions) {
        try { action() }
        catch (failure: Throwable) { if (first == null) first = failure else first.addSuppressed(failure) }
    }
    try { release() }
    catch (failure: Throwable) { if (first == null) first = failure else first.addSuppressed(failure) }
    return first
}
