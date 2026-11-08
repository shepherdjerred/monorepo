package red.sjer.facet.host

import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

/** Runs real SQLite, Rust callbacks, JNI atomic exchange and durable reopen. */
class PrivateReplicaRuntimeTest {
    @Test fun cancelledAbsentAutomaticEnvelopeWithChangedParentRetiresBeforeFreshGeneration(): Unit = runBlocking {
        obsoleteAutomaticAfterParentChange(deleted = false)
        obsoleteAutomaticAfterParentChange(deleted = true)
    }
    private suspend fun obsoleteAutomaticAfterParentChange(deleted: Boolean) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val profile = UUID.randomUUID().toString()
        val engine = FacetEngineRunner.open(context)
        try {
            engine.registerReplica(profile, "Obsolete automatic acceptance", approveStandard = true)
            engine.refresh(profile)
            val createId = UUID.randomUUID().toString()
            engine.execute(profile, buildJsonObject {
                put("kind", "create"); put("path", "Tasks/Obsolete parent.md")
                put("properties", buildJsonObject {
                    put("title", "Before parent edit"); put("id", "series-$profile")
                    put("recurrence", "DTSTART:20261024;FREQ=DAILY"); put("scheduled", "2026-10-24")
                    put("recurrenceAnchor", "scheduled"); put("occurrenceMaterialization", "rolling")
                    put("occurrenceNextTrigger", "completion"); put("occurrencePastHorizon", "P0D"); put("occurrenceFutureHorizon", "P1D")
                })
            }, createId)
            engine.discardObservedMutation(createId)
            val port = engine.occurrences()
            val original = port.windowPlan(profile, "2026-10-24").first.single()
            val obsoleteId = UUID.randomUUID().toString()
            try {
                engine.execute(profile, original.command(automatic = true), obsoleteId, admitted = { throw kotlinx.coroutines.CancellationException("Owner revoked after persistence") })
                fail("The revoked admission must leave the runtime untouched")
            } catch (_: kotlinx.coroutines.CancellationException) { }
            assertEquals(obsoleteId, engine.pendingMutations(profile).single().mutationId)
            val parent = engine.snapshot(profile, FacetEngineRunner.query()).tasks.single()
            val editId = UUID.randomUUID().toString()
            engine.execute(profile, buildJsonObject {
                put("kind", if (deleted) "delete" else "update"); put("path", parent.path); put("expectedRevision", parent.revision)
                if (!deleted) put("properties", buildJsonObject { put("title", "After parent edit"); put("priority", "high") })
            }, editId)
            engine.discardObservedMutation(editId)
            port.recoverAutomatic(profile)
            assertTrue(engine.pendingMutations(profile).isEmpty())
            val oldOutcome = engine.features(profile, buildJsonObject { put("kind", "mutation_receipt"); put("mutationId", obsoleteId) })
            assertEquals("absent", oldOutcome.getValue("state").jsonPrimitive.content)
            if (deleted) {
                assertTrue(port.windowPlan(profile, "2026-10-25").first.isEmpty())
                assertTrue(engine.snapshot(profile, FacetEngineRunner.query()).tasks.isEmpty())
                return
            }
            val current = port.windowPlan(profile, "2026-10-25").first.single()
            assertNotEquals(original.expectedParentRevision, current.expectedParentRevision)
            port.automatic(profile, current.command(automatic = true))
            assertTrue(engine.pendingMutations(profile).isEmpty())
            assertTrue(engine.snapshot(profile, FacetEngineRunner.query()).tasks.size > 1)
        } finally { engine.close() }
    }
    @Test fun rollingGenerationRetainsAutomaticEnvelopeAndCoreUndoPolicyAcrossRestart(): Unit = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val profile = UUID.randomUUID().toString()
        val createdId = UUID.randomUUID().toString()
        val automaticId = UUID.randomUUID().toString()
        lateinit var automaticReceipt: JsonObject
        lateinit var command: JsonObject
        var engine = FacetEngineRunner.open(context)
        try {
            engine.registerReplica(profile, "Occurrence runtime acceptance", approveStandard = true)
            engine.refresh(profile)
            engine.execute(profile, buildJsonObject {
                put("kind", "create"); put("path", "Tasks/Occurrence parent.md")
                put("properties", buildJsonObject {
                    put("title", "Occurrence parent"); put("id", "series-$profile")
                    put("recurrence", "DTSTART:20261024;FREQ=DAILY"); put("scheduled", "2026-10-24")
                    put("recurrenceAnchor", "scheduled"); put("occurrenceMaterialization", "rolling")
                    put("occurrenceNextTrigger", "completion"); put("occurrencePastHorizon", "P0D"); put("occurrenceFutureHorizon", "P2D")
                    put("vendor", buildJsonObject { put("retained", true) })
                }); put("body", "Parent Markdown remains intact\n")
            }, createdId)
            engine.discardObservedMutation(createdId)
            val plan = engine.occurrences().windowPlan(profile, "2026-10-24")
            assertTrue(plan.second.isEmpty())
            command = plan.first.single().command(automatic = true)
            automaticReceipt = engine.execute(profile, command, automaticId)
            assertTrue(automaticReceipt.getValue("paths").jsonArray.isNotEmpty())
            engine.occurrences().successors(profile, automaticId)
            assertEquals(createdId, engine.features(profile, buildJsonObject { put("kind", "undo_available") }).getValue("receiptId").jsonPrimitive.content)
        } finally { engine.close() }
        engine = FacetEngineRunner.open(context)
        try {
            val retained = engine.pendingMutations(profile).single()
            assertEquals(automaticId, retained.mutationId)
            assertEquals(command, retained.mutation.getValue("command"))
            assertEquals(automaticReceipt, engine.retryMutation(automaticId))
            assertEquals(createdId, engine.features(profile, buildJsonObject { put("kind", "undo_available") }).getValue("receiptId").jsonPrimitive.content)
            engine.discardObservedMutation(automaticId)
            val next = engine.occurrences().windowPlan(profile, "2026-10-25").first.single()
            val explicitId = UUID.randomUUID().toString()
            val explicit = engine.execute(profile, next.command(automatic = false), explicitId)
            assertTrue(explicit.getValue("paths").jsonArray.isNotEmpty())
            assertEquals(explicitId, engine.features(profile, buildJsonObject { put("kind", "undo_available") }).getValue("receiptId").jsonPrimitive.content)
            assertTrue(engine.occurrences().generationAttention(profile).isEmpty())
            val parent = engine.snapshot(profile, FacetEngineRunner.query()).tasks.single { it.path == "Tasks/Occurrence parent.md" }
            assertTrue(parent.properties.getValue("vendor").jsonObject.getValue("retained").jsonPrimitive.boolean)
            assertTrue(parent.body.contains("Parent Markdown remains intact"))
            engine.discardObservedMutation(explicitId)
        } finally { engine.close() }
    }
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
    @Test fun captureEditAndReopenPreserveMarkdownAndUnknownFields(): Unit = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val id = UUID.randomUUID().toString()
        var engine = FacetEngineRunner.open(context)
        engine.registerReplica(id, "Native acceptance", approveStandard = true)
        // This case intentionally asserts frontmatter title bytes. The default filename-title workflow is covered by Compose.
        assertTrue(PrivateVaultFiles(context).exchange(id, ".obsidian/plugins/tasknotes/data.json", null,
            """{"storeTitleInFilename":false,"taskFilenameFormat":"title","tasksFolder":"Tasks"}""".toByteArray()).applied)
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
