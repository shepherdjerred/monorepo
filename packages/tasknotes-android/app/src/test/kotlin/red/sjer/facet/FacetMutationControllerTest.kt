package red.sjer.facet

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import red.sjer.facet.host.PendingFacetMutation
import red.sjer.facet.host.FacetSchema
import red.sjer.facet.host.FacetReceiptContractException
import red.sjer.facet.host.FacetWorkFailure

private fun appliedReceipt(mutationId: String = "decision", applied: Boolean = true) = buildJsonObject {
    put("schemaVersion",1); put("mutationId", mutationId); put("applied",applied)
    put("taskPath","Tasks/a.md"); put("cleanupPending",false); put("paths",JsonArray(listOf(JsonPrimitive("Tasks/a.md"))))
    put("pendingCount",0); put("diagnostics",JsonArray(emptyList()))
}

class FacetMutationControllerTest {
    private val schema = FacetSchema(requireNotNull(javaClass.classLoader?.getResourceAsStream("schema/facet-engine.schema.json")).bufferedReader().use { it.readText() })
    private fun controller(port: Port) = FacetMutationController(port, schema)
    @Test fun authoritativeOrdinaryUndoObservationDoesNotPopCompletionHistory() {
        val state = FacetUndoHistory().reconcile("completion", completion)
        val undo = buildJsonObject { put("kind", "undo"); put("receiptId", "ordinary-create") }
        val observed = state.reconcile("undo-create", undo)
        assertEquals(listOf("completion"), observed.receipts)
        assertTrue("undo-create" in observed.observed)
        assertEquals(observed, observed.reconcile("undo-create", undo))
    }
    private val completion = buildJsonObject { put("kind", "set_completion"); put("path", "Tasks/a.md"); put("expectedRevision", "a".repeat(64)); put("completed", true); put("occurrenceDate", "2026-10-03") }
    private fun pending(command: JsonObject = completion) = PendingFacetMutation("original-vault", buildJsonObject { put("mutationId", "decision"); put("at", "2026-10-03T10:00:00Z"); put("command", command); put("executionContext", buildJsonObject { put("today", "2026-10-03"); put("timezone", "Europe/Paris") }) })
    private class Port : FacetMutationPort {
        val calls = mutableListOf<String>()
        var failure: Exception? = null
        var cleanup: Exception? = null
        var receipt = appliedReceipt()
        var persistenceFailure: Exception? = null
        var afterAdmission: suspend () -> Unit = {}
        override suspend fun execute(profileId: String, command: JsonObject, mutationId: String, admitted: () -> Unit): JsonObject { calls.add("execute:$profileId:$mutationId"); persistenceFailure?.let { throw it }; admitted(); afterAdmission(); failure?.let { throw it }; return receipt }
        override suspend fun retry(mutationId: String): JsonObject { calls.add("retry:$mutationId"); failure?.let { throw it }; return receipt }
        override suspend fun discardObserved(mutationId: String) { calls.add("discard:$mutationId"); cleanup?.let { throw it } }
    }
    @Test fun bulkSelectionRemainsUntilMatchingAppliedReceiptAndFailedReceiptCannotDismissIt() = runTest {
        val reached = CompletableDeferred<Unit>()
        val reply = CompletableDeferred<Unit>()
        val port = Port().apply { afterAdmission = { reached.complete(Unit); reply.await() } }
        val command = buildJsonObject { put("kind", "batch"); put("commands", JsonArray(listOf(completion))) }
        var selection = setOf("Tasks/a.md:2026-10-03")
        val operation = async {
            val result = controller(port).submit("original-vault", command, "decision")
            if (result.profileId == "original-vault" && result.receipt.getValue("applied").jsonPrimitive.boolean) selection = emptySet()
        }
        reached.await()
        assertEquals(setOf("Tasks/a.md:2026-10-03"), selection)
        reply.complete(Unit); operation.await()
        assertTrue(selection.isEmpty())
        selection = setOf("Tasks/a.md:2026-10-03")
        val failed = Port().apply { receipt = appliedReceipt(applied = false) }
        try {
            controller(failed).submit("original-vault", command, "decision")
            selection = emptySet()
            fail("A non-applied response must not dismiss the reviewed selection")
        } catch (_: FacetReceiptContractException) {}
        assertEquals(setOf("Tasks/a.md:2026-10-03"), selection)
    }
    @Test fun savedViewSuspendedAdmissionFailureRetainsExactOwnerViewAndQueryForRecovery() = runTest {
        val query = Json.parseToJsonElement("""{"scope":"all","sort":"title","vendor":{"precise":9007199254740993}}""").jsonObject
        val intent = FacetSavedViewIntent("original-vault", "original-view", query, JsonObject(emptyMap()), "My view", "decision")
        val admitted = CompletableDeferred<Unit>()
        val failure = CompletableDeferred<Unit>()
        var submitted = false
        val port = Port().apply { afterAdmission = { admitted.complete(Unit); failure.await(); throw IOException("Outcome unknown") } }
        val result = async { runCatching { controller(port).submit(intent.profileId, intent.command, intent.mutationId, admitted = { submitted = true }) } }
        admitted.await()
        assertTrue(submitted)
        val restored = FacetSavedViewIntent.restore(intent.saved())
        assertEquals(intent, restored)
        assertEquals(query.toString(), restored.command.getValue("view").jsonObject.getValue("query").toString())
        failure.complete(Unit)
        assertTrue(result.await().exceptionOrNull() is IOException)
        val action = PendingFacetMutation(restored.profileId, buildJsonObject {
            put("mutationId", restored.mutationId); put("at", "2026-10-03T10:00:00Z"); put("command", restored.command)
            put("executionContext", buildJsonObject { put("today", "2026-10-03"); put("timezone", "Europe/Paris") })
        })
        controller(port).resume(action)
        assertEquals(listOf("execute:original-vault:decision", "retry:decision", "discard:decision"), port.calls)
        assertEquals("original-view", action.mutation.getValue("command").jsonObject.getValue("id").jsonPrimitive.content)
    }
    @Test fun admissionDistinguishesEditablePersistenceFailureFromSubmittedExecutionFailure() = runTest {
        var admitted = false
        val before = Port().apply { persistenceFailure = IOException("Cannot persist") }
        try { controller(before).submit("original-vault", completion, "decision", admitted = { admitted = true }); fail() } catch (_: IOException) {}
        assertFalse(admitted)
        val after = Port().apply { failure = IOException("Unknown execution outcome") }
        try { controller(after).submit("original-vault", completion, "decision", admitted = { admitted = true }); fail() } catch (_: IOException) {}
        assertTrue(admitted)
        assertEquals(listOf("execute:original-vault:decision"), after.calls)
    }
    @Test fun resumeRetainsOwnerAndObservesBeforeDiscard() = runTest {
        val port = Port()
        val action = pending()
        val result = controller(port).resume(action) { port.calls.add("observed:${action.profileId}") }
        assertEquals("original-vault", result.profileId)
        assertEquals(listOf("retry:decision", "observed:original-vault", "discard:decision"), port.calls)
        assertEquals("2026-10-03T10:00:00Z", action.mutation.getValue("at").jsonPrimitive.content)
    }
    @Test fun interruptedObservationRetainsActionForRestart() = runTest {
        val port = Port()
        val result = controller(port).resume(pending()) { throw IOException("disk full") }
        assertTrue(result.maintenanceRequired)
        assertTrue(result.observationPending)
        assertEquals(listOf("retry:decision"), port.calls)
    }
    @Test fun cancellationAfterReceiptPreservesAction() = runTest {
        val port = Port()
        try { controller(port).resume(pending()) { throw CancellationException("app stopped") }; fail("Expected cancellation") } catch (_: CancellationException) { }
        assertEquals(listOf("retry:decision"), port.calls)
    }
    @Test fun failedCleanupReportsAppliedAndRetainsMaintenance() = runTest {
        val port = Port().apply { cleanup = IOException("disk full") }
        var observed = false
        val result = controller(port).submit("original-vault", completion, "decision") { observed = true }
        assertTrue(observed); assertTrue(result.maintenanceRequired)
    }
    @Test fun warningsSurviveObservationAndCleanupFailure() = runTest {
        val warning = buildJsonObject { put("code", "template_missing") }
        for (observationFails in listOf(true, false)) {
            val port = Port().apply {
                receipt = JsonObject(receipt + ("diagnostics" to JsonArray(listOf(warning))))
                if (!observationFails) cleanup = IOException("cleanup blocked")
            }
            val action = pending()
            val result = controller(port).resume(action) {
                if (observationFails) throw IOException("reading blocked")
            }
            assertTrue(result.receipt.getValue("applied").jsonPrimitive.boolean)
            assertTrue(result.maintenanceRequired)
            assertEquals(observationFails, result.observationPending)
            assertEquals(listOf("The task was saved without the configured template."), result.warningMessages)
            assertEquals("decision", action.mutationId)
            assertEquals("original-vault", result.profileId)
            assertEquals(if (observationFails) listOf("retry:decision") else listOf("retry:decision", "discard:decision"), port.calls)
        }
    }
    @Test fun malformedReceiptFailsBeforeObservationOrDiscard() = runTest {
        val invalids = listOf(
            JsonObject(appliedReceipt() - "diagnostics"),
            JsonObject(appliedReceipt() + ("diagnostics" to JsonNull)),
            JsonObject(appliedReceipt() + ("diagnostics" to JsonArray(listOf(buildJsonObject { put("code", "unknown") })))),
            JsonObject(appliedReceipt() + ("pendingCount" to JsonPrimitive(-1)))
        )
        for (receipt in invalids) {
            val port = Port().apply { this.receipt = receipt }
            try { controller(port).resume(pending()) { fail("Must not observe corruption") }; fail("Expected strict contract failure") }
            catch (failure: FacetReceiptContractException) {
                assertSame(failure, assertThrows(FacetReceiptContractException::class.java) { FacetWorkFailure.present(failure, false, true) })
                assertNull(FacetWorkFailure.present(failure, false, false))
            }
            assertEquals(listOf("retry:decision"), port.calls)
        }
    }
    @Test fun observationContractFailureRemainsFatal() = runTest {
        val port = Port()
        try { controller(port).resume(pending()) { throw IllegalArgumentException("corrupt projection") }; fail("Expected contract failure") }
        catch (_: IllegalArgumentException) { }
        assertEquals(listOf("retry:decision"), port.calls)
    }
    @Test fun nativeCleanupPendingPreservesPrimaryAppliedOutcome() = runTest {
        val port = Port().apply { receipt = JsonObject(receipt + ("cleanupPending" to JsonPrimitive(true))) }
        val result = controller(port).resume(pending())
        assertTrue(result.maintenanceRequired)
        assertFalse(result.observationPending)
    }
    @Test fun unAppliedOrWrongReceiptNeverObservesOrDiscards() = runTest {
        for (receipt in listOf(appliedReceipt(applied=false), appliedReceipt(mutationId="other"))) {
            val port = Port().apply { this.receipt = receipt }
            try { controller(port).resume(pending()) { fail("Must not observe") }; fail("Expected contract failure") }
            catch (failure: FacetReceiptContractException) {
                assertSame(failure, assertThrows(FacetReceiptContractException::class.java) { FacetWorkFailure.present(failure, true, true) })
                assertNull(FacetWorkFailure.present(failure, true, false))
            }
            assertEquals(listOf("retry:decision"), port.calls)
        }
    }
    @Test fun completionRecoveryCommitsExactlyOneUndoHead() {
        val first = FacetUndoHistory().reconcile("decision", completion)
        val restored = FacetUndoHistory.read(Json.parseToJsonElement(first.document().toString()).jsonObject)
        assertEquals(listOf("decision"), restored.reconcile("decision", completion).receipts)
    }
    @Test fun interruptedUndoAfterCommitNeverPopsFollowingHead() {
        val initial = FacetUndoHistory().reconcile("first", completion).reconcile("second", completion)
        val undo = buildJsonObject { put("kind", "undo"); put("receiptId", "second") }
        val committed = initial.reconcile("undo-second", undo)
        val afterAnotherAction = FacetUndoHistory.read(committed.document()).reconcile("third", completion)
        assertEquals(listOf("first", "third"), afterAnotherAction.reconcile("undo-second", undo).receipts)
    }
    @Test fun observationFailureBeforeCommitCanRetryOriginalUndo() {
        val initial = FacetUndoHistory().reconcile("first", completion).reconcile("second", completion)
        val undo = buildJsonObject { put("kind", "undo"); put("receiptId", "second") }
        val candidate = initial.reconcile("undo-second", undo)
        assertEquals(listOf("first", "second"), initial.receipts)
        assertEquals(candidate, initial.reconcile("undo-second", undo))
    }
    @Test fun staleUndoCannotRemoveAnUnrelatedHead() {
        val state = FacetUndoHistory().reconcile("first", completion).reconcile("second", completion)
        try { state.reconcile("undo-first", buildJsonObject { put("kind", "undo"); put("receiptId", "first") }); fail("Expected head fence") } catch (_: IllegalStateException) { }
        assertEquals(listOf("first", "second"), state.receipts)
    }
    @Test fun nestedCompletionAndResolutionHistoryAreDurable() {
        val batch = buildJsonObject { put("kind", "batch"); put("commands", JsonArray(listOf(completion))) }
        val resolution = buildJsonObject { put("kind", "resolve_conflict") }
        val state = FacetUndoHistory().reconcile("batch", batch).reconcile("resolution", resolution)
        val restored = FacetUndoHistory.read(state.document()).reconcile("resolution", resolution)
        assertEquals(listOf("batch", "resolution"), restored.receipts)
        assertEquals(listOf("resolution"), restored.resolutions)
    }
}
