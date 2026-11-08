package red.sjer.facet.host

import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.file.Files
import java.security.MessageDigest
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

/** Physical JVM files prove stage contents/restart. Android JNI directory durability is a separate layer. */
class FacetBoundedStagesTest {
    private val owner = "original-vault"
    private val identity = "c".repeat(64)
    private val operation = "facet-write:" + "a".repeat(64)
    private fun stages(directory: File, checkpoint: (String) -> Unit = {}) = FacetBoundedStages(directory, owner, identity, synchronize = {}, checkpoint = checkpoint)
    private fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun temporary(block: (File) -> Unit) { val directory = Files.createTempDirectory("facet-bounded-stages-").toFile(); try { block(directory) } finally { directory.deleteRecursively() } }

    @Test fun exactPrefixReopensAndChangedOwnersIntentsOrRetriesReject() = temporary { directory ->
        var store = stages(directory)
        val bytes = byteArrayOf(1, 2, 3, 4)
        var stage = store.begin(owner, operation, "attachments/report.bin", null, 4uL, digest(bytes))
        stage = store.write(owner, stage.id, 0uL, byteArrayOf(1, 2))
        store = stages(directory)
        assertEquals(stage, store.begin(owner, operation, stage.path, null, 4uL, stage.revision))
        assertEquals(stage, store.write(owner, stage.id, 0uL, byteArrayOf(1, 2)))
        assertThrows(IllegalStateException::class.java) { store.write(owner, stage.id, 0uL, byteArrayOf(8, 2)) }
        assertThrows(IllegalStateException::class.java) { store.write(owner, stage.id, 1uL, byteArrayOf(2, 3)) }
        assertThrows(IllegalArgumentException::class.java) { store.write(owner, stage.id, 3uL, byteArrayOf(4)) }
        assertThrows(IllegalArgumentException::class.java) { store.write("other-vault", stage.id, 2uL, byteArrayOf(3, 4)) }
        assertThrows(IllegalStateException::class.java) { store.begin(owner, operation, "changed.bin", null, 4uL, stage.revision) }
        store.write(owner, stage.id, 2uL, byteArrayOf(3, 4)); stage = store.seal(owner, stage.id)
        assertEquals(stage, store.seal(owner, stage.id))
        assertEquals(stage, store.write(owner, stage.id, 4uL, byteArrayOf()))
        assertEquals(stage, store.write(owner, stage.id, 1uL, byteArrayOf(2, 3)))
    }

    @Test fun interruptionAfterByteSyncDoesNotAdvanceCommittedPrefix() = temporary { directory ->
        var store = stages(directory)
        val stage = store.begin(owner, operation, "file.bin", null, 4uL, digest(byteArrayOf(1, 2, 3, 4)))
        store.write(owner, stage.id, 0uL, byteArrayOf(1, 2))
        store = stages(directory) { if (it == "payload-written") throw IOException("Injected interruption before prefix commit") }
        assertThrows(IOException::class.java) { store.write(owner, stage.id, 2uL, byteArrayOf(9, 9)) }
        val payload = directory.listFiles()!!.single { it.extension == "bytes" }
        assertEquals(4L, payload.length())
        store = stages(directory)
        assertEquals(2uL, store.begin(owner, operation, stage.path, null, stage.size, stage.revision).written)
        assertEquals(2L, payload.length())
        store.write(owner, stage.id, 2uL, byteArrayOf(3, 4)); assertTrue(store.seal(owner, stage.id).sealed)
    }

    @Test fun slotIsSeparateAndRetiredIntentSurvivesRestartWithoutAcknowledgingBackups() = temporary { directory ->
        var store = stages(directory)
        val bytes = byteArrayOf(1, 2, 3)
        var stage = store.begin(owner, operation, "file.bin", digest(byteArrayOf(9)), 3uL, digest(bytes))
        store.write(owner, stage.id, 0uL, bytes); stage = store.seal(owner, stage.id)
        val slot = File(directory, "exchange-slot")
        store.copySealed(owner, stage.id, slot); slot.writeBytes(byteArrayOf(8, 8, 8))
        assertEquals(stage, store.write(owner, stage.id, 0uL, bytes))
        val captured = File(directory, "captured-predecessor").apply { writeBytes(byteArrayOf(9)) }
        store.discard(owner, stage.id); store = stages(directory); store.discard(owner, stage.id)
        assertTrue(captured.exists()); assertTrue(slot.exists())
        assertTrue(store.begin(owner, operation, stage.path, stage.expectedRevision, stage.size, stage.revision).retired)
        assertThrows(IllegalStateException::class.java) { store.begin(owner, operation, stage.path, null, stage.size, stage.revision) }
        assertThrows(IllegalStateException::class.java) { store.write(owner, stage.id, 0uL, bytes) }
        assertThrows(IllegalStateException::class.java) { store.seal(owner, stage.id) }
    }

    @Test fun corruptNamespaceOrIntentManifestCannotAuthorizeASlot() = temporary { directory ->
        val store = stages(directory)
        val stage = store.begin(owner, operation, "file.bin", null, 1uL, digest(byteArrayOf(7)))
        store.write(owner, stage.id, 0uL, byteArrayOf(7)); store.seal(owner, stage.id)
        val manifest = directory.listFiles()!!.single { it.extension == "json" }
        val original = Json.parseToJsonElement(manifest.readText()).jsonObject
        mapOf("operationId" to JsonPrimitive("facet-write:" + "b".repeat(64)), "engineIdentity" to JsonPrimitive("d".repeat(64)), "profile" to JsonPrimitive("other-vault"), "written" to JsonPrimitive(0), "size" to Json.parseToJsonElement(ULong.MAX_VALUE.toString())).forEach { (key, value) ->
            manifest.writeText(JsonObject(original + (key to value)).toString())
            assertThrows(IllegalStateException::class.java) { store.copySealed(owner, stage.id, File(directory, "forbidden-slot")) }
            assertFalse(File(directory, "forbidden-slot").exists())
        }
        manifest.writeText(original.toString())
        val otherEngine = FacetBoundedStages(directory, owner, "d".repeat(64), synchronize = {})
        assertThrows(IllegalStateException::class.java) { otherEngine.discard(owner, stage.id) }
        store.copySealed(owner, stage.id, File(directory, "valid-slot"))
    }

