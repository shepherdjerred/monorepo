package red.sjer.facet.host

import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.attribute.BasicFileAttributes
import java.security.MessageDigest
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

/** Physical JVM outcomes with a fake swap seam. Native renameat2/power-loss acceptance remains separate. */
class FacetBoundedExchangeTest {
    private val owner = "vault"
    private val identity = "c".repeat(64)
    private val operation = "facet-write:" + "a".repeat(64)
    private fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun temporary(block: (File) -> Unit) { val root = Files.createTempDirectory("facet-exchange-").toFile(); try { block(root) } finally { root.deleteRecursively() } }
    private fun stages(root: File) = FacetBoundedStages(File(root, "stages"), owner, identity, synchronize = {})
    private fun prepare(stages: FacetBoundedStages, expected: String?, bytes: ByteArray): BoundedStage {
        val stage = stages.begin(owner, operation, "file.bin", expected, bytes.size.toULong(), hash(bytes))
        stages.write(owner, stage.id, 0uL, bytes)
        return stages.seal(owner, stage.id)
    }
    private class JvmExchangeFiles(val beforeRename: ((File, File, Boolean) -> Unit)? = null, val barrier: ((File) -> Unit)? = null) : ExchangeFiles {
        override fun identity(file: File): FacetFileStamp? {
            if (!Files.exists(file.toPath(), LinkOption.NOFOLLOW_LINKS)) return null
            val attrs = Files.readAttributes(file.toPath(), BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
            check(attrs.isRegularFile)
            return FacetFileStamp(1, attrs.fileKey().hashCode().toLong(), attrs.size(), attrs.lastModifiedTime().toMillis() / 1000, attrs.lastModifiedTime().toMillis() % 1000 * 1_000_000)
        }
        override fun rename(source: File, destination: File, exchange: Boolean) {
            beforeRename?.invoke(source, destination, exchange)
            if (!exchange) { Files.move(source.toPath(), destination.toPath()); return }
            val temporary = File(source.parentFile, "test-swap-slot")
            // This fake produces completed-swap state for recovery tests; it
            // makes no claim that three JVM moves equal one Linux atomic swap.
            Files.move(destination.toPath(), temporary.toPath())
            Files.move(source.toPath(), destination.toPath())
            Files.move(temporary.toPath(), source.toPath())
        }
        override fun synchronize(directory: File) { barrier?.invoke(directory) }
    }
    private fun exchange(root: File, stages: FacetBoundedStages, io: ExchangeFiles = JvmExchangeFiles(), checkpoint: (String) -> Unit = {}) =
        FacetBoundedExchange(File(root, "operations"), owner, identity, stages, { path -> require(path == "file.bin"); File(root, path) }, io, checkpoint)
    private fun captured(root: File) = File(root, "operations").listFiles()!!.single { it.name.endsWith(".captured.bytes") }

    @Test fun identicalReplacementRecoversByChangedSlotInodeAndReplaysOriginalOutcome() = temporary { root ->
        val target = File(root, "file.bin").apply { writeBytes(byteArrayOf(1)) }
        val expected = hash(byteArrayOf(1))
        val store = stages(root); val stage = prepare(store, expected, byteArrayOf(1))
        assertThrows(IOException::class.java) { exchange(root, store, checkpoint = { if (it == "exchanged") throw IOException("Interrupted after swap") }).exchange(owner, operation, "file.bin", expected, stage.id) }
        target.writeBytes(byteArrayOf(8))
        val first = exchange(root, store).exchange(owner, operation, "file.bin", expected, stage.id)
        assertTrue(first.applied); assertEquals(expected, first.displaced!!.revision)
        assertArrayEquals(byteArrayOf(1), captured(root).readBytes())
        assertArrayEquals(byteArrayOf(8), target.readBytes())
        captured(root).delete(); store.discard(owner, stage.id)
        assertEquals(first, exchange(root, stages(root)).exchange(owner, operation, "file.bin", expected, stage.id))
        assertThrows(IllegalStateException::class.java) { exchange(root, store).exchange(owner, operation, "file.bin", null, stage.id) }
    }

    @Test fun createCannotInferSuccessFromMissingSlotAndEqualForeignBytes() = temporary { root ->
        val store = stages(root); val stage = prepare(store, null, byteArrayOf(1))
        assertThrows(IOException::class.java) { exchange(root, store, checkpoint = { if (it == "captured") throw IOException("Interrupted after create") }).exchange(owner, operation, "file.bin", null, stage.id) }
        val target = File(root, "file.bin")
        val saved = File(root, "actual-prepared-inode")
        Files.move(target.toPath(), saved.toPath())
        target.writeBytes(byteArrayOf(1))
        assertThrows(IllegalStateException::class.java) { exchange(root, store).exchange(owner, operation, "file.bin", null, stage.id) }
        assertEquals(1, File(root, "operations").listFiles()!!.count { it.name.endsWith("exchange.json") })
        target.delete(); Files.move(saved.toPath(), target.toPath())
        assertTrue(exchange(root, store).exchange(owner, operation, "file.bin", null, stage.id).applied)
    }

