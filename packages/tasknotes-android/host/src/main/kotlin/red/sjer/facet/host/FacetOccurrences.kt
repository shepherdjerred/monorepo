package red.sjer.facet.host

import java.time.LocalDate
import kotlinx.serialization.json.*

enum class FacetGenerationState { STAGED, PENDING, APPLIED, FAILED, CANCELLED }
data class FacetGenerationFailure(val code: String, val message: String)
sealed interface FacetGenerationItem {
    val successorId: String
    val parentPath: String
    val state: FacetGenerationState
    val failure: FacetGenerationFailure?
    data class Materialization(override val successorId: String, override val parentPath: String,
        override val state: FacetGenerationState, override val failure: FacetGenerationFailure?, val occurrenceDate: String) : FacetGenerationItem
    data class Progression(override val successorId: String, override val parentPath: String,
        override val state: FacetGenerationState, override val failure: FacetGenerationFailure?, val childPath: String,
        val completedOccurrenceDate: String, val parentProjectionOwed: Boolean, val successorDiscoveryOwed: Boolean) : FacetGenerationItem
}
sealed interface FacetGenerationAction {
    data class Repairable(val command: JsonObject) : FacetGenerationAction
    data class Unrepairable(val reason: String) : FacetGenerationAction
}
data class FacetGenerationAttention(val primaryMutationId: String, val item: FacetGenerationItem, val action: FacetGenerationAction)
data class FacetWindowTarget(val parentPath: String, val expectedParentRevision: String, val referenceDate: String, val start: String, val end: String) {
    fun command(automatic: Boolean): JsonObject = FacetOccurrences.windowCommand(parentPath, expectedParentRevision, referenceDate, automatic)
}
data class FacetWindowProblem(val taskPath: String, val code: String)
data class FacetRollingPage(val profileId: String, val version: ULong, val referenceDate: String,
    val targets: List<FacetWindowTarget>, val problems: List<FacetWindowProblem>, val nextCursor: JsonObject?)

/** All responses pass the neutral closed schema before typed projection. No recurrence policy lives here. */
object FacetOccurrences {
    fun windowCommand(parentPath: String, expectedParentRevision: String, referenceDate: String, automatic: Boolean): JsonObject = buildJsonObject {
        put("kind", "materialize_occurrence_window"); put("origin", if (automatic) "automatic_maintenance" else "user")
        put("parentPath", parentPath); put("expectedParentRevision", expectedParentRevision); put("referenceDate", referenceDate)
    }
    fun successors(schema: FacetSchema, value: JsonObject, mutationId: String): List<FacetGenerationItem> {
        schema.validate("occurrenceSuccessors", value)
        require(value.text("mutationId") == mutationId) { "Occurrence results belong to another action." }
        return value.getValue("items").jsonArray.map { item(it.jsonObject) }
    }
    fun rolling(schema: FacetSchema, value: JsonObject, profileId: String, day: String): FacetRollingPage {
        schema.validate("rollingMaintenancePlan", value)
        require(value.text("profileId") == profileId && value.text("referenceDate") == day) { "Occurrence discovery belongs to another vault or day." }
        return FacetRollingPage(profileId, value.getValue("version").jsonPrimitive.content.toULong(), day,
            value.getValue("targets").jsonArray.map { raw -> raw.jsonObject.let { target ->
                require(target.text("referenceDate") == day)
                FacetWindowTarget(target.text("parentPath"), target.text("expectedParentRevision"), day, target.text("start"), target.text("end"))
            } }, value.getValue("problems").jsonArray.map { raw -> raw.jsonObject.let { FacetWindowProblem(it.text("taskPath"), it.text("code")) } },
            value.getValue("nextCursor").let { if (it == JsonNull) null else it.jsonObject })
    }
    fun failures(schema: FacetSchema, value: JsonObject, profileId: String): List<FacetGenerationAttention> {
        schema.validate("generationFailuresPlan", value)
        require(value.text("profileId") == profileId) { "Generation failures belong to another vault." }
        return value.getValue("items").jsonArray.map { raw ->
            val entry = raw.jsonObject; val action = entry.getValue("action").jsonObject
            FacetGenerationAttention(entry.text("primaryMutationId"), item(entry.getValue("item").jsonObject), when (action.text("kind")) {
                "repairable" -> FacetGenerationAction.Repairable(action.getValue("command").jsonObject)
                "unrepairable" -> FacetGenerationAction.Unrepairable(action.text("reason"))
                else -> error("Unknown occurrence repair action.")
            })
        }
    }
    private fun item(value: JsonObject): FacetGenerationItem {
        val state = when (value.text("state")) {
            "staged" -> FacetGenerationState.STAGED; "pending" -> FacetGenerationState.PENDING
            "applied" -> FacetGenerationState.APPLIED; "failed" -> FacetGenerationState.FAILED
            "cancelled" -> FacetGenerationState.CANCELLED; else -> error("Unknown generation state.")
        }
        val failure = value.getValue("failure").let { raw -> if (raw == JsonNull) null else raw.jsonObject.let { FacetGenerationFailure(it.text("code"), it.text("message")) } }
        return when (value.text("kind")) {
            "materialize_occurrence" -> FacetGenerationItem.Materialization(value.text("successorId"), value.text("parentPath"), state, failure, value.text("occurrenceDate"))
            "deferred_progression" -> FacetGenerationItem.Progression(value.text("successorId"), value.text("parentPath"), state, failure, value.text("childPath"), value.text("completedOccurrenceDate"), value.getValue("parentProjectionOwed").jsonPrimitive.boolean, value.getValue("successorDiscoveryOwed").jsonPrimitive.boolean)
            else -> error("Unknown occurrence generation item.")
        }
    }
    fun request(kind: String, day: String? = null, after: JsonObject? = null, version: ULong? = null): JsonObject = buildJsonObject {
        put("kind", kind); put("limit", 256)
        day?.let { LocalDate.parse(it); put("referenceDate", it) }
        after?.let { put("after", it); put("expectedVersion", JsonPrimitive(requireNotNull(version))) }
    }
    private fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.content
}
