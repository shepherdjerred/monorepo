package red.sjer.facet

import java.time.Clock
import java.time.ZoneId
import kotlinx.serialization.json.*

/** One immutable logical query generation; later pages change only offset and limit. */
data class FacetPagedQuery(val profileId: String, val generation: Long, val query: JsonObject) {
    fun owns(profileId: String, generation: Long) = this.profileId == profileId && this.generation == generation
    fun page(offset: Int = 0, limit: Int = 100): JsonObject = buildJsonObject {
        query.forEach { (key, value) -> put(key, value) }
        put("offset", offset); put("limit", limit)
    }

    companion object {
        fun capture(profileId: String, generation: Long, selection: FacetQuery, saved: JsonObject?, clock: Clock = Clock.systemUTC(), zone: ZoneId = ZoneId.systemDefault()): FacetPagedQuery {
            val instant = clock.instant()
            val today = instant.atZone(zone).toLocalDate().toString()
            val base = saved ?: selection.document(today = today, at = instant.toString())
            val frozen = buildJsonObject {
                base.forEach { (key, value) -> put(key, value) }
                put("today", today); put("at", instant.toString()); put("offset", 0); put("limit", 100)
                if (saved != null && selection.text.isNotEmpty()) put("text", selection.text)
            }
            return FacetPagedQuery(profileId, generation, frozen)
        }
    }
}
