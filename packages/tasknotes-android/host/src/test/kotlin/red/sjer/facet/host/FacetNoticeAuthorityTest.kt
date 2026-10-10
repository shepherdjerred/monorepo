package red.sjer.facet.host

import org.junit.Assert.*
import org.junit.Test

class FacetNoticeAuthorityTest {
    @Test fun alreadyAssignedAndQueuedSavedAreInvalidatedByNewAdmissionAndClose() {
        for (action in listOf("query", "view", "refresh", "account", "remove", "lifecycle", "invalid-edit")) {
            val authority = FacetNoticeAuthority(); var visible: String? = null
            val originalAdmission = authority.begin(); val original = authority.capture(originalAdmission, "p", "old")
            assertTrue(authority.publishIfOwned(original, "p") { visible = "Saved" }); assertEquals("Saved", visible)
            val next = authority.begin { visible = null }; assertNull(action, visible)
            assertFalse(authority.publishIfOwned(original, "p") { visible = "stale" })
            val queued = authority.capture(originalAdmission, "p", "queued")
            assertFalse(authority.publishIfOwned(queued, "p") { visible = "stale" })
            val current = authority.capture(next, "p", "new")
            assertFalse(authority.publishIfOwned(current, "q") { visible = "foreign" })
            assertTrue(authority.publishIfOwned(current, "p") { visible = "Saved" })
            authority.close { visible = null }; assertNull(visible)
            assertFalse(authority.publishIfOwned(current, "p") { visible = "closed" })
            assertThrows(IllegalStateException::class.java) { authority.begin() }
        }
    }
}
