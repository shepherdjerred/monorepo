package red.sjer.facet.host

import kotlinx.coroutines.Job
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.yield
import org.junit.Assert.*
import org.junit.Test

class FacetSyncOwnershipTest {
    @Test fun verifiedOwnerReplacementCanConnectAndPauseUsingOriginalForegroundLease() {
        val ownership = FacetSyncOwnership()
        val foreground = ownership.resumeForeground()
        val attempt = ownership.suspendAccountTransition()
        ownership.revokeAccountAuthorization(attempt)
        ownership.finishAccountTransition(attempt)
        assertFalse(ownership.pauseForeground(foreground))
        assertNull(ownership.begin(Job()))
        // Connecting the replacement account grants authorization without replacing the UI lease.
        ownership.authorize()
        assertTrue(ownership.pauseForeground(foreground))
        assertNotNull(ownership.begin(Job()))
        try {
            ownership.revokeAccountAuthorization(attempt)
            fail("A completed transition cannot revoke the replacement account")
        } catch (_: IllegalStateException) { }
    }

    @Test fun rejectedAccountAttemptPreservesExactPauseLeaseAndBackgroundAuthorization() {
        val ownership = FacetSyncOwnership()
        val foreground = ownership.resumeForeground()
        val attempt = ownership.suspendAccountTransition()
        // Pausing while authentication is pending may schedule work, but cannot start a writer.
        assertTrue(ownership.pauseForeground(foreground))
        assertNull(ownership.begin(Job()))
        ownership.finishAccountTransition(attempt)
        assertNotNull(ownership.begin(Job()))
    }

    @Test fun finishingOldAccountAttemptCannotReleaseResumedForegroundOrRestoreSignedOutAuthorization() {
        val ownership = FacetSyncOwnership()
        val oldForeground = ownership.resumeForeground()
        val attempt = ownership.suspendAccountTransition()
        assertTrue(ownership.pauseForeground(oldForeground))
        val currentForeground = ownership.resumeForeground()
        ownership.finishAccountTransition(attempt)
        assertFalse(ownership.pauseForeground(oldForeground))
        assertNull(ownership.begin(Job()))
        assertTrue(ownership.pauseForeground(currentForeground))
        val next = ownership.suspendAccountTransition()
        ownership.disable()
        ownership.finishAccountTransition(next)
        assertFalse(ownership.pauseForeground())
        assertNull(ownership.begin(Job()))
    }

    @Test fun authenticationSuspensionCancelsAndDrainsExactBackgroundWriter() = runBlocking {
        val ownership = FacetSyncOwnership()
        val worker = Job()
        val childFinished = CompletableDeferred<Unit>()
        val childEntered = CompletableDeferred<Unit>()
        val child = CoroutineScope(worker + Dispatchers.Default).launch {
            withContext(NonCancellable) { childEntered.complete(Unit); childFinished.await() }
        }
        val workerToken = requireNotNull(ownership.begin(worker))
        childEntered.await()
        var stopped = false
        assertTrue(ownership.retain(workerToken) { stopped = true })
        val attempt = ownership.suspendAccountTransition()
        assertTrue(stopped)
        assertTrue(worker.isCancelled)
        val drain = async { ownership.awaitDrain() }
        yield(); assertFalse(drain.isCompleted)
        ownership.finishAccountTransition(attempt)
        assertNull(ownership.begin(Job()))
        childFinished.complete(Unit)
        withTimeout(5000) { drain.await(); child.join() }
        assertNotNull(ownership.begin(Job()))
    }

    @Test fun clearedForegroundWriterDrainBlocksAnotherWriterAndLatePauseCannotReleaseNewOwner() = runBlocking {
        val ownership = FacetSyncOwnership()
        val previous = ownership.resumeForeground()
        val cleanup = Job()
        ownership.retainDrain(cleanup)
        assertTrue(ownership.pauseForeground(previous))
        assertNull(ownership.begin(Job()))
        val current = ownership.resumeForeground()
        assertFalse(ownership.pauseForeground(previous))
        val drain = async { ownership.awaitDrain() }
        yield(); assertFalse(drain.isCompleted)
        cleanup.complete(); drain.await()
        assertNull(ownership.begin(Job()))
        assertTrue(ownership.pauseForeground(current))
        assertNotNull(ownership.begin(Job()))
    }

    @Test fun localReminderOptInCanUseAnOsBudgetWithoutAccountCredentials() {
        assertTrue(FacetBackgroundSync.hasBackgroundWork(false, true))
        assertTrue(FacetBackgroundSync.hasBackgroundWork(true, false))
        assertFalse(FacetBackgroundSync.hasBackgroundWork(false, false))
    }
    @Test fun failedCloseStillDrainsAllOtherResourcesBeforeReleasingLease() = runBlocking {
        val first = IllegalStateException("first close")
        val later = IllegalStateException("later close")
        val order = mutableListOf<String>()
        val failure = cleanupBackgroundResources(listOf<suspend () -> Unit>(
            { order.add("session"); throw first },
            { order.add("account"); throw later },
            { order += "engine" },
        )) { order.add("release") }
        assertSame(first, failure)
        assertEquals(listOf("session", "account", "engine", "release"), order)
        assertArrayEquals(arrayOf(later), first.suppressed)
    }
    @Test fun takeoverWaitsForCancelledWorkersDurableCleanup() = runBlocking {
        val ownership = FacetSyncOwnership()
        val worker = Job()
        val entered = CompletableDeferred<Unit>()
        val finishDurableCall = CompletableDeferred<Unit>()
        val durableCall = CoroutineScope(worker + Dispatchers.Default).launch {
            withContext(NonCancellable) {
                entered.complete(Unit)
                finishDurableCall.await()
            }
        }
        requireNotNull(ownership.begin(worker))
        entered.await()
        ownership.resumeForeground()
        val drain = async { ownership.awaitDrain() }
        yield()
        assertFalse(drain.isCompleted)
        finishDurableCall.complete(Unit)
        withTimeout(5000) { drain.await(); durableCall.join() }
        assertTrue(worker.isCompleted)
    }
    @Test fun signedOutPauseCannotRestartBackgroundUntilExplicitAuthorization() {
        val ownership = FacetSyncOwnership()
        ownership.disable()
        assertFalse(ownership.pauseForeground())
        assertNull(ownership.begin(Job()))
        ownership.authorize()
        assertNotNull(ownership.begin(Job()))
    }
    @Test fun foregroundResumeCancelsExactWorkerAndFencesLateSession() {
        val ownership = FacetSyncOwnership()
        val job = Job()
        val token = requireNotNull(ownership.begin(job))
        var stopped = 0
        assertTrue(ownership.retain(token) { stopped++ })
        ownership.resumeForeground()
        assertTrue(job.isCancelled)
        assertEquals(1, stopped)
        assertFalse(ownership.retain(token) { stopped++ })
        assertEquals(2, stopped)
        assertNull(ownership.begin(Job()))
    }

    @Test fun staleWorkerCompletionDoesNotReleaseAnotherLease() {
        val ownership = FacetSyncOwnership()
        val old = requireNotNull(ownership.begin(Job()))
        ownership.resumeForeground()
        ownership.pauseForeground()
        val current = requireNotNull(ownership.begin(Job()))
        ownership.end(old)
        assertNull(ownership.begin(Job()))
        ownership.end(current)
        assertNotNull(ownership.begin(Job()))
    }
}
