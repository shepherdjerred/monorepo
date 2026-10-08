package red.sjer.facet.host

import java.io.File
import java.io.RandomAccessFile
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.attribute.BasicFileAttributes
import java.security.MessageDigest
import org.junit.Assert.*
import org.junit.Test

/** Complete proposed callback surface; JVM fake swap/fsync seams remain distinct from Android native acceptance. */
class FacetBoundedVaultTest {
    private val owner = "vault"
    private val identity = "c".repeat(64)
    private val operation = "facet-write:" + "a".repeat(64)
    private fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun temporary(block: (File) -> Unit) { val root = Files.createTempDirectory("facet-bounded-owner-").toFile(); try { block(root) } finally { root.deleteRecursively() } }
    internal class JvmCapabilityFiles : SnapshotFiles, ExchangeFiles {
        private val descriptors = java.util.IdentityHashMap<RandomAccessFile, File>()
        override fun identity(file: File): FacetFileStamp? {
            if (!Files.exists(file.toPath(), LinkOption.NOFOLLOW_LINKS)) return null
            val attrs = Files.readAttributes(file.toPath(), BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
            check(attrs.isRegularFile)
            return FacetFileStamp(1, attrs.fileKey().hashCode().toLong(), attrs.size(), attrs.lastModifiedTime().toMillis() / 1000, attrs.lastModifiedTime().toMillis() % 1000 * 1_000_000)
        }
        override fun open(file: File) = RandomAccessFile(file, "r").also { descriptors[it] = file }
        override fun descriptorIdentity(file: RandomAccessFile) = identity(descriptors.getValue(file))!!
        override fun capture(source: File, destination: File): FacetFileStamp {
            val before = identity(source)!!
            source.inputStream().use { input -> destination.outputStream().use { output -> input.copyTo(output, 65_536) } }
            return before
        }
        override fun rename(source: File, destination: File, exchange: Boolean) {
            if (!exchange) { Files.move(source.toPath(), destination.toPath()); return }
            val temporary = File(source.parentFile, "test-swap-slot")
            Files.move(destination.toPath(), temporary.toPath()); Files.move(source.toPath(), destination.toPath()); Files.move(temporary.toPath(), source.toPath())
        }
        override fun synchronize(directory: File) { }
    }
    private fun capability(state: File, root: File, writable: Boolean = true, legacy: FacetLegacyBackups? = null): FacetBoundedVault {
        val io = JvmCapabilityFiles()
        return FacetBoundedVault(File(state, "private-metadata"), owner, identity, { path ->
            require(!path.startsWith('/') && path.split('/').none { it in setOf("", ".", "..") }); File(root, path)
        }, { check(writable) { "Readonly capability" } }, io, io, legacy)
    }

    @Test fun fullCallbackLifecyclePreservesPredecessorUntilAcknowledgedAndReplaysOutcome() = temporary { state ->
        val root = File(state, "vault").apply { mkdir() }
        val target = File(root, "file.bin").apply { writeBytes(byteArrayOf(1, 2)) }
        val vault = capability(state, root)
        val original = vault.openFileSnapshot(owner, "file.bin")!!
        assertArrayEquals(byteArrayOf(1, 2), vault.readSnapshotChunk(owner, original.id, 0uL, 2u))
        vault.closeSnapshot(owner, original.id); vault.closeSnapshot(owner, original.id)
        val stage = vault.beginReplacement(owner, operation, "file.bin", hash(byteArrayOf(1, 2)), 2uL, hash(byteArrayOf(3, 4)))
        vault.writeReplacementChunk(owner, stage.id, 0uL, byteArrayOf(3, 4)); vault.sealReplacement(owner, stage.id)
        val applied = vault.compareExchangeStaged(owner, operation, "file.bin", stage.expectedRevision, stage.id)
        assertTrue(applied.applied)
        val retained = vault.displacedMetadata(owner, null, 1).single()
        val retainedBytes = File(state, "private-metadata/exchanges").listFiles()!!.single { it.name.endsWith("captured.bytes") }
        val heldBytes = File(retainedBytes.parentFile, retainedBytes.name + ".held")
        Files.move(retainedBytes.toPath(), heldBytes.toPath())
        assertThrows(IllegalStateException::class.java) { vault.displacedMetadata(owner, null, 128) }
        Files.move(heldBytes.toPath(), retainedBytes.toPath())
        assertEquals(0, vault.displacedMetadata(owner, retained.id, 128).size)
        val predecessor = vault.openDisplacedSnapshot(owner, retained.id)
        vault.discardReplacement(owner, stage.id); vault.discardReplacement(owner, stage.id)
        assertArrayEquals(byteArrayOf(1, 2), vault.readSnapshotChunk(owner, predecessor.id, 0uL, 2u))
        vault.closeSnapshot(owner, predecessor.id)
        assertEquals(1, vault.displacedMetadata(owner, null, 128).size)
        vault.acknowledgeDisplaced(owner, retained.id); vault.acknowledgeDisplaced(owner, retained.id)
        assertTrue(vault.displacedMetadata(owner, null, 128).isEmpty())
        assertThrows(IllegalStateException::class.java) { vault.openDisplacedSnapshot(owner, retained.id) }
        target.writeBytes(byteArrayOf(9))
        assertEquals(applied, vault.compareExchangeStaged(owner, operation, "file.bin", stage.expectedRevision, stage.id))
        assertThrows(IllegalArgumentException::class.java) { vault.displacedMetadata("another-owner", null, 128) }
        vault.close(); vault.close()
        assertThrows(IllegalStateException::class.java) { vault.openFileSnapshot(owner, "file.bin") }
    }