    @Test fun actualDisplacedRaceHashIsPreservedWithAppliedTrueForCoreConflict() = temporary { root ->
        val target = File(root, "file.bin").apply { writeBytes(byteArrayOf(1)) }
        val store = stages(root); val stage = prepare(store, hash(byteArrayOf(1)), byteArrayOf(2))
        val raced = JvmExchangeFiles(beforeRename = { _, destination, swap -> if (swap) destination.writeBytes(byteArrayOf(3)) })
        val outcome = exchange(root, store, raced).exchange(owner, operation, "file.bin", stage.expectedRevision, stage.id)
        assertTrue(outcome.applied); assertEquals(hash(byteArrayOf(3)), outcome.displaced!!.revision)
        assertArrayEquals(byteArrayOf(3), captured(root).readBytes())
        assertArrayEquals(byteArrayOf(2), target.readBytes())
    }

    @Test fun rejectedFenceAndInterruptedTombstoneRemainOriginalOutcomes() = temporary { root ->
        val target = File(root, "file.bin").apply { writeBytes(byteArrayOf(2)) }
        val store = stages(root); val stage = prepare(store, hash(byteArrayOf(1)), byteArrayOf(3))
        val refused = exchange(root, store).exchange(owner, operation, "file.bin", stage.expectedRevision, stage.id)
        assertFalse(refused.applied); target.writeBytes(byteArrayOf(1))
        assertEquals(refused, exchange(root, store).exchange(owner, operation, "file.bin", stage.expectedRevision, stage.id))
        assertArrayEquals(byteArrayOf(1), target.readBytes())
    }

    @Test fun deleteRecoveryDoesNotDeleteRecreatedDestination() = temporary { root ->
        val target = File(root, "file.bin").apply { writeBytes(byteArrayOf(5)) }
        val expected = hash(byteArrayOf(5)); val store = stages(root)
        assertThrows(IOException::class.java) { exchange(root, store, checkpoint = { if (it == "captured") throw IOException("Interrupted after delete") }).exchange(owner, operation, "file.bin", expected, null) }
        assertFalse(target.exists()); target.writeBytes(byteArrayOf(6))
        val recovered = exchange(root, store).exchange(owner, operation, "file.bin", expected, null)
        assertTrue(recovered.applied); assertEquals(expected, recovered.displaced!!.revision)
        assertArrayEquals(byteArrayOf(6), target.readBytes())
        captured(root).delete()
        assertEquals(recovered, exchange(root, store).exchange(owner, operation, "file.bin", expected, null))
    }

    @Test fun directoryBarrierFailureCannotPublishAppliedOutcome() = temporary { root ->
        val target = File(root, "file.bin").apply { writeBytes(byteArrayOf(1)) }
        val store = stages(root); val stage = prepare(store, hash(byteArrayOf(1)), byteArrayOf(2))
        val failed = JvmExchangeFiles(barrier = { directory -> if (directory == target.parentFile && captured(root).exists()) throw IOException("Injected namespace persistence failure") })
        assertThrows(IOException::class.java) { exchange(root, store, failed).exchange(owner, operation, "file.bin", stage.expectedRevision, stage.id) }
        val manifest = File(root, "operations").listFiles()!!.single { it.name.endsWith("exchange.json") }
        assertEquals(JsonNull, Json.parseToJsonElement(manifest.readText()).jsonObject.getValue("outcome"))
        assertTrue(exchange(root, store).exchange(owner, operation, "file.bin", stage.expectedRevision, stage.id).applied)
    }

    @Test fun wrongKindOutcomeMetadataCannotBlessReceiptOrTouchCapturedBytes() = temporary { root ->
        File(root, "file.bin").writeBytes(byteArrayOf(1))
        val store = stages(root); val stage = prepare(store, hash(byteArrayOf(1)), byteArrayOf(2))
        val first = exchange(root, store).exchange(owner, operation, "file.bin", stage.expectedRevision, stage.id)
        val manifest = File(root, "operations").listFiles()!!.single { it.name.endsWith("exchange.json") }
        val original = manifest.readText(); val json = Json.parseToJsonElement(original).jsonObject
        val changed = JsonObject(json + ("outcome" to JsonObject(json.getValue("outcome").jsonObject + ("applied" to JsonPrimitive("true")))))
        manifest.writeText(changed.toString())
        assertThrows(IllegalArgumentException::class.java) { exchange(root, store).exchange(owner, operation, "file.bin", stage.expectedRevision, stage.id) }
        assertArrayEquals(byteArrayOf(1), captured(root).readBytes()); assertEquals(changed.toString(), manifest.readText())
        manifest.writeText(original)
        assertEquals(first, exchange(root, store).exchange(owner, operation, "file.bin", stage.expectedRevision, stage.id))
    }
}
