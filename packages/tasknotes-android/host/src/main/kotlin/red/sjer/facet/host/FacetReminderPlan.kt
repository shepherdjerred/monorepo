package red.sjer.facet.host

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.json.*

data class FacetReminderWindow(val at: String, val timezone: String, val from: String, val to: String)
data class FacetReminderRow(val notificationId: String, val profileId: String, val taskPath: String, val title: String, val fireAt: String, val occurrenceDate: String?, val description: String?)
data class FacetReminderPlan(val profileId: String, val version: ULong, val totalCount: ULong, val rows: List<FacetReminderRow>, val problemCount: ULong)

/** Validated core pages own eligibility and ordering. Never replace with a partial plan. */
internal object FacetReminderPlanReader {
    suspend fun read(profileId: String, window: FacetReminderWindow, maximumRows: Int, fetch: suspend (JsonObject) -> JsonObject): FacetReminderPlan {
        require(maximumRows in 0..128)
        var version: ULong? = null
        var total: ULong? = null
        var problems: ULong? = null
        var seen = 0uL
        var cursor: JsonObject? = null
        val retained = mutableListOf<FacetReminderRow>()
        while (true) {
            currentCoroutineContext().ensureActive()
            val request = buildJsonObject {
                put("schemaVersion", 1); put("kind", "reminder_plan")
                put("at", window.at); put("timezone", window.timezone); put("from", window.from); put("to", window.to); put("limit", 128)
                cursor?.let { put("after", it); put("expectedVersion", JsonPrimitive(requireNotNull(version))) }
            }
            val page = fetch(request)
            FacetContract.validateVersion(page)
            require(page.getValue("profileId").jsonPrimitive.content == profileId) { "The reminder plan belongs to another vault." }
            val pageVersion = page.getValue("version").jsonPrimitive.content.toULong()
            val pageTotal = page.getValue("totalCount").jsonPrimitive.content.toULong()
            val pageProblems = page.getValue("problemCount").jsonPrimitive.content.toULong()
            require(version == null || version == pageVersion && total == pageTotal && problems == pageProblems) { "The reminder plan changed while paging." }
            version = pageVersion; total = pageTotal; problems = pageProblems
            val rows = page.getValue("rows").jsonArray
            require(rows.size <= 128 && rows.map { it.jsonObject.getValue("notificationId").jsonPrimitive.content }.distinct().size == rows.size)
            seen += rows.size.toULong()
            retained += rows.take(maximumRows - retained.size).map { raw ->
                val row = raw.jsonObject
                FacetReminderRow(row.getValue("notificationId").jsonPrimitive.content, profileId,
                    row.getValue("taskPath").jsonPrimitive.content, row.getValue("title").jsonPrimitive.content,
                    row.getValue("fireAt").jsonPrimitive.content, row.getValue("occurrenceDate").jsonPrimitive.contentOrNull,
                    row.getValue("description").jsonPrimitive.contentOrNull)
            }
            val next = page.getValue("nextCursor")
            if (next == JsonNull) {
                require(seen == total) { "The complete reminder plan has an inconsistent count." }
                return FacetReminderPlan(profileId, pageVersion, pageTotal, retained.toList(), pageProblems)
            }
            val last = rows.last().jsonObject
            val expected = buildJsonObject { for (key in listOf("fireAt", "reminderId", "taskPath")) put(key, last.getValue(key)) }
            require(next.jsonObject == expected && next != cursor) { "The reminder plan cursor did not advance." }
            cursor = next.jsonObject
        }
    }
}
