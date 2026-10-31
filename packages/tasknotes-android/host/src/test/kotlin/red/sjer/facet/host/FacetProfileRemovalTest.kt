package red.sjer.facet.host

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import uniffi.TaskNotesCore.FacetEngineException

class FacetProfileRemovalTest {
    @Test fun rightsWaitForWriterDrainAndSuccessfulCoreDeletion() = runBlocking {
        val drained = CompletableDeferred<Unit>()
        val entered = CompletableDeferred<Unit>()
        val seen = mutableListOf<String>()
        val removal = launch {
            finishFacetProfileRemoval(
                drain = { seen.add("draining"); entered.complete(Unit); drained.await(); seen.add("drained") },
                remove = { seen.add("removed") },
                detachRights = { seen.add("profile-key-only") },
                reconcile = { seen.add("remaining-profiles") }
            )
        }
        entered.await()
        assertEquals(listOf("draining"), seen)
        drained.complete(Unit); removal.join()
        assertEquals(listOf("draining", "drained", "removed", "profile-key-only", "remaining-profiles"), seen)
    }

    @Test fun pendingWorkAndBusyKeepRightsAndReconcileOriginalOwner() = runBlocking {
        for (failure in listOf(FacetEngineException.Conflict(), FacetEngineException.Busy())) {
            val seen = mutableListOf<String>()
            try {
                finishFacetProfileRemoval({ seen.add("drained") }, { throw failure }, { fail("Rejected core removal cannot detach rights.") }, { seen.add("original-owner-reconciled") })
                fail("The native rejection must escape.")
            } catch (actual: Exception) { assertSame(failure, actual) }
            assertEquals(listOf("drained", "original-owner-reconciled"), seen)
        }
    }

    @Test fun cleanupFailureDoesNotReplaceOriginalPermanentFailure() = runBlocking {
        val original = FacetEngineException.HostContract("private recovery")
        val cleanup = IllegalStateException("internal cleanup")
        try {
            finishFacetProfileRemoval({ }, { throw original }, { fail("No rights changes after a failed core decision.") }, { throw cleanup })
            fail("The permanent failure must escape.")
        } catch (actual: Exception) { assertSame(original, actual); assertArrayEquals(arrayOf(cleanup), actual.suppressed) }
    }
}
