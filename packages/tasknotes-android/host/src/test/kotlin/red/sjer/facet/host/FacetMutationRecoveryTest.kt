package red.sjer.facet.host

import java.nio.file.Files
import java.util.UUID
import kotlinx.serialization.json.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class FacetMutationRecoveryTest {
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
