package red.sjer.facet

import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class FacetAccountSessionRecoveryTest {
    @Test fun settledMfaAndNetworkFailureResumeRetainedForegroundSessions() = runBlocking {
        val order = mutableListOf<String>()
        assertEquals("MFA", withAccountSessionRecovery(
            attempt = { order += "authenticate"; "MFA" },
            shouldResume = { true },
            resume = { order += "resume-authorized" },
        ))
        val network = IOException("Synthetic sign-in network failure")
        val recovery = IOException("Synthetic session recovery failure")
        try {
            withAccountSessionRecovery(
                attempt = { order += "authenticate"; throw network },
                shouldResume = { true },
                resume = { order += "resume-authorized"; throw recovery },
            )
            fail("Expected original network failure")
        } catch (failure: IOException) {
            assertSame(network, failure)
            assertArrayEquals(arrayOf(recovery), failure.suppressed)
        }
        assertEquals(listOf("authenticate", "resume-authorized", "authenticate", "resume-authorized"), order)
    }

    @Test fun backgroundTransitionDuringAttemptPreventsForegroundSessionRestart() = runBlocking {
        var foreground = true
        var resumed = false
        val entered = CompletableDeferred<Unit>()
        val response = CompletableDeferred<String>()
        val attempt = async {
            withAccountSessionRecovery(
                attempt = { entered.complete(Unit); response.await() },
                shouldResume = { foreground },
                resume = { resumed = true },
            )
        }
        entered.await()
        foreground = false
        response.complete("rejected")
        assertEquals("rejected", attempt.await())
        assertFalse(resumed)
    }

    @Test fun cancelledAttemptCannotRestartSessionsEvenWithUnchangedForegroundFlag() = runBlocking {
        var resumed = false
        val entered = CompletableDeferred<Unit>()
        val response = CompletableDeferred<Unit>()
        val attempt = async {
            withAccountSessionRecovery(
                attempt = { entered.complete(Unit); response.await() },
                shouldResume = { true },
                resume = { resumed = true },
            )
        }
        entered.await()
        attempt.cancel()
        attempt.join()
        assertFalse(resumed)
    }
}
