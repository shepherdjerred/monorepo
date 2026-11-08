package red.sjer.facet.host

import kotlinx.serialization.json.*
import org.junit.Assert.assertEquals
import org.junit.Test

class FacetSchemaTest {
    @Test fun everySharedAgendaExecutionAndSelectionBoundaryIsValidated() {
        val loader = requireNotNull(javaClass.classLoader)
        val schema = FacetSchema(requireNotNull(loader.getResourceAsStream("schema/facet-engine.schema.json")).bufferedReader().use { it.readText() })
        val corpus = Json.parseToJsonElement(requireNotNull(loader.getResourceAsStream("vault/facet-agenda-contract.json")).bufferedReader().use { it.readText() }).jsonObject
        val cases = corpus.getValue("cases").jsonArray
        assertEquals(30, cases.size)
        val seen = mutableSetOf<String>()
        for (entry in cases) {
            val test = entry.jsonObject
            val id = test.getValue("id").jsonPrimitive.content
            check(seen.add(id)) { "Duplicate agenda boundary case: $id" }
            val accepted = runCatching { schema.validate(test.getValue("definition").jsonPrimitive.content, test.getValue("value")) }.isSuccess
            assertEquals(id, test.getValue("valid").jsonPrimitive.boolean, accepted)
        }
    }

    @Test fun completeSharedOccurrenceCorpusHasClosedMetadataAndCoverage() {
        val loader = requireNotNull(javaClass.classLoader)
        val schema = FacetSchema(requireNotNull(loader.getResourceAsStream("schema/facet-engine.schema.json")).bufferedReader().use { it.readText() })
        val corpus = Json.parseToJsonElement(requireNotNull(loader.getResourceAsStream("vault/facet-occurrence-contract.json")).bufferedReader().use { it.readText() }).jsonObject
        assertEquals(setOf("schemaVersion", "definitions", "cases"), corpus.keys)
        assertEquals(JsonPrimitive(1), corpus.getValue("schemaVersion"))
        val definitions = setOf("featureRequest", "command", "occurrenceSuccessors", "rollingMaintenancePlan", "generationFailuresPlan")
        assertEquals(definitions, corpus.getValue("definitions").jsonArray.map { it.jsonPrimitive.content }.toSet())
        assertEquals(definitions.size, corpus.getValue("definitions").jsonArray.size)
        val seen = mutableSetOf<String>(); val coverage = mutableSetOf<Pair<String, Boolean>>()
        val cases = corpus.getValue("cases").jsonArray
        assertEquals(117, cases.size)
        for (entry in cases) {
            val test = entry.jsonObject
            assertEquals(setOf("id", "definition", "valid", "value"), test.keys)
            val id = test.getValue("id").jsonPrimitive.content
            check(seen.add(id)) { "Duplicate neutral occurrence case: $id" }
            val definition = test.getValue("definition").jsonPrimitive.content
            check(definition in definitions) { "Unknown neutral occurrence definition: $definition" }
            val valid = test.getValue("valid").jsonPrimitive.boolean
            val accepted = runCatching { schema.validate(definition, test.getValue("value")) }.isSuccess
            assertEquals(id, valid, accepted)
            coverage += definition to valid
            if (valid) {
                val value = test.getValue("value").jsonObject
                when (definition) {
                    "occurrenceSuccessors" -> FacetOccurrences.successors(schema, value, value.getValue("mutationId").jsonPrimitive.content)
                    "rollingMaintenancePlan" -> FacetOccurrences.rolling(schema, value, value.getValue("profileId").jsonPrimitive.content, value.getValue("referenceDate").jsonPrimitive.content)
                    "generationFailuresPlan" -> FacetOccurrences.failures(schema, value, value.getValue("profileId").jsonPrimitive.content)
                }
            }
        }
        assertEquals(definitions.flatMap { listOf(it to true, it to false) }.toSet(), coverage)
    }
    @Test fun retainedPrivateActionCorpusIsSeparateFromPublicCommands() {
        val loader = requireNotNull(javaClass.classLoader)
        val schema = FacetSchema(requireNotNull(loader.getResourceAsStream("schema/facet-engine.schema.json")).bufferedReader().use { it.readText() })
        val corpus = Json.parseToJsonElement(requireNotNull(loader.getResourceAsStream("vault/facet-retained-actions.json")).bufferedReader().use { it.readText() }).jsonObject
        val cases = corpus.getValue("cases").jsonArray
        assertEquals(14, cases.size)
        for (entry in cases) {
            val test = entry.jsonObject
            val mutation = test.getValue("value").jsonObject
            val accepted = runCatching { FacetRetainedActions.validate(schema, mutation) }.isSuccess
            assertEquals(test.getValue("id").jsonPrimitive.content, test.getValue("valid").jsonPrimitive.boolean, accepted)
            if (accepted) {
                assertEquals(false, FacetRetainedActions.canResume(mutation))
                assertEquals(false, runCatching { schema.validate("mutation", mutation) }.isSuccess)
            }
        }
    }
    @Test fun sharedRawNumericContractCorpus() {
        val loader = requireNotNull(javaClass.classLoader)
        val schema = FacetSchema(requireNotNull(loader.getResourceAsStream("schema/facet-engine.schema.json")).bufferedReader().use { it.readText() })
        val corpus = Json.parseToJsonElement(requireNotNull(loader.getResourceAsStream("vault/facet-raw-contract.json")).bufferedReader().use { it.readText() }).jsonObject
        for (entry in corpus.getValue("cases").jsonArray) {
            val test = entry.jsonObject
            val raw = Json.parseToJsonElement(test.getValue("raw").jsonPrimitive.content)
            val accepted = runCatching { schema.validate(test.getValue("definition").jsonPrimitive.content, raw) }.isSuccess
            assertEquals(test.getValue("id").jsonPrimitive.content, test.getValue("valid").jsonPrimitive.boolean, accepted)
        }
    }
    @Test fun sharedPositiveAndNegativeContractCorpus() {
        val loader = requireNotNull(javaClass.classLoader)
        val schema = FacetSchema(requireNotNull(loader.getResourceAsStream("schema/facet-engine.schema.json")).bufferedReader().use { it.readText() })
        val corpus = Json.parseToJsonElement(requireNotNull(loader.getResourceAsStream("vault/facet-contract.json")).bufferedReader().use { it.readText() }).jsonObject
        assertEquals(149, corpus.getValue("cases").jsonArray.size)
        for (entry in corpus.getValue("cases").jsonArray) {
            val test = entry.jsonObject
            val accepted = runCatching { schema.validate(test.getValue("definition").jsonPrimitive.content, test.getValue("value")) }.isSuccess
            assertEquals(test.getValue("id").jsonPrimitive.content, test.getValue("valid").jsonPrimitive.boolean, accepted)
        }
    }
}
