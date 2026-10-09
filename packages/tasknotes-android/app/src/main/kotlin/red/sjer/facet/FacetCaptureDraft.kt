package red.sjer.facet

import kotlinx.serialization.json.*

/** Explicit local edits overlay the Rust preview; parsing remains entirely in the engine. */
internal data class FacetCaptureDraft(val input: String = "", val overrides: JsonObject = JsonObject(emptyMap()), val notes: String? = null) {
    fun properties(preview: JsonObject): JsonObject = JsonObject(preview.getValue("properties").jsonObject + overrides)
    fun hasTaskTitle(preview: JsonObject): Boolean = properties(preview).getValue("title").jsonPrimitive.contentOrNull?.isNotBlank() == true
    fun payload(preview: JsonObject): JsonObject = JsonObject(preview + mapOf("properties" to properties(preview), "body" to (notes?.let(::JsonPrimitive) ?: preview.getValue("body"))))
    fun field(key: String, value: String) = copy(overrides = JsonObject(overrides + (key to (value.takeIf(String::isNotEmpty)?.let(::JsonPrimitive) ?: JsonNull))))
    fun tokens(key: String, values: List<String>) = copy(overrides = JsonObject(overrides + (key to strings(values))))
    fun saved(): List<String> = listOf(input, overrides.toString(), notes.orEmpty(), (notes != null).toString())
    companion object {
        fun restore(values: List<String>) = FacetCaptureDraft(values[0], Json.parseToJsonElement(values[1]).jsonObject, values[2].takeIf { values[3].toBooleanStrict() })
    }
}
