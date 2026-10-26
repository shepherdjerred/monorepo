package red.sjer.facet

import java.security.MessageDigest
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import red.sjer.facet.host.VaultTask
import red.sjer.facet.host.FacetDependencyEditor

class FacetDependencyEditorTest {
    private val dependencies = Json.parseToJsonElement("""[{"uid":"[[Tasks/first, task|Keep alias]]","reltype":"STARTTOSTART","gap":"-PT15M","vendor":{"integer":9007199254740993,"tags":["a,b"]}},{"uid":"[[Tasks/second]]","reltype":"FINISHTOFINISH","vendor":true}]""").jsonArray
    private fun task(value: JsonElement? = dependencies): VaultTask {
        val properties = buildJsonObject {
            put("title", "Dependency subject"); put("status", "open"); put("priority", "normal")
            value?.let { put("blockedBy", it) }
            put("externalNumber", Json.parseToJsonElement("9007199254740993"))
        }
        return VaultTask("subject", "Tasks/subject.md", "Dependency subject", "open", "normal", false, "a".repeat(64), properties, "Body", false, false, false, null, null, false)
    }

    @Test fun openingAndEditingOtherFieldsNeverRewritesDependencyMetadata() {
        for (value in listOf(null, JsonNull, JsonPrimitive("legacy raw"), buildJsonObject { put("vendor", true) }, dependencies)) {
            val original = task(value)
            val draft = TaskEditorDraft.from(original)
            val changes = draft.copy(body = "Only body").command(original).getValue("properties").jsonObject
            assertFalse(changes.containsKey("blockedBy"))
            if (value is JsonArray) assertEquals(value, Json.parseToJsonElement(draft.blockedBy))
        }
    }

    @Test fun changingOneReferencePreservesItsRelationshipGapVendorAndSiblingOrder() {
        val original = task()
        val draft = TaskEditorDraft.from(original)
        val changed = editDependencyField(Json.parseToJsonElement(draft.blockedBy).jsonArray, 0, "uid", "[[Tasks/new, reference|Alias]]")
        val props = draft.copy(blockedBy = changed.toString()).command(original).getValue("properties").jsonObject
        assertEquals(setOf("blockedBy"), props.keys)
        val first = props.getValue("blockedBy").jsonArray[0].jsonObject
        assertEquals(JsonPrimitive("[[Tasks/new, reference|Alias]]"), first.getValue("uid"))
        assertEquals(dependencies[0].jsonObject.filterKeys { it != "uid" }, first.filterKeys { it != "uid" })
        assertEquals(dependencies[1], props.getValue("blockedBy").jsonArray[1])
        assertEquals("9007199254740993", first.getValue("vendor").jsonObject.getValue("integer").toString())
    }

    @Test fun addingAReferenceRequiresAnExplicitRelationshipAndSerializesObjects() {
        val original = task(JsonArray(emptyList()))
        val added = addDependency(JsonArray(emptyList()), FacetDependencyEditor(listOf("STARTTOFINISH"), null))
        assertEquals("", added.single().jsonObject.getValue("reltype").jsonPrimitive.content)
        val referenced = editDependencyField(added, 0, "uid", "[[Tasks/new]]")
        val selected = editDependencyField(referenced, 0, "reltype", "STARTTOFINISH")
        val changes = TaskEditorDraft.from(original).copy(blockedBy = selected.toString()).command(original).getValue("properties").jsonObject
        assertEquals(Json.parseToJsonElement("""[{"uid":"[[Tasks/new]]","reltype":"STARTTOFINISH"}]"""), changes.getValue("blockedBy"))
    }

    @Test fun addingUsesOnlyTheCoreConfiguredDefaultAndKeepsExistingRelationships() {
        val selected = addDependency(dependencies, FacetDependencyEditor(listOf("STARTTOSTART", "FINISHTOFINISH"), "FINISHTOFINISH"))
        assertEquals(dependencies, JsonArray(selected.dropLast(1)))
        assertEquals("FINISHTOFINISH", selected.last().jsonObject.getValue("reltype").jsonPrimitive.content)
        val absent = addDependency(dependencies, FacetDependencyEditor(listOf("FINISHTOFINISH"), null))
        assertEquals("", absent.last().jsonObject.getValue("reltype").jsonPrimitive.content)
    }

    @Test fun removingAnOptionalGapOrOneEntryPreservesEveryOtherValue() {
        val withoutGap = editDependencyField(dependencies, 0, "gap", "")
        assertEquals(dependencies[0].jsonObject.filterKeys { it != "gap" }, withoutGap[0].jsonObject)
        assertEquals(dependencies[1], withoutGap[1])
        assertEquals(JsonArray(listOf(dependencies[1])), removeDependency(dependencies, 0))
        val unsupported = JsonArray(listOf(JsonPrimitive("legacy raw")) + dependencies)
        assertEquals(unsupported[0], editDependencyField(unsupported, 1, "gap", "PT2H")[0])
        assertEquals(dependencies[1], editDependencyField(unsupported, 1, "gap", "PT2H")[2])
    }

    @Test fun nonemptyRealHostSerializerPacketRetainsStructuredMetadata() {
        val original = task()
        val created = "2020-01-01T00:00:00Z"
        val note = "---\ntitle: Dependency subject\nstatus: open\npriority: normal\ntags: [task]\nid: subject\ndateCreated: $created\ndateModified: $created\nblockedBy: ${dependencies}\nexternalNumber: 9007199254740993\n---\nBody\n"
        val revision = MessageDigest.getInstance("SHA-256").digest(note.toByteArray()).joinToString("") { "%02x".format(it) }
        val basis = original.copy(revision = revision, properties = JsonObject(original.properties + mapOf(
            "dateCreated" to JsonPrimitive(created), "dateModified" to JsonPrimitive(created),
            "tags" to JsonArray(listOf(JsonPrimitive("task"))), "id" to JsonPrimitive("subject"))))
        val changed = editDependencyField(dependencies, 0, "uid", "[[Tasks/new, reference|Alias]]")
        val command = TaskEditorDraft.from(basis).copy(blockedBy = changed.toString()).command(basis)
        assertEquals(revision, command.getValue("expectedRevision").jsonPrimitive.content)
        assertEquals(changed, command.getValue("properties").jsonObject.getValue("blockedBy"))
        // Synthetic exact production-serializer output for the separate native-backed Rust acceptance probe.
        println("FACET_ANDROID_DEPENDENCY_PACKET " + buildJsonObject {
            put("schemaVersion", 1); put("path", basis.path); put("note", note); put("command", command)
        })
    }
}
