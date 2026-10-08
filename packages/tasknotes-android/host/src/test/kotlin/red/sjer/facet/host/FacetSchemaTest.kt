package red.sjer.facet.host

import kotlinx.serialization.json.*
import org.junit.Assert.assertEquals
import org.junit.Test

class FacetSchemaTest {
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
        for (entry in corpus.getValue("cases").jsonArray) {
            val test = entry.jsonObject
            val accepted = runCatching { schema.validate(test.getValue("definition").jsonPrimitive.content, test.getValue("value")) }.isSuccess
            assertEquals(test.getValue("id").jsonPrimitive.content, test.getValue("valid").jsonPrimitive.boolean, accepted)
        }
    }
}
