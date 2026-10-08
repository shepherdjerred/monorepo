package red.sjer.facet.host

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.async
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class FacetWorkFailureTest {
    @Test fun expectedProviderStorageAndOwnAppliedObservationRemainUseful() {
        val failure = java.io.IOException("component storage failure")
        assertEquals("Saved. Refresh the vault to update the list.", FacetWorkFailure.present(failure, true, true))
        assertEquals("Facet could not access private storage. Check available storage before retrying.", FacetWorkFailure.present(failure, false, true))
        assertEquals("Review this note.", FacetWorkFailure.present(FacetActionError("Review this note."), false, true))
    }

    @Test fun delayedContractFailuresAreFencedBeforeClassification() = runBlocking {
        for (contract in listOf(FacetReceiptContractException("corrupt receipt"))) {
            val authority = FacetNoticeAuthority()
            val ticket = authority.begin()
            val owner = authority.capture(ticket, "p", "mutation")
            val waiting = kotlinx.coroutines.CompletableDeferred<Unit>()
            val release = kotlinx.coroutines.CompletableDeferred<Unit>()
            val result = async {
                waiting.complete(Unit)
                release.await()
                FacetWorkFailure.present(contract, true, authority.isCurrent(ticket) && authority.owns(owner, "p"))
            }
            waiting.await()
            authority.begin()
            release.complete(Unit)
            assertNull(result.await())
            val currentTicket = authority.begin()
            val currentOwner = authority.capture(currentTicket, "p", "current")
            assertNull(FacetWorkFailure.present(contract, false, authority.isCurrent(currentTicket) && authority.owns(currentOwner, "other")))
            val current = authority.isCurrent(currentTicket) && authority.owns(currentOwner, "p")
            assertSame(contract, assertThrows(contract.javaClass) { FacetWorkFailure.present(contract, false, current) })
            authority.close()
            assertNull(FacetWorkFailure.present(contract, true, authority.isCurrent(currentTicket)))
        }
    }

    @Test fun cancellationStillPropagatesWhenTheOwnerIsStale() {
        val cancelled = kotlinx.coroutines.CancellationException("component cancelled")
        assertSame(cancelled, assertThrows(kotlinx.coroutines.CancellationException::class.java) { FacetWorkFailure.present(cancelled, false, false) })
        assertNull(FacetWorkFailure.present(java.io.IOException("old failure"), true, false))
    }
}
