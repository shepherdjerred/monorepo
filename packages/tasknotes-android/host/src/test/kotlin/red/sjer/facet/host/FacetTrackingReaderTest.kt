package red.sjer.facet.host

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class FacetTrackingReaderTest {
    private fun resource(name: String) = requireNotNull(javaClass.classLoader?.getResourceAsStream(name)).bufferedReader().use { it.readText() }
    private fun schema() = FacetSchema(resource("schema/facet-engine.schema.json"))
    private fun owner(page: JsonObject) = FacetTrackingOwner(page.getValue("profileId").jsonPrimitive.content, page.getValue("version").jsonPrimitive.content.toULong(), page.getValue("at").jsonPrimitive.content, 7, 9, page["taskPath"]?.jsonPrimitive?.content, page["taskRevision"]?.jsonPrimitive?.content)

    @Test fun actualUnicodeSessionsPreserveByteOrderAndDistinctPaths() = runBlocking {
        val capture = FacetRawJson.parseObject(resource("tracking-capture-unicode.json"))
        val pages = capture.getValue("sessionsPagesRaw").jsonArray.map { it.jsonPrimitive.content }
        val original = owner(FacetRawJson.parseObject(pages.first()))
        var calls = 0; var continuation: FacetTrackingContinuation? = null
        val paths = mutableListOf<String>()
        do {
            val page = FacetTrackingReader.readPage(schema(), original, continuation) { _, _ -> FacetRawJson.parseObject(pages[calls++]) }
            assertTrue(page.rows.size <= 128)
            paths.addAll(page.rows.map { it.getValue("taskPath").jsonPrimitive.content }); continuation = page.next
        } while (continuation != null)
        assertEquals(listOf("Tasks/A.md", "Tasks/e\u0301.md", "Tasks/é.md", "Tasks/\uE000.md", "Tasks/\uD800\uDC00.md"), paths)
        assertEquals(3, calls)
    }

    @Test fun continuationMetadataClockTextLastCursorAndOverflowReject() = runBlocking {
        val capture = FacetRawJson.parseObject(resource("tracking-capture-v2.json"))
        val test = capture.getValue("cases").jsonArray.map { it.jsonObject }.single { it.getValue("id").jsonPrimitive.content == "history-130" }
        val rawPages = test.getValue("historyPagesRaw").jsonArray.map { it.jsonPrimitive.content }
        val original = owner(FacetRawJson.parseObject(rawPages.first()))
        val first = FacetTrackingReader.readPage(schema(), original, null) { _, _ -> FacetRawJson.parseObject(rawPages.first()) }
        val continuation = requireNotNull(first.next); val second = FacetRawJson.parseObject(rawPages[1])
        for (change in listOf("total", "problem", "revision", "clock-text", "index", "last-cursor", "no-progress")) {
            val page = second.toMutableMap()
            when (change) {
                "total" -> page["totalCount"] = JsonPrimitive(131)
                "problem" -> { page["problemCount"] = JsonPrimitive(1); page["problems"] = buildJsonArray { add(buildJsonObject { put("taskPath", original.taskPath); put("code", "invalid_time_entries") }) } }
                "revision" -> page["taskRevision"] = JsonPrimitive("a".repeat(64))
                "clock-text" -> page["at"] = JsonPrimitive(original.at.replace("Z", "+00:00"))
                "index" -> { val rows = second.getValue("rows").jsonArray.toMutableList(); rows[0] = JsonObject(rows[0].jsonObject.toMutableMap().apply { put("entryIndex", JsonPrimitive(127)) }); page["rows"] = JsonArray(rows) }
                "last-cursor" -> page["nextCursor"] = continuation.cursor
                "no-progress" -> { page["rows"] = JsonArray(emptyList()); page["nextCursor"] = continuation.cursor }
            }
            assertTrue(change, runCatching { FacetTrackingReader.readPage(schema(), original, continuation) { _, _ -> JsonObject(page) } }.exceptionOrNull() is FacetTrackingContractException)
        }
        val overflow = continuation.copy(seenCount = ULong.MAX_VALUE, totalCount = ULong.MAX_VALUE)
        val page = JsonObject(second.toMutableMap().apply { put("totalCount", JsonPrimitive(ULong.MAX_VALUE)) })
        assertTrue(runCatching { FacetTrackingReader.readPage(schema(), original, overflow) { _, _ -> page } }.exceptionOrNull() is FacetTrackingContractException)
    }

    @Test fun actualEightProducerHistoriesMatchLegacyRoundingAndNanoClock() = runBlocking {
        val capture = FacetRawJson.parseObject(resource("tracking-capture-v2.json"))
        for (item in capture.getValue("cases").jsonArray) {
            val test = item.jsonObject
            val pages = test.getValue("historyPagesRaw").jsonArray.map { it.jsonPrimitive.content }
            val captured = owner(FacetRawJson.parseObject(pages.first()))
            val original = captured.copy(at = captured.at.replace("Z", "+00:00"))
            var calls = 0
            val totals = FacetTrackingReader.readTotals(schema(), original) { profile, request ->
                assertEquals(original.profileId, profile)
                assertEquals(original.at, request.getValue("at").jsonPrimitive.content)
                assertEquals(original.version.toString(), request.getValue("expectedVersion").jsonPrimitive.content)
                FacetRawJson.parseObject(pages[calls++])
            }
            val legacy = FacetRawJson.parseObject(test.getValue("taskTimeRaw").jsonPrimitive.content)
            assertEquals(test.getValue("id").jsonPrimitive.content, legacy.getValue("totalMinutes").jsonPrimitive.content.toULong(), totals.totalMinutes)
            assertEquals(legacy.getValue("hasActiveSession").jsonPrimitive.boolean, totals.hasActiveSession)
            assertEquals(pages.size, calls)
        }
    }

    @Test fun actualSessionPagesKeepOwnersAndRejectForeignBeforeFetch() = runBlocking {
        val capture = FacetRawJson.parseObject(resource("tracking-capture-v2.json"))
        val pages = capture.getValue("sessionsPagesRaw").jsonArray.map { it.jsonPrimitive.content }
        val original = owner(FacetRawJson.parseObject(pages.first()))
        var calls = 0
        val fetch: suspend (String, JsonObject) -> JsonObject = { _, _ -> FacetRawJson.parseObject(pages[calls++]) }
        val first = FacetTrackingReader.readPage(schema(), original, null, fetch)
        assertEquals(2, first.rows.size)
        val continuation = requireNotNull(first.next)
        for (foreign in listOf(original.copy(profileId = "other"), original.copy(version = 2uL), original.copy(at = "2026-10-07T12:00:00.250000002Z"), original.copy(requestGeneration = 8), original.copy(engineGeneration = 8))) {
            assertTrue(runCatching { FacetTrackingReader.readPage(schema(), foreign, continuation, fetch) }.exceptionOrNull() is FacetTrackingContractException)
        }
        assertEquals(1, calls)
        val final = FacetTrackingReader.readPage(schema(), original, continuation, fetch)
        assertEquals(2, final.rows.size); assertNull(final.next); assertEquals(4uL, final.totalCount)
    }

    @Test fun strictRawAndRelationalCorruptionIsRejected() = runBlocking {
        val capture = FacetRawJson.parseObject(resource("tracking-capture-v2.json"))
        val raw = capture.getValue("cases").jsonArray.first().jsonObject.getValue("historyPagesRaw").jsonArray.first().jsonPrimitive.content
        val page = FacetRawJson.parseObject(raw); val original = owner(page)
        for (field in listOf("profileId", "version", "at", "taskPath", "taskRevision", "totalCount", "unknown", "elapsed", "index", "empty")) {
            val changed = page.toMutableMap()
            when (field) {
                "profileId" -> changed[field] = JsonPrimitive("foreign")
                "version" -> changed[field] = JsonPrimitive(2)
                "at" -> changed[field] = JsonPrimitive("2026-10-07T12:00:00.250000002Z")
                "taskPath" -> changed[field] = JsonPrimitive("Tasks/foreign.md")
                "taskRevision" -> changed[field] = JsonPrimitive("a".repeat(64))
                "totalCount" -> changed[field] = JsonPrimitive(999)
                "unknown" -> changed["extra"] = JsonPrimitive(true)
                "elapsed", "index" -> {
                    val rows = page.getValue("rows").jsonArray.toMutableList(); val row = rows.first().jsonObject.toMutableMap()
                    row[if (field == "elapsed") "elapsedSeconds" else "entryIndex"] = JsonPrimitive(if (field == "elapsed") 30 else 1)
                    rows[0] = JsonObject(row); changed["rows"] = JsonArray(rows)
                }
                "empty" -> { changed["rows"] = JsonArray(emptyList()); changed["nextCursor"] = buildJsonObject { put("entryIndex", 1); put("at", original.at) } }
            }
            assertTrue(field, runCatching { FacetTrackingReader.readPage(schema(), original, null) { _, _ -> JsonObject(changed) } }.isFailure)
        }
        assertThrows(IllegalArgumentException::class.java) { FacetRawJson.parseObject("{\"version\":1," + raw.substring(1)) }
        assertThrows(IllegalArgumentException::class.java) { FacetRawJson.parseObject("{\"vers\\u0069on\":1," + raw.substring(1)) }
        Unit
    }
}
