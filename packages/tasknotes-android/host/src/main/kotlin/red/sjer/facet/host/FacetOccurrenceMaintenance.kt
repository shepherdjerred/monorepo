package red.sjer.facet.host

import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import uniffi.TaskNotesCore.FacetEngineException

data class FacetGenerationPage(val version: ULong, val items: List<FacetGenerationAttention>, val nextCursor: JsonObject?)
interface FacetOccurrencePort {
    suspend fun ready(profileId: String): Boolean
    suspend fun rolling(profileId: String, day: String, after: JsonObject?, version: ULong?): FacetRollingPage
    suspend fun failures(profileId: String, after: JsonObject?, version: ULong?): FacetGenerationPage
    suspend fun successors(profileId: String, mutationId: String): List<FacetGenerationItem>
    suspend fun automatic(profileId: String, command: JsonObject, active: () -> Boolean = { true })
    suspend fun recoverAutomatic(profileId: String, active: () -> Boolean = { true })
}

internal class NativeFacetOccurrencePort(private val engine: FacetEngineRunner, private val schema: FacetSchema) : FacetOccurrencePort {
    private val recovery = FacetAutomaticRecovery(schema, object : FacetAutomaticRecoveryBoundary {
        override suspend fun retry(action: PendingFacetMutation, admitted: () -> Unit) { engine.retryMutation(action.mutationId, admitted) }
        override suspend fun receipt(action: PendingFacetMutation): JsonObject = engine.features(action.profileId, buildJsonObject {
            put("kind", "mutation_receipt"); put("mutationId", action.mutationId)
        })
        override suspend fun retire(action: PendingFacetMutation, admitted: () -> Unit) { engine.retireRejectedMutation(action.mutationId, admitted) }
        override suspend fun observe(action: PendingFacetMutation) {
            successors(action.profileId, action.mutationId)
            engine.discardObservedMutation(action.mutationId)
        }
    })
    override suspend fun ready(profileId: String): Boolean {
        val discovery = engine.features(profileId, buildJsonObject { put("kind", "discovery") })
        return discovery.getValue("configurationAvailable").jsonPrimitive.boolean && discovery.getValue("initialSyncComplete").jsonPrimitive.boolean
    }
    override suspend fun rolling(profileId: String, day: String, after: JsonObject?, version: ULong?): FacetRollingPage =
        FacetOccurrences.rolling(schema, engine.features(profileId, FacetOccurrences.request("rolling_maintenance_plan", day, after, version)), profileId, day)
    override suspend fun failures(profileId: String, after: JsonObject?, version: ULong?): FacetGenerationPage {
        val page = engine.features(profileId, FacetOccurrences.request("occurrence_generation_failures", after = after, version = version))
        return FacetGenerationPage(page.getValue("version").jsonPrimitive.content.toULong(), FacetOccurrences.failures(schema, page, profileId), page.getValue("nextCursor").let { if (it == JsonNull) null else it.jsonObject })
    }
    override suspend fun successors(profileId: String, mutationId: String): List<FacetGenerationItem> = FacetOccurrences.successors(schema,
        engine.features(profileId, buildJsonObject { put("kind", "occurrence_successors"); put("mutationId", mutationId) }), mutationId)
    override suspend fun automatic(profileId: String, command: JsonObject, active: () -> Boolean) {
        ensureOccurrenceOwner(active)
        val id = UUID.randomUUID().toString()
        engine.execute(profileId, command, id, admitted = { ensureOccurrenceOwner(active) })
        ensureOccurrenceOwner(active)
        // Read and validate the separate generation outcome before retiring the applied primary envelope.
        successors(profileId, id)
        engine.discardObservedMutation(id)
    }
    override suspend fun recoverAutomatic(profileId: String, active: () -> Boolean) {
        // Capture every retained envelope before writes; the durable ID/clock/revision stay unchanged on retry.
        val retained = mutableListOf<PendingFacetMutation>(); var after: String? = null
        do {
            val page = engine.pendingMutations(profileId, after)
            retained += page.filter { isAutomaticOccurrenceCommand(it.mutation.getValue("command").jsonObject) }
            if (page.size < 128) break
            val next = page.last().mutationId; require(after == null || next > after)
            after = next
        } while (true)
        for (action in retained) {
            recovery.recover(action, active)
        }
    }
}

