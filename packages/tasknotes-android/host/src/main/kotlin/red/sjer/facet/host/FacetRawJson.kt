package red.sjer.facet.host

import kotlinx.serialization.json.*

/** Reject raw duplicate and escaped-equivalent keys before lossy object decoding. */
object FacetRawJson {
    fun parseObject(text: String): JsonObject {
        val parsed = Json.parseToJsonElement(text).jsonObject
        val objects = mutableListOf<MutableSet<String>?>()
        var position = 0
        while (position < text.length) {
            when (text[position]) {
                '{' -> { objects.add(mutableSetOf()); position++ }
                '[' -> { objects.add(null); position++ }
                '}', ']' -> { objects.removeAt(objects.lastIndex); position++ }
                '"' -> {
                    val start = position++
                    while (text[position] != '"') {
                        if (text[position] == '\\') position++
                        position++
                    }
                    position++
                    var following = position
                    while (following < text.length && text[following].isWhitespace()) following++
                    if (following < text.length && text[following] == ':') {
                        val key = Json.parseToJsonElement(text.substring(start, position)).jsonPrimitive.content
                        require(requireNotNull(objects.last()).add(key)) { "Duplicate native contract field." }
                    }
                }
                else -> position++
            }
        }
        return parsed
    }
}
