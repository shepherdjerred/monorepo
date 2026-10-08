package red.sjer.facet.host

import kotlinx.serialization.json.*

data class VaultProfile(val id: String, val name: String, val kind: String, val approveStandard: Boolean)
data class VaultTask(val id: String, val path: String, val title: String, val status: String, val priority: String, val completed: Boolean, val revision: String, val properties: JsonObject, val body: String, val isRecurring: Boolean, val isBlocked: Boolean, val isBlocking: Boolean, val hasActiveTimeSession: Boolean, val totalTrackedMinutes: ULong, val occurrenceDate: String?, val effectiveDate: String?, val isPending: Boolean)
data class VaultProblem(val path: String, val message: String)
data class VaultSnapshot(val profileId: String, val version: ULong, val tasks: List<VaultTask>, val totalCount: ULong, val pendingCount: ULong, val conflictCount: ULong, val configuration: JsonObject?, val problems: List<VaultProblem>, val views: List<JsonObject>, val groups: List<JsonObject>, val pendingTaskIds: List<String>)

/** Validates the versioned language-neutral Facet contract at the host seam. */
object FacetContract {
    fun profile(value: JsonObject): VaultProfile {
        val kind = value.string("kind")
        require(kind == "local_folder" || kind == "obsidian_sync") { "Unknown vault profile kind." }
        return VaultProfile(value.string("id"), value.string("name"), kind, value.boolean("approveStandard"))
    }

    fun snapshot(text: String): VaultSnapshot {
        val value = Json.parseToJsonElement(text).jsonObject
        validateVersion(value)
        return VaultSnapshot(
            value.string("profileId"), value.unsigned("version"), value.getValue("tasks").jsonArray.map { task(it.jsonObject) },
            value.unsigned("totalCount"), value.unsigned("pendingCount"), value.unsigned("conflictCount"),
            value.getValue("configuration").let { if (it == JsonNull) null else it.jsonObject },
            value.getValue("problems").jsonArray.map { VaultProblem(it.jsonObject.string("path"), it.jsonObject.string("message")) },
            value.getValue("views").jsonArray.map { it.jsonObject }, value.getValue("groups").jsonArray.map { it.jsonObject },
            value.getValue("pendingTaskIds").jsonArray.map { it.jsonPrimitive.content },
        )
    }

    private fun task(value: JsonObject): VaultTask = VaultTask(
        value.string("id"), value.string("path"), value.string("title"), value.string("status"), value.string("priority"),
        value.boolean("completed"), value.string("revision"), value.getValue("properties").jsonObject, value.string("body"),
        value.boolean("isRecurring"), value.boolean("isBlocked"), value.boolean("isBlocking"), value.boolean("hasActiveTimeSession"), value.unsigned("totalTrackedMinutes"),
        value.getValue("occurrenceDate").jsonPrimitive.contentOrNull, value.getValue("effectiveDate").jsonPrimitive.contentOrNull, value.boolean("isPending"),
    )

    fun validateVersion(value: JsonObject) { require(value.unsigned("schemaVersion") == 1uL) { "Unsupported Facet engine schema version." } }
    private fun JsonObject.string(key: String): String = getValue(key).jsonPrimitive.let { require(it.isString); it.content }
    private fun JsonObject.boolean(key: String): Boolean = getValue(key).jsonPrimitive.let { require(!it.isString); requireNotNull(it.booleanOrNull) }
    private fun JsonObject.unsigned(key: String): ULong = getValue(key).jsonPrimitive.let { require(!it.isString); it.content.toULong() }
}
