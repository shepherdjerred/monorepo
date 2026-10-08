package red.sjer.facet.host

import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.json.*

data class FacetTrackingOwner(val profileId: String, val version: ULong, val at: String, val requestGeneration: Long, val engineGeneration: Long, val taskPath: String? = null, val taskRevision: String? = null)
data class FacetTrackingContinuation(val owner: FacetTrackingOwner, val cursor: JsonObject, val seenCount: ULong, val totalCount: ULong, val problemCount: ULong, val problemsFingerprint: String)
data class FacetTrackingPage(val owner: FacetTrackingOwner, val rows: List<JsonObject>, val totalCount: ULong, val problemCount: ULong, val next: FacetTrackingContinuation?)
data class FacetTrackingTotals(val totalMinutes: ULong, val hasActiveSession: Boolean)

/** Bounded pages retain original lineage; continuation owners never follow current selection. */
object FacetTrackingReader {
    suspend fun readPage(schema: FacetSchema, owner: FacetTrackingOwner, continuation: FacetTrackingContinuation?, fetch: suspend (String, JsonObject) -> JsonObject): FacetTrackingPage = try {
        readCheckedPage(schema, owner, continuation, fetch)
    } catch (failure: IllegalArgumentException) {
        throw FacetTrackingContractException("The tracking page has inconsistent ownership or lineage.", failure)
    } catch (failure: NoSuchElementException) {
        throw FacetTrackingContractException("The tracking page is missing a required contract field.", failure)
    } catch (failure: java.time.DateTimeException) {
        throw FacetTrackingContractException("The tracking page has an invalid contract timestamp.", failure)
    }

    private suspend fun readCheckedPage(schema: FacetSchema, owner: FacetTrackingOwner, continuation: FacetTrackingContinuation?, fetch: suspend (String, JsonObject) -> JsonObject): FacetTrackingPage {
        require(continuation == null || continuation.owner == owner) { "The tracking continuation belongs to another request." }
        val history = owner.taskPath != null
        require(!history || owner.taskRevision != null)
        val request = buildJsonObject {
            put("schemaVersion", 1); put("kind", if (history) "tracking_history" else "tracking_sessions")
            put("at", owner.at); put("limit", 128); put("expectedVersion", JsonPrimitive(owner.version))
            owner.taskPath?.let { put("path", it) }; continuation?.let { put("after", it.cursor) }
        }
        schema.validate(if (history) "trackingHistoryRequest" else "trackingRequest", request)
        val page = fetch(owner.profileId, request)
        schema.validate(if (history) "trackingHistory" else "trackingSessions", page)
        require(page.getValue("profileId").jsonPrimitive.content == owner.profileId)
        require(page.getValue("version").jsonPrimitive.content.toULong() == owner.version)
        val at = page.getValue("at").jsonPrimitive.content
        require(Instant.parse(at) == Instant.parse(owner.at))
        if (history) {
            require(page.getValue("taskPath").jsonPrimitive.content == owner.taskPath)
            require(page.getValue("taskRevision").jsonPrimitive.content == owner.taskRevision)
        }
        val total = page.getValue("totalCount").jsonPrimitive.content.toULong()
        val problemCount = page.getValue("problemCount").jsonPrimitive.content.toULong()
        val problems = page.getValue("problems").jsonArray
        require(problems.size.toULong() == minOf(problemCount, 128uL))
        val fingerprint = JsonArray(problems.map { raw -> JsonArray(listOf(raw.jsonObject.getValue("taskPath"), raw.jsonObject.getValue("code"))) }).toString()
        continuation?.let { require(it.cursor.getValue("at").jsonPrimitive.content == at && it.totalCount == total && it.problemCount == problemCount && it.problemsFingerprint == fingerprint) }
        val rows = page.getValue("rows").jsonArray.map { it.jsonObject }
        val before = continuation?.seenCount ?: 0uL
        val seen = add(before, rows.size.toULong())
        require(seen <= total)
        var previousPath = if (history) null else continuation?.cursor?.getValue("taskPath")?.jsonPrimitive?.content
        val sessions = mutableSetOf<String>()
        rows.forEachIndexed { index, row ->
            if (history) {
                require(row.getValue("entryIndex").jsonPrimitive.content.toULong() == add(before, index.toULong()))
                val ended = row.getValue("endedAt").jsonPrimitive.contentOrNull
                require((row.getValue("state").jsonPrimitive.content == "running") == (ended == null))
                require(ended == null || Instant.parse(ended) >= Instant.parse(row.getValue("startedAt").jsonPrimitive.content))
                validateElapsed(row, ended ?: owner.at)
            } else {
                val path = row.getValue("taskPath").jsonPrimitive.content
                require(previousPath == null || comparePaths(requireNotNull(previousPath), path) < 0)
                require(sessions.add(row.getValue("sessionId").jsonPrimitive.content))
                previousPath = path
                validateElapsed(row, owner.at)
            }
        }
        val next = page.getValue("nextCursor")
        if (next == JsonNull) {
            require(seen == total)
            return FacetTrackingPage(owner, rows, total, problemCount, null)
        }
        val cursor = next.jsonObject
        require(rows.isNotEmpty() && seen < total && cursor.getValue("at").jsonPrimitive.content == at)
        val last = rows.last()
        val position = if (history) "entryIndex" else "taskPath"
        require(cursor.getValue(position) == last.getValue(position))
        return FacetTrackingPage(owner, rows, total, problemCount, FacetTrackingContinuation(owner, cursor, seen, total, problemCount, fingerprint))
    }

