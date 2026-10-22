package red.sjer.facet.host

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class FacetReminderPlanTest {
    private val window = FacetReminderWindow("2026-10-04T08:00:00Z", "America/Los_Angeles", "2026-10-04T08:00:00Z", "2026-11-03T08:00:00Z")

    @Test fun pagesStayFencedAndRetainOnlyTheNativeBudget() = runBlocking {
        val pages = ArrayDeque(listOf(page("vault", 7, (0..127).toList(), 129, true), page("vault", 7, listOf(128), 129, false)))
        val requests = mutableListOf<JsonObject>()
        val plan = FacetReminderPlanReader.read("vault", window, 64) { request -> requests.add(request); pages.removeFirst() }
        assertEquals(129uL, plan.totalCount)
        assertEquals(64, plan.rows.size)
        assertEquals(JsonPrimitive(7uL), requests[1]["expectedVersion"])
        assertEquals(requests[0]["at"], requests[1]["at"])
        assertEquals(JsonPrimitive(1), requests[0]["schemaVersion"])
    }

    @Test fun anotherOwnerOrChangedVersionCannotReplaceAnExistingPlan() = runBlocking {
        for (next in listOf(page("other", 7, listOf(1), 2, false), page("vault", 8, listOf(1), 2, false))) {
            val pages = ArrayDeque(listOf(page("vault", 7, listOf(0), 2, true), next))
            try {
                FacetReminderPlanReader.read("vault", window, 64) { pages.removeFirst() }
                fail("A partial or mismatched plan must fail before OS replacement.")
            } catch (_: IllegalArgumentException) { assertTrue(pages.isEmpty()) }
        }
    }

    @Test fun laterPageFailureDoesNotReturnEarlierRows() = runBlocking {
        var fetched = 0
        try {
            FacetReminderPlanReader.read("vault", window, 64) {
                fetched++
                if (fetched == 2) throw IllegalStateException("changed cached configuration")
                page("vault", 7, listOf(0), 2, true)
            }
            fail("A partial plan cannot replace existing OS requests.")
        } catch (_: IllegalStateException) { assertEquals(2, fetched) }
    }

    private fun page(profile: String, version: Int, indices: List<Int>, total: Int, more: Boolean): JsonObject {
        val rows = indices.map { index -> buildJsonObject {
            put("notificationId", "facet:${index.toString().padStart(64, '0')}")
            put("taskPath", "task-$index.md"); put("title", "Task $index"); put("taskRevision", "a".repeat(64))
            put("reminderId", "r-$index"); put("fireAt", "2026-10-04T09:00:00Z"); put("occurrenceDate", JsonNull); put("description", JsonNull)
        } }
        return buildJsonObject {
            put("schemaVersion", 1); put("profileId", profile); put("version", version); put("totalCount", total)
            put("rows", JsonArray(rows)); put("problemCount", 0); put("problems", JsonArray(emptyList()))
            put("nextCursor", if (more) buildJsonObject { for (key in listOf("fireAt", "reminderId", "taskPath")) put(key, rows.last().getValue(key)) } else JsonNull)
        }
    }
}
