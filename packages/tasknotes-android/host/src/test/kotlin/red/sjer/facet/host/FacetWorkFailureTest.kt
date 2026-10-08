package red.sjer.facet.host

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.async
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class FacetWorkFailureTest {
    @Test fun corruptTrackingCannotAssignOrBecomeSavedMaintenance() = runBlocking {
        val loader = requireNotNull(javaClass.classLoader)
        val schema = FacetSchema(requireNotNull(loader.getResourceAsStream("schema/facet-engine.schema.json")).bufferedReader().use { it.readText() })
        val capture = FacetRawJson.parseObject(requireNotNull(loader.getResourceAsStream("tracking-capture-v2.json")).bufferedReader().use { it.readText() })
        val raw = capture.getValue("cases").jsonArray.first().jsonObject.getValue("historyPagesRaw").jsonArray.first().jsonPrimitive.content
        val valid = FacetRawJson.parseObject(raw)
        val owner = FacetTrackingOwner(valid.getValue("profileId").jsonPrimitive.content, 1uL, valid.getValue("at").jsonPrimitive.content, 7, 9, valid.getValue("taskPath").jsonPrimitive.content, valid.getValue("taskRevision").jsonPrimitive.content)
        var assigned: FacetTrackingPage? = null
        val failure = runCatching {
            val page = FacetTrackingReader.readPage(schema, owner, null) { _, _ -> JsonObject(valid.toMutableMap().apply { put("version", JsonPrimitive(2)) }) }
            assigned = page
        }.exceptionOrNull()
        assertNull(assigned)
        assertTrue(failure is FacetTrackingContractException)
        val contract = failure as FacetTrackingContractException
        for (applied in listOf(false, true)) {
            val propagated = assertThrows(FacetTrackingContractException::class.java) { FacetWorkFailure.present(contract, applied, true) }
            assertSame(contract, propagated)
        }
    }

    @Test fun expectedProviderStorageAndOwnAppliedObservationRemainUseful() {
        val failure = java.io.IOException("component storage failure")
        assertEquals("Saved. Refresh the vault to update the list.", FacetWorkFailure.present(failure, true, true))
        assertEquals("Facet could not access private storage. Check available storage before retrying.", FacetWorkFailure.present(failure, false, true))
        assertEquals("Review this note.", FacetWorkFailure.present(FacetActionError("Review this note."), false, true))
    }

    @Test fun delayedContractFailuresAreFencedBeforeClassification() = runBlocking {
        for (contract in listOf(FacetTrackingContractException("corrupt tracking"), FacetReceiptContractException("corrupt receipt"))) {
            val authority = FacetNoticeAuthority()
            val ticket = authority.begin()
            val owner = authority.capture(ticket, "p", "mutation")
            val waiting = kotlinx.coroutines.CompletableDeferred<Unit>()
            val release = kotlinx.coroutines.CompletableDeferred<Unit>()
            val result = async {
                waiting.complete(Unit)
                release.await()
                FacetWorkFailure.present(contract, true, authority.isCurrent(ticket) && authority.owns(owner, "p"))
            }
            waiting.await()
            authority.begin()
            release.complete(Unit)
            assertNull(result.await())
            val currentTicket = authority.begin()
            val currentOwner = authority.capture(currentTicket, "p", "current")
            assertNull(FacetWorkFailure.present(contract, false, authority.isCurrent(currentTicket) && authority.owns(currentOwner, "other")))
            val current = authority.isCurrent(currentTicket) && authority.owns(currentOwner, "p")
            assertSame(contract, assertThrows(contract.javaClass) { FacetWorkFailure.present(contract, false, current) })
            authority.close()
            assertNull(FacetWorkFailure.present(contract, true, authority.isCurrent(currentTicket)))
        }
    }

    @Test fun cancellationStillPropagatesWhenTheOwnerIsStale() {
        val cancelled = kotlinx.coroutines.CancellationException("component cancelled")
        assertSame(cancelled, assertThrows(kotlinx.coroutines.CancellationException::class.java) { FacetWorkFailure.present(cancelled, false, false) })
        assertNull(FacetWorkFailure.present(java.io.IOException("old failure"), true, false))
    }
}
