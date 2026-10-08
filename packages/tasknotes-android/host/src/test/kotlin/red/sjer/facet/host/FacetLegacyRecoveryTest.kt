package red.sjer.facet.host

import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.security.MessageDigest
import java.util.UUID
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

/** Existing ambiguous metadata must survive rather than erase an identical displaced predecessor. */
class FacetLegacyRecoveryTest {
    @Test fun missingLegacySlotNeverRetiresMetadataByCurrentDestinationHash() {
        val roots = Files.createTempDirectory("facet-legacy-missing-").toFile()
        try {
            val owner = UUID.randomUUID().toString()
            val files = PrivateVaultFiles(roots)
            val root = files.createReplica(owner)
            val recovery = File(root, ".facet-recovery").apply { mkdir() }
            val bytes = byteArrayOf(3, 4)
            val revision = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            val target = File(root, "task.bin").apply { writeBytes(bytes) }
            for (matchingField in listOf("expectedRevision", "replacementRevision", "capturedRevision")) {
                val id = UUID.randomUUID().toString()
                val manifest = File(recovery, "$id.json").apply { writeText(buildJsonObject {
                    put("id", id); put("path", "task.bin"); put(matchingField, revision)
                    if (matchingField == "capturedRevision") put("capturedSize", bytes.size)
                }.toString()) }
                val original = manifest.readBytes()
                assertThrows(LegacyRecoveryProofException::class.java) { files.displacedMetadata(owner) }
                assertArrayEquals(original, manifest.readBytes())
                assertArrayEquals(bytes, target.readBytes())
                assertFalse(File(recovery, "$id.bytes").exists())
                // Isolate each disposition without asking the adapter to erase it.
                assertTrue(manifest.delete())
            }
        } finally { roots.deleteRecursively() }
    }
    @Test fun expectedProviderFailureIsTypedWhileCorruptContractsStayLoud() {
        val legacy = LegacyRecoveryProofException()
        val mapped = facetHostFailure(legacy)
        assertTrue(mapped is uniffi.TaskNotesCore.FacetHostException.Unavailable)
        assertSame(legacy, mapped!!.cause)
        assertTrue(facetHostFailure(IOException("private provider boundary")) is uniffi.TaskNotesCore.FacetHostException.Io)
        assertTrue(facetHostFailure(SecurityException("denied")) is uniffi.TaskNotesCore.FacetHostException.PermissionDenied)
        assertNull(facetHostFailure(IllegalStateException("corrupt private owner metadata")))
        assertNull(facetHostFailure(IllegalArgumentException("wrong contract kind")))
    }
    @Test fun equalHashUnrecordedPredecessorIsPreservedForExplicitRecovery() {
        val roots = Files.createTempDirectory("facet-legacy-recovery-").toFile()
        try {
            val owner = UUID.randomUUID().toString()
            val files = PrivateVaultFiles(roots)
            val root = files.createReplica(owner)
            val recovery = File(root, ".facet-recovery").apply { mkdir() }
            val id = UUID.randomUUID().toString()
            val bytes = byteArrayOf(1, 2)
            val revision = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            File(root, "task.bin").writeBytes(bytes)
            val captured = File(recovery, "$id.bytes").apply { writeBytes(bytes) }
            val manifest = File(recovery, "$id.json").apply { writeText(buildJsonObject {
                put("id", id); put("path", "task.bin"); put("expectedRevision", revision); put("replacementRevision", revision)
            }.toString()) }
            val original = manifest.readText()
            assertThrows(LegacyRecoveryProofException::class.java) { files.displacedMetadata(owner) }
            assertEquals(original, manifest.readText())
            assertArrayEquals(bytes, captured.readBytes())
            assertArrayEquals(bytes, File(root, "task.bin").readBytes())
        } finally { roots.deleteRecursively() }
    }
}
