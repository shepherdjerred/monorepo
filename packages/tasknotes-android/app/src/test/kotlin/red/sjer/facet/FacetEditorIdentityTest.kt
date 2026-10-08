package red.sjer.facet

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import red.sjer.facet.host.VaultTask

class FacetEditorIdentityTest {
    @Test fun restoredEditorKeepsOriginalOwnerRevisionAndExactUnknownProperties() {
        val properties = Json.parseToJsonElement("""{"timeEstimate":19.1234567890123456789,"vendor":{"large":9007199254740993,"exponent":1.234567890123456789e20,"nullable":null},"reminders":"legacy-invalid-value"}""").jsonObject
        val original = VaultTask("Tasks/shared.md", "Tasks/shared.md", "Original", "custom status", "P0 client", false,
            "a".repeat(64), properties, "Original body\n", true, true, false, true, ULong.MAX_VALUE, "2026-10-04", null, true)
        val restored = restoreEditorIdentity(saveEditorIdentity("original-vault" to original))
        assertEquals("original-vault", restored.first)
        assertEquals(original, restored.second)
        assertEquals(properties.toString(), restored.second.properties.toString())
        assertNotEquals("other-vault", restored.first)
        val command = TaskEditorDraft.from(restored.second).copy(body = "My still-unsaved draft").command(restored.second)
        assertEquals(original.path, command.getValue("path").jsonPrimitive.content)
        assertEquals(original.revision, command.getValue("expectedRevision").jsonPrimitive.content)
        assertTrue(command.getValue("properties").jsonObject.isEmpty())
    }

    @Test fun malformedRestorationDoesNotSubstituteNewOwnerOrLatestRevision() {
        assertThrows(IllegalArgumentException::class.java) { restoreEditorIdentity(emptyList()) }
        assertThrows(IllegalArgumentException::class.java) { restoreEditorIdentity(List(18) { "" }) }
        assertThrows(IllegalArgumentException::class.java) { restoreTaskBasis(emptyList()) }
    }
}
