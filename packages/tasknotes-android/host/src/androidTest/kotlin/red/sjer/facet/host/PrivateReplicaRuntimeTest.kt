package red.sjer.facet.host

import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

/** Runs real SQLite, Rust callbacks, JNI atomic exchange and durable reopen. */
class PrivateReplicaRuntimeTest {
    @Test fun immutableActionEnvelopeSurvivesUncertainResponseAndRestart() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val directory = java.io.File(context.noBackupFilesDir, "draft-test-${UUID.randomUUID()}")
        val id = UUID.randomUUID().toString()
        val command = buildJsonObject { put("kind", "create"); put("properties", buildJsonObject { put("title", "Retained draft") }) }
        val first = FacetMutationDrafts(directory).envelope("vault", id, command, "2026-10-03T00:00:00Z")
        val restarted = FacetMutationDrafts(directory)
        assertEquals(first, restarted.envelope("vault", id, command, "2026-10-04T00:00:00Z"))
        assertThrows(FacetActionError::class.java) { restarted.envelope("other", id, command, "2026-10-04T00:00:00Z") }
        assertThrows(FacetActionError::class.java) { restarted.envelope("vault", id, buildJsonObject { put("kind", "delete") }, "2026-10-04T00:00:00Z") }
        restarted.discard(id)
        assertTrue(directory.delete())
    }

    @Test fun missingRootFailsInsteadOfPretendingTheVaultIsEmpty() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val files = PrivateVaultFiles(context)
        assertThrows(IllegalArgumentException::class.java) { files.list(UUID.randomUUID().toString()) }
        assertThrows(IllegalArgumentException::class.java) { files.read(UUID.randomUUID().toString(), "missing.md") }
    }
    @Test fun captureEditAndReopenPreserveMarkdownAndUnknownFields() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val id = UUID.randomUUID().toString()
        var engine = FacetEngineRunner.open(context)
        engine.registerReplica(id, "Native acceptance", approveStandard = true)
        engine.refresh(id)
        engine.execute(id, buildJsonObject {
            put("kind", "create"); put("path", "Tasks/Native acceptance.md")
            put("properties", buildJsonObject { put("title", "Native acceptance"); put("vendor", buildJsonObject { put("keep", true) }) })
            put("body", "Original note body\n")
        })
        val created = engine.snapshot(id, FacetEngineRunner.query()).tasks.single()
        engine.execute(id, buildJsonObject {
            put("kind", "update"); put("path", created.path); put("expectedRevision", created.revision)
            put("properties", buildJsonObject { put("title", "Edited native acceptance") })
        })
        engine.close()
        engine = FacetEngineRunner.open(context)
        val reopened = engine.refresh(id).tasks.single()
        assertEquals("Edited native acceptance", reopened.title)
        assertEquals(true, reopened.properties.getValue("vendor").jsonObject.getValue("keep").jsonPrimitive.boolean)
        assertTrue(reopened.body.contains("Original note body"))
        val markdown = requireNotNull(PrivateVaultFiles(context).read(id, reopened.path)).toString(Charsets.UTF_8)
        assertTrue(markdown.contains("Edited native acceptance"))
        assertTrue(markdown.contains("vendor:"))
        engine.close()
    }

    @Test fun atomicExchangeRetainsDisplacedBytesUntilAcknowledged() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val files = PrivateVaultFiles(context)
        val id = UUID.randomUUID().toString()
        files.createReplica(id)
        val original = "original".toByteArray()
        assertTrue(files.exchange(id, "Tasks/a.md", null, original).applied)
        val changed = files.exchange(id, "Tasks/a.md", PrivateVaultFiles.revision(original), "replacement".toByteArray())
        assertArrayEquals(original, changed.displacedBytes)
        val restarted = PrivateVaultFiles(context)
        assertArrayEquals(original, restarted.displaced(id).single().bytes)
        restarted.acknowledge(id, requireNotNull(changed.displacedVersionId))
        assertTrue(restarted.displaced(id).isEmpty())
        assertFalse(restarted.exchange(id, "Tasks/a.md", PrivateVaultFiles.revision(original), "stale".toByteArray()).applied)
    }

    @Test fun metadataRecoveryPagesKeepExactVersions() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val files = PrivateVaultFiles(context)
        val id = UUID.randomUUID().toString()
        files.createReplica(id)
        repeat(5) { index ->
            val original = "original $index".toByteArray()
            files.exchange(id, "$index.md", null, original)
            files.exchange(id, "$index.md", PrivateVaultFiles.revision(original), "replacement".toByteArray())
        }
        val records = mutableListOf<CapturedMetadata>()
        var after: String? = null
        while (true) {
            val page = files.displacedMetadata(id, after, 2)
            assertTrue(page.size <= 2)
            if (page.isEmpty()) break
            records.addAll(page); after = page.last().id
        }
        assertEquals(5, records.size)
        assertEquals(records.map { it.id }.sorted(), records.map { it.id })
        records.forEach { metadata ->
            val bytes = files.readDisplaced(id, metadata.id)
            assertEquals(metadata.size, bytes.size.toULong())
            assertEquals(metadata.revision, PrivateVaultFiles.revision(bytes))
        }
    }
}
