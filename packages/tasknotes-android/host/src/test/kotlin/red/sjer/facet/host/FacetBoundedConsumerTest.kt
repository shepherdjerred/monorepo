package red.sjer.facet.host

import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import uniffi.TaskNotesCore.FacetEngineException
import uniffi.TaskNotesCore.FacetHostException
import uniffi.TaskNotesCore.ObsidianBoundaryException

/** Actual generated records over physical JVM capabilities; native JNI atomicity remains separately unaccepted. */
class FacetBoundedConsumerTest {
    @Test fun generatedCallbackLifecyclePreservesOwnerVersionsAndContractFailures() {
        val state = Files.createTempDirectory("facet-callback-records-").toFile()
        try {
            val files = PrivateVaultFiles(File(state, "roots"))
            val profileId = "11111111-1111-4111-8111-111111111111"
            val root = files.createReplica(profileId)
            File(root, "file.bin").writeBytes(byteArrayOf(1, 2))
            val callbacks = FacetBoundedCallbacks(files) { profile, namespace ->
                require(profile == profileId)
                val io = FacetBoundedVaultTest.JvmCapabilityFiles()
                FacetBoundedVault(File(state, "metadata"), profile, namespace, { File(root, it) }, {}, io, io)
            }
            assertThrows(FacetHostException.Contract::class.java) { callbacks.listFiles(profileId) }
            assertThrows(FacetHostException.Contract::class.java) { callbacks.bindRuntimeIdentity("invalid") }
            callbacks.bindRuntimeIdentity("c".repeat(64))
            callbacks.bindRuntimeIdentity("c".repeat(64))
            assertThrows(FacetHostException.Contract::class.java) { callbacks.bindRuntimeIdentity("d".repeat(64)) }
            assertEquals(listOf("file.bin"), callbacks.listFiles(profileId))
            val original = requireNotNull(callbacks.openFileSnapshot(profileId, "file.bin"))
            val hash = MessageDigest.getInstance("SHA-256").digest(byteArrayOf(3, 4)).joinToString("") { "%02x".format(it) }
            val stage = callbacks.beginReplacement(profileId, "facet-write:" + "a".repeat(64), "file.bin", original.revision, 2uL, hash)
            assertThrows(FacetHostException.Contract::class.java) { callbacks.writeReplacementChunk(profileId, stage.id, 1uL, byteArrayOf(3)) }
            assertEquals(2uL, callbacks.writeReplacementChunk(profileId, stage.id, 0uL, byteArrayOf(3, 4)).written)
            assertTrue(callbacks.sealReplacement(profileId, stage.id).sealed)
            val outcome = callbacks.compareExchangeStaged(profileId, stage.operationId, stage.path, original.revision, stage.id)
            assertTrue(outcome.applied)
            assertEquals(listOf(requireNotNull(outcome.displaced)), callbacks.displacedMetadata(profileId, null, 128u))
            val retained = callbacks.openDisplacedSnapshot(profileId, requireNotNull(outcome.displaced).id)
            assertArrayEquals(byteArrayOf(1, 2), callbacks.readSnapshotChunk(profileId, retained.id, 0uL, 2u))
            assertThrows(FacetHostException.Contract::class.java) { callbacks.readSnapshotChunk("other", original.id, 0uL, 2u) }
            assertThrows(FacetHostException.Contract::class.java) { callbacks.displacedMetadata(profileId, null, 0u) }
            callbacks.closeSnapshot(profileId, retained.id)
            callbacks.closeSnapshot(profileId, original.id)
            callbacks.discardReplacement(profileId, stage.id)
            callbacks.acknowledgeDisplaced(profileId, requireNotNull(outcome.displaced).id)
            callbacks.acknowledgeDisplaced(profileId, requireNotNull(outcome.displaced).id)
            assertEquals(emptyList<Any>(), callbacks.displacedMetadata(profileId, null, 128u))
            assertEquals(outcome, callbacks.compareExchangeStaged(profileId, stage.operationId, stage.path, original.revision, stage.id))
            callbacks.detachProfile(profileId)
            assertArrayEquals(byteArrayOf(3, 4), File(root, "file.bin").readBytes())
            callbacks.close(); callbacks.close()
            assertThrows(FacetHostException.Contract::class.java) { callbacks.openFileSnapshot(profileId, "file.bin") }
        } finally { state.deleteRecursively() }
    }

    @Test fun busyReplayRetainsExactFrameAndStopsBeforeOldOwnerResumes() = runBlocking {
        val input = byteArrayOf(1, 2, 3)
        val seen = mutableListOf<ByteArray>()
        var attempts = 0
        var waits = 0
        val result = replayFacetBusy({ true }, { waits++ }) {
            seen.add(input); attempts++
            when (attempts) { 1 -> throw ObsidianBoundaryException.Busy(); 2 -> throw FacetEngineException.Busy(); else -> "accepted" }
        }
        assertEquals("accepted", result); assertEquals(3, attempts); assertEquals(2, waits)
        assertTrue(seen.all { it === input })
        var current = true
        attempts = 0
        try {
            replayFacetBusy<Unit>({ current }, { current = false }) { attempts++; throw ObsidianBoundaryException.Busy() }
            fail("A retired profile cannot replay its input.")
        } catch (_: CancellationException) { assertEquals(1, attempts) }
    }

    @Test fun permanentHostContractAndOtherFailuresAreNeverRetried() = runBlocking {
        for (failure in listOf(FacetEngineException.HostContract("private recovery"), FacetEngineException.Validation("bad input"), IllegalStateException("broken internal contract"))) {
            var attempts = 0
            try { replayFacetBusy<Unit>({ true }, { fail("Only Busy may wait.") }) { attempts++; throw failure }; fail("Failure must escape.") }
            catch (actual: Exception) { assertSame(failure, actual); assertEquals(1, attempts) }
            if (failure is FacetEngineException.HostContract) assertEquals("internal_contract", FacetFailureDiagnostic.from(failure).classification)
        }
    }
}
