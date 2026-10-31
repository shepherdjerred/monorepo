package red.sjer.facet.host

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class FacetDependencyMetadataTest {
    private val loader = requireNotNull(javaClass.classLoader)
    private val schema = FacetSchema(requireNotNull(loader.getResourceAsStream("schema/facet-engine.schema.json")).bufferedReader().use { it.readText() })
    private fun metadata(default: JsonElement = JsonNull) = buildJsonObject {
        put("schemaVersion", 1)
        put("relationshipTypes", Json.parseToJsonElement("""["FINISHTOSTART","STARTTOSTART","FINISHTOFINISH","STARTTOFINISH"]"""))
        put("defaultReltype", default)
    }

    @Test fun existingFeatureBoundaryAcceptsTheCoreDependencyEditorRequest() {
        schema.validate("featureRequest", buildJsonObject { put("schemaVersion", 1); put("kind", "dependency_editor") })
    }

    @Test fun coreChoicesAndNullableConfiguredDefaultAreNeverSubstituted() {
        val absent = FacetDependencyEditor.parse(schema, metadata())
        assertEquals(listOf("FINISHTOSTART", "STARTTOSTART", "FINISHTOFINISH", "STARTTOFINISH"), absent.relationshipTypes)
        assertNull(absent.defaultReltype)
        val configured = FacetDependencyEditor.parse(schema, metadata(JsonPrimitive("STARTTOSTART")))
        assertEquals("STARTTOSTART", configured.defaultReltype)
        assertEquals(absent.relationshipTypes, configured.relationshipTypes)
    }

    @Test fun missingUnknownOrMalformedMetadataFailsTheStrictSharedContract() {
        val valid = metadata()
        val invalid = listOf(
            JsonObject(valid - "defaultReltype"), JsonObject(valid - "relationshipTypes"),
            JsonObject(valid + ("defaultReltype" to JsonPrimitive("FS"))),
            JsonObject(valid + ("defaultReltype" to JsonPrimitive(""))),
            JsonObject(valid + ("schemaVersion" to JsonPrimitive(2))),
            JsonObject(valid + ("relationshipTypes" to JsonArray(listOf(JsonPrimitive("BLOCKS"))))),
            JsonObject(valid + ("unexpected" to JsonPrimitive(true))),
        )
        for (document in invalid) assertThrows(IllegalArgumentException::class.java) { FacetDependencyEditor.parse(schema, document) }
    }

    @Test fun everySharedDependencyEditorBoundaryIsValidatedAndParsed() {
        val corpus = Json.parseToJsonElement(requireNotNull(loader.getResourceAsStream("vault/facet-dependency-editor-contract.json")).bufferedReader().use { it.readText() }).jsonObject
        val cases = corpus.getValue("cases").jsonArray
        assertEquals(13, cases.size)
        val seen = mutableSetOf<String>()
        for (entry in cases) {
            val test = entry.jsonObject
            val id = test.getValue("id").jsonPrimitive.content
            assertTrue(id, seen.add(id))
            val definition = test.getValue("definition").jsonPrimitive.content
            val value = test.getValue("value")
            val accepted = runCatching { schema.validate(definition, value) }.isSuccess
            assertEquals(id, test.getValue("valid").jsonPrimitive.boolean, accepted)
            if (accepted && definition == "dependencyEditor") FacetDependencyEditor.parse(schema, value.jsonObject)
        }
    }
}