    /** Preserve legacy rounding and active elapsed while retaining at most one page. */
    suspend fun readTotals(schema: FacetSchema, owner: FacetTrackingOwner, fetch: suspend (String, JsonObject) -> JsonObject): FacetTrackingTotals = try {
        readCheckedTotals(schema, owner, fetch)
    } catch (failure: IllegalArgumentException) {
        throw FacetTrackingContractException("The tracking aggregate has inconsistent data or overflow.", failure)
    }

    private suspend fun readCheckedTotals(schema: FacetSchema, owner: FacetTrackingOwner, fetch: suspend (String, JsonObject) -> JsonObject): FacetTrackingTotals {
        require(owner.taskPath != null)
        var continuation: FacetTrackingContinuation? = null
        var minutes = 0uL
        var active = 0
        do {
            currentCoroutineContext().ensureActive()
            val page = readPage(schema, owner, continuation, fetch)
            if (page.problemCount != 0uL) throw FacetActionError("Some tracking entries could not be read. Review this task's time entries.")
            for (row in page.rows) {
                val ended = row.getValue("endedAt").jsonPrimitive.contentOrNull
                if (ended == null) require(++active <= 1)
                val seconds = row.getValue("elapsedSeconds").jsonPrimitive.content.toULong()
                minutes = add(minutes, add(seconds, 30uL) / 60uL)
            }
            continuation = page.next
        } while (continuation != null)
        return FacetTrackingTotals(minutes, active != 0)
    }

    private fun duration(row: JsonObject, ended: String): Duration = Duration.between(Instant.parse(row.getValue("startedAt").jsonPrimitive.content), Instant.parse(ended))
    private fun validateElapsed(row: JsonObject, ended: String) {
        val elapsed = duration(row, ended)
        require(row.getValue("elapsedSeconds").jsonPrimitive.content.toULong() == if (elapsed.isNegative) 0uL else elapsed.seconds.toULong())
    }
    private fun add(left: ULong, right: ULong): ULong {
        require(ULong.MAX_VALUE - left >= right) { "The tracking aggregate overflowed." }
        return left + right
    }
    private fun comparePaths(left: String, right: String): Int {
        val a = left.toByteArray(Charsets.UTF_8); val b = right.toByteArray(Charsets.UTF_8)
        for (index in 0 until minOf(a.size, b.size)) {
            val order = (a[index].toInt() and 255) - (b[index].toInt() and 255)
            if (order != 0) return order
        }
        return a.size.compareTo(b.size)
    }
}

/** A rejected internal tracking contract is fatal to that presentation request. */
class FacetTrackingContractException(message: String, cause: Throwable? = null) : IllegalStateException(message, cause)
