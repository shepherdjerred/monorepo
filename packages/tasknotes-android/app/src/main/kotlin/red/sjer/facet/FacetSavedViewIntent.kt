package red.sjer.facet

import java.util.UUID
import kotlinx.serialization.json.*

/** A form retains its original vault, view, open query and action across retries and restoration. */
internal data class FacetSavedViewIntent(val profileId: String, val viewId: String, val query: JsonObject,
    val previous: JsonObject, val name: String, val mutationId: String = UUID.randomUUID().toString()) {
    val command get() = buildJsonObject {
        put("kind", "save_view"); put("id", viewId)
        put("view", buildJsonObject {
            previous.forEach { (key, value) -> put(key, value) }
            put("schemaVersion", 1); put("name", name); put("query", query)
        })
    }
    fun renamed(value: String) = copy(name = value, mutationId = UUID.randomUUID().toString())
    fun saved() = listOf(profileId, viewId, query.toString(), previous.toString(), name, mutationId)
    companion object {
        fun restore(value: List<String>): FacetSavedViewIntent {
            require(value.size == 6 && value[0].isNotBlank() && value[1].isNotBlank() && value[5].isNotBlank()) { "The saved view form identity is incomplete." }
            return FacetSavedViewIntent(value[0], value[1], Json.parseToJsonElement(value[2]).jsonObject,
                Json.parseToJsonElement(value[3]).jsonObject, value[4], value[5])
        }
    }
}
