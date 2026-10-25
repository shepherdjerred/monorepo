package red.sjer.facet.host

import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import uniffi.TaskNotesCore.FacetEngineException

class FacetAutomaticRecoveryTest {
    private val schema = FacetSchema(requireNotNull(javaClass.classLoader?.getResourceAsStream("schema/facet-engine.schema.json")).bufferedReader().use { it.readText() })
    private class Journal(private val schema: FacetSchema, val directory: File) : FacetAutomaticRecoveryBoundary {
        val id = UUID.randomUUID().toString()
        val command = FacetOccurrences.windowCommand("Tasks/parent.md", "a".repeat(64), "2026-10-24", automatic = true)
        val original = buildJsonObject {
            put("schemaVersion", 1); put("mutationId", id); put("at", "2026-10-24T23:59:59Z"); put("command", command)
            put("executionContext", buildJsonObject { put("today", "2026-10-24"); put("timezone", "UTC") })
        }
        val file = directory.resolve("$id.json")
        val events = mutableListOf<String>()
        var state = "absent"
        var retryFailure: Exception? = FacetEngineException.Conflict()
        var observeFailure: Exception? = null
        var beforeRetire: () -> Unit = {}
        var proofOverride: JsonObject? = null
        init { file.writeText(buildJsonObject { put("profileId", "p"); put("mutation", original) }.toString()) }
        fun action() = requireNotNull(FacetMutationDrafts(directory).read(id))
        override suspend fun retry(action: PendingFacetMutation, admitted: () -> Unit) {
            events += "retry"
            // Actual persisted host drafts keep the original request when recovery occurs on another day.
            assertEquals(original, FacetMutationDrafts(directory).envelope(action.profileId, action.mutationId, command, "2026-10-25T12:00:00Z"))
            admitted(); retryFailure?.let { throw it }; state = "applied"
        }
        private fun appliedReceipt(applied: Boolean): JsonObject = buildJsonObject {
            put("schemaVersion", 1); put("mutationId", id); put("applied", applied)
            put("taskPath", "Tasks/parent.md"); put("cleanupPending", false); put("paths", JsonArray(emptyList()))
            put("pendingCount", 0); put("diagnostics", JsonArray(emptyList()))
        }
        override suspend fun receipt(action: PendingFacetMutation): JsonObject {
            events += "proof:$state"
            return proofOverride ?: buildJsonObject {
                put("schemaVersion", 1); put("mutationId", id); put("state", state)
                put("receipt", when (state) { "applied" -> appliedReceipt(true); "parked" -> appliedReceipt(false); else -> JsonNull })
            }
        }
        override suspend fun retire(action: PendingFacetMutation, admitted: () -> Unit) {
            events += "retire"
            beforeRetire()
            // The same authoritative retirement policy is rerun at the destructive seam, as EngineRunner does under its mutex.
            assertEquals(FacetDraftRetirement.REJECTED, FacetRetainedActions.retirement(schema, action(), receipt(action)))
            admitted()
            Files.delete(file.toPath())
        }
        override suspend fun observe(action: PendingFacetMutation) {
            events += "observe"
            assertEquals("applied", state)
            observeFailure?.let { throw it }
            Files.delete(file.toPath())
        }
    }
    private suspend fun journal(block: suspend (Journal, FacetAutomaticRecovery) -> Unit) {
        val directory = Files.createTempDirectory("facet-auto-retirement").toFile()
        try { val journal = Journal(schema, directory); block(journal, FacetAutomaticRecovery(schema, journal)) }
        finally { directory.deleteRecursively() }
    }
    @Test fun obsoleteAbsentAndParkedAutomaticDraftsRetireOnlyWithMatchingTerminalProof() = runBlocking {
        for (state in listOf("absent", "parked")) journal { store, recovery ->
            store.state = state
            val original = store.action().mutation
            assertEquals(FacetAutomaticRecoveryOutcome.RETIRED, recovery.recover(store.action()) { true })
            assertEquals("a".repeat(64), original.getValue("command").jsonObject.getValue("expectedParentRevision").jsonPrimitive.content)
            assertFalse(store.file.exists())
            assertTrue(FacetMutationDrafts(store.directory).pending().isEmpty())
            assertEquals(listOf("retry", "proof:$state", "retire", "proof:$state"), store.events)
        }
    }
    @Test fun renamedOrRemovedParentRetiresOnlyAnAuthoritativelyAbsentOrParkedAutomaticEnvelope() = runBlocking {
        for (state in listOf("absent", "parked")) journal { store, recovery ->
            store.state = state; store.retryFailure = FacetEngineException.NotFound()
            assertEquals(FacetAutomaticRecoveryOutcome.RETIRED, recovery.recover(store.action()) { true })
            assertFalse(store.file.exists())
        }
        journal { store, recovery ->
            store.state = "pending"; store.retryFailure = FacetEngineException.NotFound()
            val before = store.file.readBytes()
            try { recovery.recover(store.action()) { true }; fail("A missing parent does not retire pending effects") }
            catch (_: FacetEngineException.NotFound) { }
            assertArrayEquals(before, store.file.readBytes()); assertFalse("retire" in store.events)
        }
        journal { store, recovery ->
            store.state = "applied"; store.retryFailure = FacetEngineException.NotFound()
            assertEquals(FacetAutomaticRecoveryOutcome.OBSERVED, recovery.recover(store.action()) { true })
            assertEquals(listOf("retry", "proof:applied", "observe"), store.events)
            assertFalse("retire" in store.events)
        }
    }
    @Test fun pendingReceiptRetainsExactEnvelopeAndOriginalFailure() = runBlocking {
        journal { store, recovery ->
            store.state = "pending"
            val before = store.file.readBytes(); val failure = requireNotNull(store.retryFailure)
            try { recovery.recover(store.action()) { true }; fail("Pending work cannot be replaced") }
            catch (observed: FacetEngineException.Conflict) { assertSame(failure, observed) }
            assertArrayEquals(before, store.file.readBytes())
            assertEquals(listOf("retry", "proof:pending"), store.events)
        }
    }
    @Test fun uncertainIoAndBusyFailuresNeverRetireEvenAnAbsentOrParkedProbe() = runBlocking {
        for (state in listOf("absent", "parked")) for (failure in listOf(IOException("Uncertain response"), FacetEngineException.Busy())) journal { store, recovery ->
            store.state = state; store.retryFailure = failure
            val before = store.file.readBytes()
            try { recovery.recover(store.action()) { true }; fail("Uncertain work must retain its identity") }
            catch (observed: Exception) { assertSame(failure, observed) }
            assertArrayEquals(before, store.file.readBytes())
            assertFalse("retire" in store.events)
        }
    }
    @Test fun authoritativeAppliedReceiptIsObservedAfterUncertainRetryWithoutNewIdentity() = runBlocking {
        journal { store, recovery ->
            store.state = "applied"; store.retryFailure = IOException("Response lost after commit")
            assertEquals(FacetAutomaticRecoveryOutcome.OBSERVED, recovery.recover(store.action()) { true })
            assertEquals(listOf("retry", "proof:applied", "observe"), store.events)
            assertFalse(store.file.exists())
        }
    }
    @Test fun successfulRetryAndInterruptedObservationReuseOriginalEnvelope() = runBlocking {
        journal { store, recovery ->
            store.retryFailure = null; store.observeFailure = IOException("Observation unavailable")
            val before = store.file.readBytes()
            try { recovery.recover(store.action()) { true }; fail("Unobserved applied work stays retained") } catch (_: IOException) { }
            assertArrayEquals(before, store.file.readBytes())
            store.observeFailure = null
            assertEquals(FacetAutomaticRecoveryOutcome.RESUMED, recovery.recover(store.action()) { true })
            assertEquals(listOf("retry", "observe", "retry", "observe"), store.events)
        }
    }
    @Test fun terminalProofChangingToPendingOrAppliedBeforeRetirementCannotDiscardDraft() = runBlocking {
        for (next in listOf("pending", "applied")) journal { store, recovery ->
            store.beforeRetire = { store.state = next }
            val before = store.file.readBytes(); val first = requireNotNull(store.retryFailure)
            try { recovery.recover(store.action()) { true }; fail("A terminal proof must be rechecked") }
            catch (observed: FacetEngineException.Conflict) { assertSame(first, observed); assertEquals(1, observed.suppressed.size) }
            assertArrayEquals(before, store.file.readBytes())
            assertFalse("observe" in store.events)
        }
    }
    @Test fun ownerRevocationAtRetirementAdmissionKeepsOriginalAbsentDraft() = runBlocking {
        journal { store, recovery ->
            val ownership = FacetOccurrenceOwnership(); val active = ownership.capture()
            store.beforeRetire = ownership::revoke
            val before = store.file.readBytes()
            try { recovery.recover(store.action(), active); fail("Revoked owner cannot retire") } catch (_: CancellationException) { }
            assertArrayEquals(before, store.file.readBytes())
        }
    }
    @Test fun mismatchedReceiptIdentityAndCorruptProofFailLoudlyWithoutRetirement() = runBlocking {
        for (extra in listOf(false, true)) journal { store, recovery ->
            store.proofOverride = buildJsonObject {
                put("schemaVersion", 1); put("mutationId", if (extra) store.id else "another-mutation"); put("state", "absent"); put("receipt", JsonNull)
                if (extra) put("unrecognized", true)
            }
            val before = store.file.readBytes()
            try { recovery.recover(store.action()) { true }; fail("Corrupt proof is not terminal evidence") } catch (_: IllegalArgumentException) { }
            assertArrayEquals(before, store.file.readBytes())
            assertFalse("retire" in store.events)
        }
    }
    @Test fun terminalRetirementAllowsFreshRevisionDiscoveryAndLaterProfileProgress() = runBlocking {
        journal { store, recovery ->
            val writes = mutableListOf<Pair<String, JsonObject>>()
            val port = object : FacetOccurrencePort {
                override suspend fun ready(profileId: String) = true
                override suspend fun recoverAutomatic(profileId: String, active: () -> Boolean) {
                    if (profileId == "p") recovery.recover(store.action(), active)
                }
                override suspend fun rolling(profileId: String, day: String, after: JsonObject?, version: ULong?) = FacetRollingPage(profileId, 2uL, day,
                    listOf(FacetWindowTarget("Tasks/parent.md", "b".repeat(64), day, day, day)), emptyList(), null)
                override suspend fun automatic(profileId: String, command: JsonObject, active: () -> Boolean) { ensureOccurrenceOwner(active); writes += profileId to command }
                override suspend fun failures(profileId: String, after: JsonObject?, version: ULong?) = FacetGenerationPage(2uL, emptyList(), null)
                override suspend fun successors(profileId: String, mutationId: String) = emptyList<FacetGenerationItem>()
            }
            val coordinator = FacetOccurrenceMaintenance(port)
            coordinator.request("p"); coordinator.request("later")
            coordinator.drain(setOf("p", "later"), "2026-10-25")
            assertEquals(listOf("p", "later"), writes.map { it.first })
            assertTrue(writes.all { it.second.getValue("expectedParentRevision") == JsonPrimitive("b".repeat(64)) })
            assertEquals("2026-10-24", store.original.getValue("command").jsonObject.getValue("referenceDate").jsonPrimitive.content)
            assertFalse(coordinator.hasPending()); assertFalse(store.file.exists())
        }
    }
}
