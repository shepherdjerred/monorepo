package red.sjer.facet.host

import java.nio.file.Files
import java.util.UUID
import kotlinx.serialization.json.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class FacetMutationRecoveryTest {
    @Test fun persistedHistoricalActionsHaveOwnedRetirementDecisionsAndCannotResume() {
        val loader = requireNotNull(javaClass.classLoader)
        val schema = FacetSchema(requireNotNull(loader.getResourceAsStream("schema/facet-engine.schema.json")).bufferedReader().use { it.readText() })
        val directory = Files.createTempDirectory("facet-retained-upgrade").toFile()
        try {
            val id = UUID.randomUUID().toString()
            val activeId = UUID.randomUUID().toString()
            fun mutation(identity: String, command: JsonObject) = buildJsonObject {
                put("schemaVersion", 1); put("mutationId", identity); put("at", "2026-10-03T12:00:00Z"); put("command", command)
            }
            val historical = mutation(id, buildJsonObject { put("kind", "start_time"); put("path", "Tasks/a.md") })
            val active = mutation(activeId, buildJsonObject { put("kind", "create"); put("properties", buildJsonObject { put("title", "Still supported") }) })
            for (value in listOf(historical, active)) {
                directory.resolve("${value.getValue("mutationId").jsonPrimitive.content}.json").writeText(buildJsonObject { put("profileId", "original-vault"); put("mutation", value) }.toString())
            }
            val before = directory.resolve("$id.json").readBytes()
            val reopened = FacetMutationDrafts(directory)
            val drafts = reopened.pending().onEach { FacetRetainedActions.validate(schema, it.mutation) }
            assertEquals(2, drafts.size)
            val retired = drafts.single { it.mutationId == id }
            assertEquals(false, retired.canResume)
            assertEquals(true, drafts.single { it.mutationId == activeId }.canResume)
            org.junit.Assert.assertArrayEquals(before, directory.resolve("$id.json").readBytes())
            fun outcome(identity: String, state: String, receipt: JsonElement = JsonNull) = buildJsonObject {
                put("schemaVersion", 1); put("mutationId", identity); put("state", state); put("receipt", receipt)
            }
            assertThrows(FacetActionError::class.java) { FacetRetainedActions.retirement(schema, retired, outcome(id, "pending")) }
            assertThrows(IllegalArgumentException::class.java) { FacetRetainedActions.retirement(schema, retired, outcome(activeId, "absent")) }
            org.junit.Assert.assertArrayEquals(before, directory.resolve("$id.json").readBytes())
            val receipt = buildJsonObject {
                put("schemaVersion", 1); put("mutationId", id); put("applied", true); put("cleanupPending", false)
                put("diagnostics", JsonArray(emptyList())); put("taskPath", JsonNull); put("paths", JsonArray(listOf(JsonPrimitive("Tasks/a.md")))); put("pendingCount", 1)
            }
            assertEquals(FacetDraftRetirement.OBSERVED, FacetRetainedActions.retirement(schema, retired, outcome(id, "applied", receipt)))
            assertEquals(FacetDraftRetirement.REJECTED, FacetRetainedActions.retirement(schema, retired, outcome(id, "absent")))
            val parkedReceipt = JsonObject(receipt + ("applied" to JsonPrimitive(false)))
            assertEquals(FacetDraftRetirement.REJECTED, FacetRetainedActions.retirement(schema, retired, outcome(id, "parked", parkedReceipt)))
            val foreignReceipt = JsonObject(receipt + ("mutationId" to JsonPrimitive(activeId)))
            assertThrows(IllegalArgumentException::class.java) { FacetRetainedActions.retirement(schema, retired, outcome(id, "applied", foreignReceipt)) }
            val foreignParkedReceipt = JsonObject(parkedReceipt + ("mutationId" to JsonPrimitive(activeId)))
            assertThrows(IllegalArgumentException::class.java) { FacetRetainedActions.retirement(schema, retired, outcome(id, "parked", foreignParkedReceipt)) }
            val activeDraft = drafts.single { it.mutationId == activeId }
            assertThrows(FacetActionError::class.java) { FacetRetainedActions.retirement(schema, activeDraft, outcome(activeId, "applied", foreignReceipt)) }
            val after = FacetMutationDrafts(directory).pending()
            assertEquals(2, after.size)
            assertEquals(active, after.single { it.mutationId == activeId }.mutation)
            org.junit.Assert.assertArrayEquals(before, directory.resolve("$id.json").readBytes())
        } finally { directory.deleteRecursively() }
    }

    @Test fun onlyObservedOrphansAreEligibleForRestartCleanup() {
        val directory = Files.createTempDirectory("facet-observed-cleanup").toFile()
        try {
            val observed = UUID.randomUUID().toString()
            val uncertain = UUID.randomUUID().toString()
            directory.resolve("$observed.observed").writeText("""{"schemaVersion":1,"mutationId":"$observed","profileId":"vault"}""")
            directory.resolve("$observed.payload").writeBytes(byteArrayOf(1))
            directory.resolve("$uncertain.payload").writeBytes(byteArrayOf(2))
            val drafts = FacetMutationDrafts(directory)
            assertEquals(listOf(observed), drafts.observedOrphans())
            assertEquals(emptyList<PendingFacetMutation>(), drafts.pending())
        } finally { directory.deleteRecursively() }
    }
    @Test fun restartDiscoversUnknownActionIdAndPreservesOwningEnvelope() {
        val directory = Files.createTempDirectory("facet-action-recovery").toFile()
        try {
            val id = UUID.randomUUID().toString()
            val mutation = buildJsonObject {
                put("schemaVersion", 1); put("mutationId", id); put("at", "2026-10-03T23:59:59Z")
                put("executionContext", buildJsonObject { put("today", "2026-10-03"); put("timezone", "America/Los_Angeles") })
                put("command", buildJsonObject { put("kind", "create"); put("properties", buildJsonObject { put("title", "Recover draft") }) })
            }
            // The fixture represents a record fsynced before an ambiguous core response.
            directory.resolve("$id.json").writeText(buildJsonObject { put("profileId", "owning-vault"); put("mutation", mutation) }.toString())
            val reopened = FacetMutationDrafts(directory)
            val discovered = reopened.pending().single()
            assertEquals("owning-vault", discovered.profileId)
            assertEquals(id, discovered.mutationId)
            assertEquals(mutation, reopened.envelope(discovered.profileId, discovered.mutationId, mutation.getValue("command").jsonObject, "2026-10-05T00:00:00Z"))
            assertEquals(emptyList<PendingFacetMutation>(), reopened.pending("another-vault"))
        } finally { directory.deleteRecursively() }
    }

    @Test fun recoveryRejectsMisnamedAndSymlinkRecords() {
        val directory = Files.createTempDirectory("facet-action-invalid").toFile()
        try {
            val id = UUID.randomUUID().toString()
            val path = directory.resolve("$id.json").toPath()
            Files.writeString(path, """{"profileId":"vault","mutation":{"mutationId":"${UUID.randomUUID()}"}}""")
            assertThrows(IllegalArgumentException::class.java) { FacetMutationDrafts(directory).pending() }
            Files.delete(path)
            Files.createSymbolicLink(path, directory.resolve("outside.json").toPath())
            assertThrows(java.io.IOException::class.java) { FacetMutationDrafts(directory).pending() }
        } finally { directory.deleteRecursively() }
    }

    @Test fun retainedBinaryPayloadIsImmutableAndBoundedAfterReopen() {
        val directory = Files.createTempDirectory("facet-binary-recovery").toFile()
        try {
            val id = UUID.randomUUID().toString()
            val bytes = byteArrayOf(0, -1, 17, 42)
            val hash = java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            directory.resolve("$id.payload").writeBytes(bytes)
            directory.resolve("$id.payload-meta").writeText("""{"deleted":false,"size":4,"revision":"$hash"}""")
            val reopened = FacetMutationDrafts(directory)
            reopened.openPayload(id, 4uL).use { payload -> org.junit.Assert.assertArrayEquals(bytes, requireNotNull(payload).read(0uL, 4)) }
            assertThrows(IllegalArgumentException::class.java) { reopened.openPayload(id, 3uL) }
            assertThrows(FacetActionError::class.java) { reopened.preparePayload(id, byteArrayOf(1)) }
            val deleted = UUID.randomUUID().toString()
            directory.resolve("$deleted.payload-meta").writeText("""{"deleted":true,"size":0,"revision":null}""")
            assertEquals(null, reopened.openPayload(deleted, 4uL))
        } finally { directory.deleteRecursively() }
    }
}