    @Test fun readonlyWritesAndInvalidMetadataBoundsFailBeforeMutation() = temporary { state ->
        val root = File(state, "vault").apply { mkdir() }
        capability(state, root, false).use { vault ->
            assertThrows(IllegalStateException::class.java) { vault.beginReplacement(owner, operation, "file.bin", null, 1uL, hash(byteArrayOf(1))) }
            assertTrue(root.listFiles()!!.isEmpty())
            assertNull(vault.openFileSnapshot(owner, "absent.bin"))
            assertThrows(IllegalArgumentException::class.java) { vault.displacedMetadata(owner, null, 0) }
            assertThrows(IllegalArgumentException::class.java) { vault.displacedMetadata(owner, "foreign-id", 1) }
        }
    }

    @Test fun nestedZeroLengthCreationAndUnusedStageRetirement() = temporary { state ->
        val root = File(state, "vault").apply { mkdir() }
        capability(state, root).use { vault ->
            val stage = vault.beginReplacement(owner, operation, "nested/empty.bin", null, 0uL, hash(byteArrayOf()))
            vault.sealReplacement(owner, stage.id)
            assertTrue(vault.compareExchangeStaged(owner, operation, "nested/empty.bin", null, stage.id).applied)
            assertTrue(File(root, "nested/empty.bin").isFile)
            assertEquals(0L, File(root, "nested/empty.bin").length())
            vault.discardReplacement(owner, stage.id)
            val unused = vault.beginReplacement(owner, "facet-write:" + "b".repeat(64), "unused.bin", null, 0uL, hash(byteArrayOf()))
            vault.discardReplacement(owner, unused.id)
            assertFalse(File(root, "unused.bin").exists())
        }
    }

    @Test fun legacyAndNewPagesKeepOriginalOpaqueIdsAndBoundedSnapshots() = temporary { state ->
        val root = File(state, "vault").apply { mkdir() }
        val old = File(state, "old").apply { mkdir() }
        val ids = listOf("AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA", "22222222-2222-2222-2222-222222222222", "ffffffff-ffff-ffff-ffff-ffffffffffff")
        ids.forEach { writeLegacy(old, it, byteArrayOf(1, 2)) }
        val retained = legacy(state, old, root)
        capability(state, root, legacy = retained).use { vault ->
            File(root, "file.bin").writeBytes(byteArrayOf(5))
            val stage = vault.beginReplacement(owner, operation, "file.bin", hash(byteArrayOf(5)), 1uL, hash(byteArrayOf(6)))
            vault.writeReplacementChunk(owner, stage.id, 0uL, byteArrayOf(6)); vault.sealReplacement(owner, stage.id)
            val outcome = vault.compareExchangeStaged(owner, operation, "file.bin", stage.expectedRevision, stage.id)
            val seen = mutableListOf<String>(); var cursor: String? = null
            while (true) { val page = vault.displacedMetadata(owner, cursor, 1); if (page.isEmpty()) break; seen += page.single().id; cursor = page.single().id }
            assertEquals((ids + outcome.displaced!!.id).sorted(), seen)
            val snapshot = vault.openDisplacedSnapshot(owner, ids.first())
            assertArrayEquals(byteArrayOf(1, 2), vault.readSnapshotChunk(owner, snapshot.id, 0uL, 2u))
            vault.closeSnapshot(owner, snapshot.id)
            vault.acknowledgeDisplaced(owner, ids.first()); vault.acknowledgeDisplaced(owner, ids.first())
            assertEquals(3, vault.displacedMetadata(owner, null, 128).size)
            assertThrows(IllegalStateException::class.java) { vault.openDisplacedSnapshot(owner, ids.first()) }
        }
    }