/** One serial writer, coalesced generations, no date/parent success cache and no inferred version watermark. */
class FacetOccurrenceMaintenance(private val port: FacetOccurrencePort) {
    private val serial = Mutex()
    private val dirty = linkedMapOf<String, Long>()
    private var generation = 0L
    @Synchronized fun request(profileId: String) { dirty[profileId] = ++generation }
    @Synchronized fun hasPending(): Boolean = dirty.isNotEmpty()
    @Synchronized fun hasPending(eligible: Set<String>): Boolean = dirty.keys.any { it in eligible }
    @Synchronized private fun captured(eligible: Set<String>) = dirty.filterKeys { it in eligible }.toList()
    @Synchronized private fun complete(profileId: String, captured: Long) { if (dirty[profileId] == captured) dirty.remove(profileId) }

    suspend fun drain(eligible: Set<String>, day: String = LocalDate.now().toString(), active: () -> Boolean = { true }): List<FacetWindowProblem> = serial.withLock {
        LocalDate.parse(day)
        val problems = mutableListOf<FacetWindowProblem>()
        var firstFailure: Exception? = null
        // A busy remote stream cannot monopolize the native owner. New generations remain queued.
        for ((profile, captured) in captured(eligible)) {
            try {
                currentCoroutineContext().ensureActive()
                ensureOccurrenceOwner(active)
                val ready = port.ready(profile)
                ensureOccurrenceOwner(active)
                if (!ready) { complete(profile, captured); continue }
                port.recoverAutomatic(profile, active)
                val plan = port.windowPlan(profile, day)
                ensureOccurrenceOwner(active)
                problems += plan.second
                for (target in plan.first) {
                    currentCoroutineContext().ensureActive()
                    ensureOccurrenceOwner(active)
                    // The captured parent revision and reference day are immutable inside the durable envelope.
                    port.automatic(profile, target.command(automatic = true), active)
                }
                ensureOccurrenceOwner(active)
                complete(profile, captured)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                if (!expectedOccurrenceFailure(failure)) throw failure
                val first = firstFailure
                if (first == null) firstFailure = failure else if (first !== failure) first.addSuppressed(failure)
            }
        }
        firstFailure?.let { throw it }
        problems
    }
}

internal fun ensureOccurrenceOwner(active: () -> Boolean) {
    if (!active()) throw CancellationException("Occurrence maintenance owner stopped.")
}

suspend fun FacetOccurrencePort.windowPlan(profile: String, day: String): Pair<List<FacetWindowTarget>, List<FacetWindowProblem>> = restartOnStale {
    val targets = mutableListOf<FacetWindowTarget>(); val problems = mutableListOf<FacetWindowProblem>()
    var cursor: JsonObject? = null; var version: ULong? = null
    val seen = mutableSetOf<JsonObject>()
    repeat(128) {
        currentCoroutineContext().ensureActive()
        val page = rolling(profile, day, cursor, version)
        require(page.profileId == profile && page.referenceDate == day)
        if (version != null && version != page.version) throw FacetEngineException.Conflict()
        version = page.version
        targets += page.targets; problems += page.problems
        val next = page.nextCursor ?: return@restartOnStale targets.toList() to problems.toList()
        require(seen.add(next)) { "Occurrence discovery cursor did not advance." }
        cursor = next
    }
    throw FacetActionError("This vault exceeds the bounded occurrence discovery pass. Generation remains queued; review vault health.")
}

/** A complete, consistent cached discovery only. Reading attention never repairs or writes. */
suspend fun FacetOccurrencePort.generationAttention(profileId: String): List<FacetGenerationAttention> = restartOnStale {
    val items = mutableListOf<FacetGenerationAttention>(); var cursor: JsonObject? = null; var version: ULong? = null
    val seen = mutableSetOf<JsonObject>()
    repeat(128) {
        currentCoroutineContext().ensureActive()
        val page = failures(profileId, cursor, version)
        if (version != null && version != page.version) throw FacetEngineException.Conflict()
        version = page.version; items += page.items
        val next = page.nextCursor ?: return@restartOnStale items.toList()
        require(seen.add(next)) { "Generation failure cursor did not advance." }
        cursor = next
    }
    throw FacetActionError("Generation attention exceeds the bounded discovery pass. Refresh to retry; no repair was performed.")
}

private suspend fun <T> restartOnStale(read: suspend () -> T): T {
    repeat(3) { attempt ->
        try { return read() }
        catch (failure: FacetEngineException.Conflict) { if (attempt == 2) throw failure }
    }
    error("Unreachable occurrence discovery retry.")
}

/** Expected boundary failures retain queued generation; malformed internal contracts still fail loudly. */
fun expectedOccurrenceFailure(failure: Exception): Boolean = failure is java.io.IOException || when (failure) {
    is FacetEngineException.Configuration, is FacetEngineException.Host, is FacetEngineException.Storage,
    is FacetEngineException.Busy, is FacetEngineException.Conflict, is FacetActionError -> true
    else -> false
}
