package red.sjer.facet.host

import kotlinx.serialization.json.*

/** Core-owned editing choices; an absent configured default requires an explicit selection. */
data class FacetDependencyEditor(val relationshipTypes: List<String>, val defaultReltype: String?) {
    companion object {
        fun parse(schema: FacetSchema, document: JsonObject): FacetDependencyEditor {
            schema.validate("dependencyEditor", document)
            val choices = document.getValue("relationshipTypes").jsonArray.map { it.jsonPrimitive.content }
            val default = document.getValue("defaultReltype").let { if (it == JsonNull) null else it.jsonPrimitive.content }
            require(default == null || default in choices) { "The dependency default is outside its canonical choices." }
            return FacetDependencyEditor(choices, default)
        }
    }
}
