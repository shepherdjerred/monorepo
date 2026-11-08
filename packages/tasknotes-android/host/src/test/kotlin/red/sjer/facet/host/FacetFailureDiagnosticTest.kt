package red.sjer.facet.host

import java.io.IOException
import org.junit.Assert.*
import org.junit.Test
import uniffi.TaskNotesCore.FacetEngineException

class FacetFailureDiagnosticTest {
    @Test fun reminderUiHandlesExpectedPermissionAndConfigurationButNotBrokenContracts() {
        assertNotNull(FacetEngineRunner.expectedReminderFailureMessage(FacetReminderPermissionException()))
        assertNotNull(FacetEngineRunner.expectedReminderFailureMessage(FacetEngineException.Configuration("Review vault settings.")))
        assertNull(FacetEngineRunner.expectedReminderFailureMessage(FacetEngineException.Storage("private bytes")))
        assertNull(FacetEngineRunner.expectedReminderFailureMessage(FacetEngineException.Validation("bad internal request")))
        assertNull(FacetEngineRunner.expectedReminderFailureMessage(IllegalStateException("broken contract")))
    }
    @Test fun preservesClosedCauseAndSuppressedClassificationsWithoutUserData() {
        val failure = FacetEngineException.Storage("private vault/path and token response")
        failure.initCause(IOException("secret bytes"))
        failure.addSuppressed(IllegalStateException("account password"))
        val diagnostic = FacetFailureDiagnostic.from(failure)
        assertEquals("storage", diagnostic.classification)
        assertEquals("first:storage,cause:io,suppressed:internal_contract", diagnostic.chain)
        assertFalse(diagnostic.toString().contains("secret"))
        assertFalse(diagnostic.toString().contains("private vault"))
    }

    @Test fun onlyExplicitTransportFailureIsNetworkAndContractFailuresStayFailures() {
        assertEquals("network", FacetFailureDiagnostic.from(FacetNetworkException(IOException("private URL"))).classification)
        assertEquals("io", FacetFailureDiagnostic.from(IOException("private path")).classification)
        assertEquals("internal_contract", FacetFailureDiagnostic.from(IllegalArgumentException("corrupt JSON")).classification)
    }

    @Test fun boundedTraversalHandlesCyclesAndManyCleanupFailures() {
        val first = IllegalStateException("first")
        val second = IOException("second")
        first.initCause(second)
        second.initCause(first)
        repeat(40) { first.addSuppressed(IllegalStateException("suppressed $it")) }
        val diagnostic = FacetFailureDiagnostic.from(first)
        assertTrue(diagnostic.chain.endsWith("truncated"))
        assertTrue(diagnostic.chain.length < 600)
        assertEquals(17, diagnostic.chain.split(',').size)
    }
}
