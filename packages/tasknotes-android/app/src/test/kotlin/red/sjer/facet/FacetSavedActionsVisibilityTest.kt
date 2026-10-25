package red.sjer.facet

import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import red.sjer.facet.host.FacetOccurrenceOwnership
import red.sjer.facet.host.FacetOccurrences
import red.sjer.facet.host.PendingFacetMutation

class FacetSavedActionsVisibilityTest {
    private fun retained() = PendingFacetMutation("offscreen-owner", buildJsonObject {
        put("schemaVersion", 1); put("mutationId", UUID.randomUUID().toString()); put("at", "2026-10-24T23:59:59Z")
        put("command", FacetOccurrences.windowCommand("Tasks/parent.md", "a".repeat(64), "2026-10-24", automatic = true))
    })
    @Test fun newlyRetainedAutomaticEnvelopeBecomesVisibleAfterFailedMaintenanceReadback() = runTest {
        val action = retained(); val reading = CompletableDeferred<Unit>(); val proceed = CompletableDeferred<Unit>()
        var visible = emptyList<PendingFacetMutation>()
        val refresh = async {
            publishFacetSavedActions({ true }, { reading.complete(Unit); proceed.await(); listOf(action) }) { visible = it }
        }
        reading.await(); assertTrue(visible.isEmpty())
        proceed.complete(Unit)
        assertTrue(refresh.await())
        assertEquals(listOf(action), visible)
        assertEquals("offscreen-owner", visible.single().profileId)
    }
    @Test fun ownerRevokedWhileInventoryIsLoadingCannotPublishStaleActions() = runTest {
        val ownership = FacetOccurrenceOwnership(); val original = ownership.capture()
        val reading = CompletableDeferred<Unit>(); val proceed = CompletableDeferred<Unit>()
        val current = retained(); var visible = listOf(current)
        val refresh = async {
            publishFacetSavedActions(original, { reading.complete(Unit); proceed.await(); listOf(retained()) }) { visible = it }
        }
        reading.await(); ownership.revoke(); proceed.complete(Unit)
        assertFalse(refresh.await()); assertEquals(listOf(current), visible)
    }
    @Test fun failedInventoryReadCannotPretendPreviouslyVisibleActionsAreSettled() = runTest {
        val current = retained(); var visible = listOf(current)
        val failure = IOException("Private action inventory unavailable")
        try {
            publishFacetSavedActions({ true }, { throw failure }) { visible = it }
            fail("The failed visibility refresh must remain a failure")
        } catch (observed: IOException) { assertSame(failure, observed) }
        assertEquals(listOf(current), visible)
    }
    @Test fun successfulTerminalRetirementReadbackClearsThePreviouslyRetainedAction() = runTest {
        var visible = listOf(retained())
        assertTrue(publishFacetSavedActions({ true }, { emptyList() }) { visible = it })
        assertTrue(visible.isEmpty())
    }
}
