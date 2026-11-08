package red.sjer.facet.host

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import uniffi.TaskNotesCore.FacetEngineException
import uniffi.TaskNotesCore.ObsidianSessionEffect

class FacetOccurrenceMaintenanceTest {
    private val day = "2026-10-24"
    private fun target(path: String, revision: String = "a".repeat(64)) = FacetWindowTarget(path, revision, day, "2026-10-20", "2026-11-20")
    private open class Port : FacetOccurrencePort {
        val events = mutableListOf<String>()
        val commands = mutableListOf<JsonObject>()
        var available = true
        var version = 1uL
        var onWrite: () -> Unit = {}
        override suspend fun ready(profileId: String) = available
        override suspend fun rolling(profileId: String, day: String, after: JsonObject?, version: ULong?): FacetRollingPage {
            events += "read:${after?.getValue("lastPath")?.jsonPrimitive?.content ?: "first"}"
            require(version == null || version == this.version) { "A write invalidated discovery before its tail was read." }
            val revision = (if (this.version == 1uL) "a" else "b").repeat(64)
            return if (after == null) FacetRollingPage(profileId, this.version, day,
                listOf(FacetWindowTarget("Tasks/a.md", revision, day, day, day)), emptyList(), buildJsonObject { put("lastPath", "Tasks/a.md") })
            else FacetRollingPage(profileId, this.version, day,
                listOf(FacetWindowTarget("Tasks/z.md", revision, day, day, day)), emptyList(), null)
        }
        override suspend fun failures(profileId: String, after: JsonObject?, version: ULong?) = FacetGenerationPage(this.version, emptyList(), null)
        override suspend fun successors(profileId: String, mutationId: String) = emptyList<FacetGenerationItem>()
        override suspend fun automatic(profileId: String, command: JsonObject, active: () -> Boolean) {
            events += "write:${command.getValue("parentPath").jsonPrimitive.content}"
            commands += command; version++; onWrite()
        }
        override suspend fun recoverAutomatic(profileId: String, active: () -> Boolean) { events += "recover:$profileId" }
    }
    @Test fun discoversEveryPageBeforeFirstWriteAndUsesCoreAutomaticOrigin() = runBlocking {
        val port = Port(); val coordinator = FacetOccurrenceMaintenance(port)
        coordinator.request("offscreen-vault")
        coordinator.drain(setOf("offscreen-vault"), day)
        assertEquals(listOf("recover:offscreen-vault", "read:first", "read:Tasks/a.md", "write:Tasks/a.md", "write:Tasks/z.md"), port.events)
        assertEquals(2, port.commands.size)
        for (command in port.commands) {
            assertEquals("automatic_maintenance", command.getValue("origin").jsonPrimitive.content)
            assertEquals(day, command.getValue("referenceDate").jsonPrimitive.content)
            assertEquals("a".repeat(64), command.getValue("expectedParentRevision").jsonPrimitive.content)
        }
        assertFalse(coordinator.hasPending())
        assertEquals("user", target("Tasks/a.md").command(automatic = false).getValue("origin").jsonPrimitive.content)
    }
    @Test fun staleDiscoveryRestartsFromFirstPageWithoutPublishingOldTargets() = runBlocking {
        var conflicted = false
        val port = object : Port() {
            override suspend fun rolling(profileId: String, day: String, after: JsonObject?, version: ULong?): FacetRollingPage {
                if (after != null && !conflicted) { conflicted = true; this.version++; throw FacetEngineException.Conflict() }
                return super.rolling(profileId, day, after, version)
            }
        }
        val coordinator = FacetOccurrenceMaintenance(port)
        coordinator.request("p"); coordinator.drain(setOf("p"), day)
        assertEquals(2, port.events.count { it == "read:first" })
        assertEquals(2, port.commands.size)
        assertTrue(port.commands.all { it.getValue("expectedParentRevision") == JsonPrimitive("b".repeat(64)) })
        assertFalse(coordinator.hasPending())
    }
    @Test fun externalGenerationDuringDrainSurvivesAndSameParentCanBeRevisited() = runBlocking {
        val port = Port(); val coordinator = FacetOccurrenceMaintenance(port)
        coordinator.request("p"); coordinator.request("p")
        var changed = false
        port.onWrite = { if (!changed) { changed = true; coordinator.request("p") } }
        coordinator.drain(setOf("p"), day)
        assertTrue(coordinator.hasPending())
        coordinator.drain(setOf("p"), day)
        assertFalse(coordinator.hasPending())
        assertEquals(4, port.commands.size)
        assertEquals(2, port.commands.count { it.getValue("parentPath") == JsonPrimitive("Tasks/a.md") })
    }
    @Test fun configurationAndInitialSyncReadinessNeverGrantDefaultsConsent() = runBlocking {
        val port = Port().apply { available = false }
        val coordinator = FacetOccurrenceMaintenance(port)
        coordinator.request("p"); coordinator.drain(setOf("p"), day)
        assertTrue(port.events.isEmpty()); assertTrue(port.commands.isEmpty())
        port.available = true
        coordinator.request("p"); coordinator.drain(setOf("p"), day)
        assertEquals(2, port.commands.size)
    }
    @Test fun ownerCancellationLeavesUnpublishedTailQueued() = runBlocking {
        val port = Port(); var active = true
        val coordinator = FacetOccurrenceMaintenance(port)
        port.onWrite = { active = false }
        coordinator.request("p")
        try { coordinator.drain(setOf("p"), day, active = { active }); fail("A retired owner cannot write the tail") }
        catch (_: CancellationException) { }
        assertEquals(1, port.commands.size)
        assertTrue(coordinator.hasPending())
    }
    @Test fun completedAccountSwitchDuringReadinessOrDiscoveryCannotAdmitOldProfileWrites() = runBlocking {
        for (switchDuringReadiness in listOf(true, false)) {
            var active = true
            val port = object : Port() {
                override suspend fun ready(profileId: String): Boolean {
                    if (switchDuringReadiness) active = false
                    return super.ready(profileId)
                }
                override suspend fun rolling(profileId: String, day: String, after: JsonObject?, version: ULong?): FacetRollingPage {
                    val page = super.rolling(profileId, day, after, version)
                    if (page.nextCursor == null) active = false
                    return page
                }
            }
            val coordinator = FacetOccurrenceMaintenance(port); coordinator.request("previous-account-profile")
            try { coordinator.drain(setOf("previous-account-profile"), day, active = { active }); fail("A completed switch must revoke this pass") }
            catch (_: CancellationException) { }
            assertTrue(port.commands.isEmpty())
            assertTrue(coordinator.hasPending())
        }
    }
    @Test fun durableAdmissionFenceKeepsInternalContractErrorsLoud() {
        ensureOccurrenceOwner { true }
        assertThrows(CancellationException::class.java) { ensureOccurrenceOwner { false } }
        assertTrue(expectedOccurrenceFailure(IOException("Provider unavailable")))
        assertFalse(expectedOccurrenceFailure(FacetEngineException.HostContract("Invalid recovery identity")))
        assertFalse(expectedOccurrenceFailure(IllegalArgumentException("Unknown schema field")))
    }
    @Test fun mainOwnerInvalidationIsVisibleAtIoAdmissionAndNeverRevivesAfterResume() = runBlocking {
        val ownership = FacetOccurrenceOwnership()
        val original = ownership.capture()
        val ready = CompletableDeferred<Unit>(); val continueAdmission = CompletableDeferred<Unit>()
        val admitted = async(Dispatchers.IO) {
            ready.complete(Unit); continueAdmission.await()
            assertFalse(original())
            assertThrows(CancellationException::class.java) { ensureOccurrenceOwner(original) }
        }
        ready.await()
        ownership.revoke() // pause or account transition on Main
        val resumed = ownership.capture()
        continueAdmission.complete(Unit); admitted.await()
        assertTrue(resumed()); assertFalse(original())
        ownership.revoke()
        assertFalse(original()); assertFalse(resumed())
        assertTrue(ownership.capture()())
    }
    @Test fun interruptedAutomaticRecoveryMustFinishBeforeNewPlanningAndRetainsDirtyRequest() = runBlocking {
        var fails = true
        val port = object : Port() {
            override suspend fun recoverAutomatic(profileId: String, active: () -> Boolean) {
                super.recoverAutomatic(profileId, active)
                if (fails) throw IOException("Recovery unavailable")
            }
        }
        val coordinator = FacetOccurrenceMaintenance(port); coordinator.request("p")
        try { coordinator.drain(setOf("p"), day); fail("Recovery must not be skipped") } catch (_: IOException) { }
        assertTrue(port.commands.isEmpty()); assertTrue(coordinator.hasPending())
        fails = false
        coordinator.drain(setOf("p"), day)
        assertEquals(2, port.commands.size)
    }
    @Test fun uncertainProfileKeepsItsExactRequestWithoutStarvingLaterProfiles() = runBlocking {
        val failure = IOException("First profile recovery unavailable")
        val port = object : Port() {
            override suspend fun recoverAutomatic(profileId: String, active: () -> Boolean) {
                super.recoverAutomatic(profileId, active)
                if (profileId == "blocked") throw failure
            }
        }
        val coordinator = FacetOccurrenceMaintenance(port)
        coordinator.request("blocked"); coordinator.request("later")
        try { coordinator.drain(setOf("blocked", "later"), day); fail("The blocked profile must remain visible") }
        catch (observed: IOException) { assertSame(failure, observed) }
        assertEquals(2, port.commands.size)
        assertTrue(coordinator.hasPending(setOf("blocked")))
        assertFalse(coordinator.hasPending(setOf("later")))
        assertTrue("recover:later" in port.events)
    }
    @Test fun attentionReadsAreSideEffectFreeAndPreserveActionableUnrepairableState() = runBlocking {
        val item = FacetGenerationItem.Progression("occprogress:" + "a".repeat(64), "Tasks/parent.md", FacetGenerationState.FAILED,
            FacetGenerationFailure("conflict", "Parent changed"), "Tasks/child.md", day, true, true)
        val port = object : Port() {
            override suspend fun failures(profileId: String, after: JsonObject?, version: ULong?) = FacetGenerationPage(1uL,
                listOf(FacetGenerationAttention("completed-primary", item, FacetGenerationAction.Unrepairable("child_state_changed"))), null)
        }
        val first = port.generationAttention("p"); val restarted = port.generationAttention("p")
        assertEquals(first, restarted)
        assertEquals("completed-primary", first.single().primaryMutationId)
        assertTrue(first.single().action is FacetGenerationAction.Unrepairable)
        assertTrue(port.commands.isEmpty()); assertTrue(port.events.isEmpty())
    }
    @Test fun typedRemoteIngestAndInitialReadyTriggerMaintenanceButOwnUploadDoesNot() {
        assertTrue(ObsidianSessionEffect.DownloadedPayload(1uL, "owned-payload", 0uL, true, null).triggersOccurrenceMaintenance())
        assertTrue(ObsidianSessionEffect.Ready(1uL).triggersOccurrenceMaintenance())
        assertFalse(ObsidianSessionEffect.Uploaded("own-window", "a".repeat(64)).triggersOccurrenceMaintenance())
    }
}
