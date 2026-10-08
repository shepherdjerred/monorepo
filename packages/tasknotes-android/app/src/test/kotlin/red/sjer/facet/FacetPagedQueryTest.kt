package red.sjer.facet

import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class FacetPagedQueryTest {
    @Test fun pagesKeepOneClockAcrossMidnightAndRejectAnotherOwnerOrGeneration() {
        val clock = AdvancingClock()
        val frozen = FacetPagedQuery.capture("original-vault", 7, FacetQuery(text = "exact", statuses = listOf("custom status")), null, clock, ZoneOffset.UTC)
        val first = frozen.page()
        val second = frozen.page(100, 1000)
        assertEquals(1, clock.reads)
        assertEquals("2026-10-03", second.getValue("today").jsonPrimitive.content)
        assertEquals("2026-10-03T23:59:00Z", second.getValue("at").jsonPrimitive.content)
        assertEquals(first.filterKeys { it != "offset" && it != "limit" }, second.filterKeys { it != "offset" && it != "limit" })
        assertEquals(100, second.getValue("offset").jsonPrimitive.int)
        assertEquals(1000, second.getValue("limit").jsonPrimitive.int)
        assertTrue(frozen.owns("original-vault", 7))
        assertFalse(frozen.owns("same-path-other-vault", 7))
        assertFalse(frozen.owns("original-vault", 8))
        val refreshed = FacetPagedQuery.capture("original-vault", 8, FacetQuery(), null, clock, ZoneOffset.UTC)
        assertEquals("2026-10-04", refreshed.page().getValue("today").jsonPrimitive.content)
        assertEquals(2, clock.reads)
    }

    @Test fun savedQueryAndOpenVendorValuesRemainFrozenWhileOnlyPageBoundsChange() {
        val saved = Json.parseToJsonElement("""{"schemaVersion":1,"scope":"all","statuses":["client-approved"],"vendor":{"exact":9007199254740993},"today":"stale","at":"2020-01-01T00:00:00Z"}""").jsonObject
        val frozen = FacetPagedQuery.capture("vault", 1, FacetQuery(text = "reviewed"), saved, Clock.fixed(Instant.parse("2026-10-04T01:00:00Z"), ZoneOffset.UTC), ZoneId.of("America/Los_Angeles"))
        val next = frozen.page(200)
        assertEquals("2026-10-03", next.getValue("today").jsonPrimitive.content)
        assertEquals("2026-10-04T01:00:00Z", next.getValue("at").jsonPrimitive.content)
        assertEquals("reviewed", next.getValue("text").jsonPrimitive.content)
        assertEquals(saved.getValue("vendor"), next.getValue("vendor"))
        assertEquals(saved.getValue("statuses"), next.getValue("statuses"))
        assertEquals("stale", saved.getValue("today").jsonPrimitive.content)
    }

    private class AdvancingClock : Clock() {
        var reads = 0; private set
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = Clock.fixed(instant(), zone)
        override fun instant(): Instant = Instant.parse("2026-10-03T23:59:00Z").plusSeconds(86400L * reads++)
    }
}
