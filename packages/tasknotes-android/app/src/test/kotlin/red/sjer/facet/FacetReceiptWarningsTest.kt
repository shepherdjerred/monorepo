package red.sjer.facet

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import red.sjer.facet.host.FacetNoticeOwner
import red.sjer.facet.host.FacetReceiptWarnings
import red.sjer.facet.host.FacetSchema
import red.sjer.facet.host.FacetReceiptContractException

class FacetReceiptWarningsTest {
    private fun resource(name: String): String = requireNotNull(javaClass.classLoader?.getResourceAsStream(name)).bufferedReader().use { it.readText() }
    private val schema = FacetSchema(resource("schema/facet-engine.schema.json"))

    @Test fun frozenRawCasesValidateWholeReceiptAndIdentityBeforeWarnings() {
        val cases = Json.parseToJsonElement(resource("receiptwarnings/strict-raw-receipts.json")).jsonObject.getValue("cases").jsonArray
        assertEquals(26, cases.size)
        for (case in cases.map { it.jsonObject }) {
            val owner = FacetNoticeOwner("profile", case.getValue("expectedMutationId").jsonPrimitive.content, 7, 9)
            val accepted = case.getValue("accepted").jsonPrimitive.boolean
            try {
                val notice = FacetReceiptWarnings.read(schema, case.getValue("receiptJson").jsonPrimitive.content, owner)
                assertTrue("Accepted ${case.getValue("id")}", accepted)
                assertEquals(case.getValue("notice").jsonPrimitive.boolean, notice != null)
                notice?.let {
                    assertEquals("Saved", it.title)
                    for (stale in listOf(owner.copy(profileId="other"), owner.copy(mutationId="other"), owner.copy(requestGeneration=8), owner.copy(engineGeneration=10))) {
                        assertFalse(it.belongsTo(stale))
                    }
                }
            } catch (invalid: FacetReceiptContractException) {
                if (accepted) throw invalid
            }
        }
    }

    @Test fun actualSqliteReplayReceiptUsesFixedSavedWarningCopy() {
        val notice = requireNotNull(FacetReceiptWarnings.read(schema, resource("receiptwarnings/actual-receipt-warning.json"), FacetNoticeOwner("profile", "durable-warning", 7, 9)))
        assertEquals("Saved", notice.title)
        assertEquals(listOf("The task was saved without the configured template.", "Facet shortened the filename and kept the full title."), notice.messages)
    }
}
