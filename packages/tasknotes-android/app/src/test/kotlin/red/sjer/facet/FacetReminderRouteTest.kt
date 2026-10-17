package red.sjer.facet

import org.junit.Assert.*
import org.junit.Test

class FacetReminderRouteTest {
    @Test fun routeKeepsExactOwnerAndUnicodePathWithoutDependingOnSelectedVault() {
        val route = FacetReminderRoute.parse("tasknotes://reminder?profileId=original%2Bvault&path=Work%2FCaf%C3%A9%20%2B%20Review.md")
        assertEquals("original+vault", route.profileId)
        assertEquals("Work/Café + Review.md", route.path)
        assertNotEquals(FacetReminderRoute("other-vault", route.path), route)
    }

    @Test fun duplicateMissingAndForeignNavigationFieldsAreRejected() {
        listOf(
            "tasknotes://reminder?profileId=one&profileId=two&path=task.md",
            "tasknotes://reminder?profileId=one",
            "tasknotes://reminder?profileId=one&path=task.md&command=delete",
            "tasknotes://reminder?profileId=&path=task.md",
            "tasknotes://reminder?profileId=one&path=%00task.md",
            "tasknotes://reminder/other?profileId=one&path=task.md",
            "https://reminder?profileId=one&path=task.md",
        ).forEach { value -> assertThrows(IllegalArgumentException::class.java) { FacetReminderRoute.parse(value) } }
    }
}