    @Test fun copiedBytesAndDurableSlotMustMatchReceipt() = temporary { directory ->
        var store = stages(directory)
        val stage = store.begin(owner, operation, "file.bin", null, 2uL, digest(byteArrayOf(1, 2)))
        store.write(owner, stage.id, 0uL, byteArrayOf(1, 2)); store.seal(owner, stage.id)
        val payload = directory.listFiles()!!.single { it.extension == "bytes" }
        store = stages(directory) { if (it == "before-slot-copy") payload.writeBytes(byteArrayOf(9, 9)) }
        assertThrows(IllegalStateException::class.java) { store.copySealed(owner, stage.id, File(directory, "unpublished-slot")) }
        payload.writeBytes(byteArrayOf(1, 2))
        val slot = File(directory, "changed-slot")
        store = stages(directory) { if (it == "slot-copied") slot.writeBytes(byteArrayOf(8, 8)) }
        assertThrows(IllegalStateException::class.java) { store.copySealed(owner, stage.id, slot) }
    }

    @Test fun wrongJsonKindsNeverCoercePrivateIntentOrChangeCommittedBytes() = temporary { directory ->
        val store = stages(directory)
        val stage = store.begin(owner, operation, "file.bin", null, 2uL, digest(byteArrayOf(1, 2)))
        store.write(owner, stage.id, 0uL, byteArrayOf(1, 2)); store.seal(owner, stage.id)
        val manifest = directory.listFiles()!!.single { it.extension == "json" }
        val payload = directory.listFiles()!!.single { it.extension == "bytes" }
        val original = Json.parseToJsonElement(manifest.readText()).jsonObject
        mapOf("schemaVersion" to JsonPrimitive("1"), "size" to JsonPrimitive("2"), "written" to JsonPrimitive("2"),
            "sealed" to JsonPrimitive("true"), "retired" to JsonPrimitive("false"), "profile" to JsonPrimitive(42),
            "path" to JsonPrimitive(false), "expectedRevision" to JsonPrimitive(42), "revision" to JsonNull).forEach { (key, value) ->
            val corrupt = JsonObject(original + (key to value)).toString()
            manifest.writeText(corrupt)
            assertThrows(IllegalArgumentException::class.java) { store.copySealed(owner, stage.id, File(directory, "forbidden-slot")) }
            assertArrayEquals(byteArrayOf(1, 2), payload.readBytes())
            assertEquals(corrupt, manifest.readText())
            assertFalse(File(directory, "forbidden-slot").exists())
        }
        manifest.writeText(original.toString())
        assertTrue(store.begin(owner, operation, stage.path, null, stage.size, stage.revision).sealed)
    }

    @Test fun zeroFileChunkLimitsAndMissingCommittedBytesRemainExplicit() = temporary { directory ->
        val store = stages(directory)
        var stage = store.begin(owner, operation, "empty.bin", null, 0uL, digest(byteArrayOf()))
        stage = store.seal(owner, stage.id); val slot = File(directory, "empty-slot"); store.copySealed(owner, stage.id, slot)
        assertEquals(0L, slot.length())
        assertThrows(IllegalArgumentException::class.java) { store.write(owner, stage.id, 0uL, ByteArray(FacetBoundedStages.CHUNK_BYTES + 1)) }
        assertThrows(IllegalArgumentException::class.java) { store.discard(owner, "../unknown") }
        val next = store.begin(owner, "facet-write:" + "b".repeat(64), "file.bin", null, 2uL, digest(byteArrayOf(1, 2)))
        assertThrows(IllegalStateException::class.java) { store.seal(owner, next.id) }
        store.write(owner, next.id, 0uL, byteArrayOf(9, 9))
        assertThrows(IllegalStateException::class.java) { store.seal(owner, next.id) }
        directory.listFiles()!!.filter { it.extension == "bytes" && it.length() > 0 }.single().delete()
        assertThrows(IllegalStateException::class.java) { store.begin(owner, next.operationId, next.path, null, next.size, next.revision) }
    }

    @Test fun legal199MiBStaysOnDiskAndUsesBoundedInputChunks() = temporary { directory ->
        val store = stages(directory)
        val chunk = ByteArray(FacetBoundedStages.CHUNK_BYTES) { 37 }
        val hash = MessageDigest.getInstance("SHA-256"); repeat(199) { hash.update(chunk) }
        val revision = hash.digest().joinToString("") { "%02x".format(it) }
        val stage = store.begin(owner, operation, "large.bin", null, 208_666_624uL, revision)
        repeat(199) { index -> store.write(owner, stage.id, index.toULong() * chunk.size.toULong(), chunk) }
        assertEquals(208_666_624uL, store.seal(owner, stage.id).written)
        val slot = File(directory, "large-slot"); store.copySealed(owner, stage.id, slot)
        assertEquals(208_666_624L, slot.length())
        RandomAccessFile(slot, "r").use { it.seek(slot.length() - 1); assertEquals(37, it.read()) }
        store.discard(owner, stage.id); assertTrue(slot.exists())
    }
}