    @Test fun legacyAckRestartRetainsOwnerAndNeverDeletesChangedCapturedBytes() {
        listOf("acknowledged", "bytes-removed", "metadata-removed").forEach { fault -> temporary { state ->
            val old = File(state, "old").apply { mkdir() }
            val id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
            writeLegacy(old, id, byteArrayOf(1, 2))
            val first = legacy(state, old, state) { if (it == fault) throw java.io.IOException("Injected interruption") }
            assertThrows(java.io.IOException::class.java) { first.acknowledge(id) }
            val reopened = legacy(state, old, state)
            reopened.acknowledge(id); reopened.acknowledge(id)
            assertTrue(reopened.metadata(null, 128).isEmpty())
            assertFalse(File(old, "$id.json").exists()); assertFalse(File(old, "$id.bytes").exists())
            val receipt = File(state, "acks").listFiles()!!.single()
            receipt.writeText(receipt.readText().replace(identity, "d".repeat(64)))
            assertThrows(IllegalStateException::class.java) { reopened.acknowledge(id) }
        } }
        temporary { state ->
            val old = File(state, "old").apply { mkdir() }; val id = "cccccccc-cccc-cccc-cccc-cccccccccccc"
            writeLegacy(old, id, byteArrayOf(1))
            val first = legacy(state, old, state) { if (it == "acknowledged") throw java.io.IOException("Pause") }
            assertThrows(java.io.IOException::class.java) { first.acknowledge(id) }
            File(old, "$id.bytes").writeBytes(byteArrayOf(9))
            val reopened = legacy(state, old, state)
            assertThrows(IllegalStateException::class.java) { reopened.acknowledge(id) }
            assertArrayEquals(byteArrayOf(9), File(old, "$id.bytes").readBytes())
            val receipt = File(state, "acks").listFiles()!!.single()
            receipt.writeText(receipt.readText().replace("\"size\":1", "\"size\":\"1\""))
            assertThrows(IllegalArgumentException::class.java) { reopened.acknowledge(id) }
        }
    }

    private fun writeLegacy(directory: File, id: String, bytes: ByteArray) {
        File(directory, "$id.bytes").writeBytes(bytes)
        File(directory, "$id.json").writeText(kotlinx.serialization.json.buildJsonObject {
            put("id", kotlinx.serialization.json.JsonPrimitive(id)); put("path", kotlinx.serialization.json.JsonPrimitive("file.bin"))
            put("capturedSize", kotlinx.serialization.json.JsonPrimitive(bytes.size)); put("capturedRevision", kotlinx.serialization.json.JsonPrimitive(hash(bytes)))
        }.toString())
    }
    @Test fun legacyMissingEqualHashAndWrongKindRecordsRemainReviewable() = temporary { state ->
        val old = File(state, "old").apply { mkdir() }; val id = "11111111-1111-1111-1111-111111111111"
        val retained = legacy(state, old, state)
        val metadata = File(old, "$id.json")
        metadata.writeText("{\"id\":\"$id\",\"path\":\"file.bin\",\"replacementRevision\":\"${hash(byteArrayOf(1))}\"}")
        val original = metadata.readBytes()
        assertThrows(LegacyRecoveryProofException::class.java) { retained.metadata(null, 128) }
        assertArrayEquals(original, metadata.readBytes())
        File(old, "$id.bytes").writeBytes(byteArrayOf(1))
        assertThrows(LegacyRecoveryProofException::class.java) { retained.source(id) }
        assertArrayEquals(original, metadata.readBytes())
        File(old, "$id.bytes").writeBytes(byteArrayOf(2))
        assertEquals(hash(byteArrayOf(2)), retained.source(id).first.revision)
        writeLegacy(old, id, byteArrayOf(1))
        metadata.writeText(metadata.readText().replace("\"capturedSize\":1", "\"capturedSize\":\"1\""))
        val wrongKind = metadata.readBytes()
        assertThrows(IllegalArgumentException::class.java) { retained.source(id) }
        assertArrayEquals(wrongKind, metadata.readBytes())
        assertThrows(IllegalArgumentException::class.java) { retained.metadata(null, 0) }
        assertThrows(IllegalArgumentException::class.java) { retained.source("unknown") }
    }
    private fun legacy(state: File, old: File, root: File, checkpoint: (String) -> Unit = {}): FacetLegacyBackups =
        FacetLegacyBackups(old, File(state, "acks"), owner, identity, { File(root, it) }, JvmCapabilityFiles(), checkpoint)

    @Test fun legacyMetadataDescriptorGrowthAndTruncationFailWithinOriginalReadBound() {
        listOf(true, false).forEach { grow -> temporary { state ->
            val old = File(state, "old").apply { mkdir() }; val id = "11111111-1111-1111-1111-111111111111"
            writeLegacy(old, id, byteArrayOf(1)); val metadata = File(old, "$id.json")
            val originalLength = metadata.length()
            var once = true
            val retained = legacy(state, old, state) { point ->
                if (point == "metadata-opened" && once) {
                    once = false
                    if (grow) metadata.appendText(" ".repeat(65_536)) else metadata.writeText("")
                }
            }
            assertThrows(IllegalStateException::class.java) { retained.source(id) }
            assertEquals(if (grow) 65_536L + originalLength else 0L, metadata.length())
            assertArrayEquals(byteArrayOf(1), File(old, "$id.bytes").readBytes())
            assertTrue(File(state, "acks").listFiles()!!.isEmpty())
        } }
    }
}
