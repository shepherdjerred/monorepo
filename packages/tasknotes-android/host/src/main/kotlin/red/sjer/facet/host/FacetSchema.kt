package red.sjer.facet.host

import java.math.BigDecimal
import java.time.OffsetDateTime
import java.time.LocalDate
import kotlinx.serialization.json.*

/** Executes the supported keywords in the shared normative schema directly. */
class FacetSchema(schema: String) {
    private val root = Json.parseToJsonElement(schema).jsonObject
    init { root.getValue("\$defs").jsonObject.values.forEach(::inspect) }
    private fun inspect(value: JsonElement) {
        if (value is JsonPrimitive && value.booleanOrNull != null) return
        val rule = value.jsonObject
        val supported = setOf("\$ref", "\$schema", "\$id", "\$defs", "\$comment", "title", "description", "default", "examples", "const", "enum", "anyOf", "oneOf", "allOf", "not", "type", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "uniqueItems", "minLength", "maxLength", "pattern", "format", "minimum", "maximum")
        require(rule.keys.all { it in supported }) { "Unsupported normative schema keyword: ${rule.keys.filter { it !in supported }}" }
        listOf("properties", "\$defs").forEach { key -> rule[key]?.jsonObject?.values?.forEach(::inspect) }
        listOf("items", "not", "additionalProperties").forEach { key -> rule[key]?.let(::inspect) }
        listOf("anyOf", "oneOf", "allOf").forEach { key -> rule[key]?.jsonArray?.forEach(::inspect) }
    }
    fun validate(definition: String, value: JsonElement) { checkNode(root.getValue("\$defs").jsonObject.getValue(definition).jsonObject, value) }
    private fun checkNode(rule: JsonObject, value: JsonElement) {
        rule["\$ref"]?.jsonPrimitive?.content?.let { reference ->
            require(reference.startsWith("#/\$defs/"))
            checkNode(root.getValue("\$defs").jsonObject.getValue(reference.removePrefix("#/\$defs/")).jsonObject, value)
        }
        rule["const"]?.let { require(equal(it, value)) { "Unexpected contract constant." } }
        rule["enum"]?.let { require(it.jsonArray.any { candidate -> equal(candidate, value) }) { "Unknown contract value." } }
        rule["allOf"]?.jsonArray?.forEach { checkNode(it.jsonObject, value) }
        rule["not"]?.let { require(runCatching { checkNode(it.jsonObject, value) }.isFailure) { "Excluded contract shape." } }
        rule["anyOf"]?.let { choices -> require(choices.jsonArray.any { runCatching { checkNode(it.jsonObject, value) }.isSuccess }) { "No matching contract shape." } }
        rule["oneOf"]?.let { choices -> require(choices.jsonArray.count { runCatching { checkNode(it.jsonObject, value) }.isSuccess } == 1) { "Ambiguous or unknown contract shape." } }
        rule["type"]?.let { type ->
            val choices = if (type is JsonArray) type.map { it.jsonPrimitive.content } else listOf(type.jsonPrimitive.content)
            require(choices.any { matchesType(it, value) }) { "Unexpected contract type." }
        }
        if (value is JsonObject) {
            val properties = rule["properties"]?.jsonObject ?: JsonObject(emptyMap())
            rule["required"]?.jsonArray?.forEach { require(value.containsKey(it.jsonPrimitive.content)) { "Missing contract field." } }
            if (rule["additionalProperties"] == JsonPrimitive(false)) require(value.keys.all { it in properties }) { "Unknown contract field." }
            value.forEach { (key, child) -> properties[key]?.let { checkNode(it.jsonObject, child) } }
            (rule["additionalProperties"] as? JsonObject)?.let { additional -> value.filterKeys { it !in properties }.values.forEach { checkNode(additional, it) } }
        }
        if (value is JsonArray) {
            rule["items"]?.let { item -> value.forEach { checkNode(item.jsonObject, it) } }
            rule["minItems"]?.let { require(value.size >= it.jsonPrimitive.int) }
            rule["maxItems"]?.let { require(value.size <= it.jsonPrimitive.int) }
            if (rule["uniqueItems"] == JsonPrimitive(true)) value.forEachIndexed { index, child -> require(value.take(index).none { equal(it, child) }) }
        }
        if (value is JsonPrimitive && value.isString) {
            val length = value.content.codePointCount(0, value.content.length)
            rule["minLength"]?.let { require(length >= it.jsonPrimitive.int) }
            rule["maxLength"]?.let { require(length <= it.jsonPrimitive.int) }
            rule["pattern"]?.let { require(Regex(it.jsonPrimitive.content).containsMatchIn(value.content)) }
            rule["format"]?.let { format -> when (format.jsonPrimitive.content) {
                "date-time" -> OffsetDateTime.parse(value.content)
                "date" -> LocalDate.parse(value.content)
                else -> error("Unsupported normative schema format.")
            } }
        }
        if (value is JsonPrimitive && !value.isString && value != JsonNull && value.booleanOrNull == null) {
            val number = value.content.toBigDecimal()
            rule["minimum"]?.let { require(number >= it.jsonPrimitive.content.toBigDecimal()) }
            rule["maximum"]?.let { require(number <= it.jsonPrimitive.content.toBigDecimal()) }
        }
    }
    private fun equal(left: JsonElement, right: JsonElement): Boolean {
        fun numeric(value: JsonElement): BigDecimal? = if (value is JsonPrimitive && !value.isString) value.content.toBigDecimalOrNull() else null
        val leftNumber = numeric(left); val rightNumber = numeric(right)
        if (leftNumber != null && rightNumber != null) return leftNumber.compareTo(rightNumber) == 0
        if (left is JsonArray && right is JsonArray) return left.size == right.size && left.zip(right).all { equal(it.first, it.second) }
        if (left is JsonObject && right is JsonObject) return left.keys == right.keys && left.all { (key, child) -> equal(child, right.getValue(key)) }
        return left == right
    }
    private fun matchesType(type: String, value: JsonElement): Boolean = when (type) {
        "object" -> value is JsonObject
        "array" -> value is JsonArray
        "null" -> value == JsonNull
        "string" -> value is JsonPrimitive && value.isString
        "boolean" -> value is JsonPrimitive && !value.isString && value.booleanOrNull != null
        "integer" -> value is JsonPrimitive && !value.isString && runCatching { value.content.toBigDecimal().remainder(BigDecimal.ONE).compareTo(BigDecimal.ZERO) == 0 }.getOrDefault(false)
        "number" -> value is JsonPrimitive && !value.isString && value.content.toBigDecimalOrNull() != null
        else -> error("Unsupported normative schema type.")
    }
}
