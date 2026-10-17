package red.sjer.facet

import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.UUID
import kotlinx.serialization.json.*
import red.sjer.facet.host.VaultSnapshot
import red.sjer.facet.host.VaultTask

internal fun taskRowKey(task: VaultTask) = "${task.path}:${task.occurrenceDate.orEmpty()}"
internal fun civilDate(value: String, zone: ZoneId = ZoneId.systemDefault()): LocalDate =
    if (value.length == 10) LocalDate.parse(value) else OffsetDateTime.parse(value).atZoneSameInstant(zone).toLocalDate()
internal fun displayDate(value: String, today: LocalDate): String {
    val date = civilDate(value)
    return when (date) {
        today -> "Today"
        today.plusDays(1) -> "Tomorrow"
        today.minusDays(1) -> "Yesterday"
        else -> date.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM))
    }
}
internal fun taskValues(task: VaultTask, field: String): List<String> = when (val value = task.properties[field]) {
    is JsonArray -> value.mapNotNull { (it as? JsonPrimitive)?.takeIf { primitive -> primitive.isString }?.content }
    is JsonPrimitive -> listOfNotNull(value.takeIf { it.isString }?.content)
    else -> emptyList()
}
internal fun workflowLabel(configuration: JsonObject?, field: String, value: String): String =
    workflow(configuration, field).firstOrNull { it.value == value }?.label ?: value
internal fun workflowColor(configuration: JsonObject?, field: String, value: String): String? =
    configuration?.get(field)?.jsonArray?.firstOrNull { it.jsonObject.getValue("value").jsonPrimitive.content == value }
        ?.jsonObject?.get("color")?.jsonPrimitive?.contentOrNull

internal data class FacetTaskSection(val key: String?, val tasks: List<VaultTask>)
internal class FacetBulkSelectionError(message: String) : IllegalStateException(message)

/** A core batch changes distinct notes; occurrence rows retain their reviewed revision. */
internal fun bulkCommand(tasks: List<VaultTask>, action: String, value: String = ""): JsonObject {
    require(action in setOf("complete", "delete", "schedule", "priority")) { "Unknown batch action." }
    require(tasks.isNotEmpty())
    val notes = tasks.groupBy { it.path }
    if (notes.values.any { rows -> rows.map { it.revision }.distinct().size != 1 })
        throw FacetBulkSelectionError("The selected occurrences have different note revisions. Refresh and review this selection before continuing.")
    if (action == "complete" && notes.values.any { it.size > 1 })
        throw FacetBulkSelectionError("Complete occurrences of the same recurring task separately. Your selection is retained.")
    if (action == "complete" && tasks.any { it.isRecurring && it.occurrenceDate == null })
        throw FacetBulkSelectionError("Choose recurring occurrences from Today or Agenda before completing this selection.")
    val commands = notes.values.map { rows ->
        val task = rows.first()
        when (action) {
            "complete" -> completionCommand(task, true)
            "delete" -> buildJsonObject { put("kind", "delete"); put("path", task.path); put("expectedRevision", task.revision) }
            else -> buildJsonObject {
                put("kind", "update"); put("path", task.path); put("expectedRevision", task.revision)
                put("properties", buildJsonObject { put(if (action == "schedule") "scheduled" else "priority", value.takeIf { it.isNotBlank() }?.let(::JsonPrimitive) ?: JsonNull) })
            }
        }
    }
    return buildJsonObject { put("kind", "batch"); put("commands", JsonArray(commands)) }
}

/** Render only the core's page membership and group order, merging page continuations. */
internal fun taskSections(snapshot: VaultSnapshot, groupBy: String? = null): List<FacetTaskSection> {
    if (snapshot.groups.isEmpty()) return listOf(FacetTaskSection(null, snapshot.tasks))
    val tasks = snapshot.tasks.groupBy { it.id }
    val groups = linkedMapOf<String, MutableList<VaultTask>>()
    val positions = mutableMapOf<Pair<String, String>, Int>()
    val represented = mutableSetOf<VaultTask>()
    snapshot.groups.forEach { group ->
        val rows = groups.getOrPut(group.getValue("key").jsonPrimitive.content) { mutableListOf() }
        group.getValue("taskIds").jsonArray.forEach { id ->
            val value = id.jsonPrimitive.content
            val key = group.getValue("key").jsonPrimitive.content to value
            val members = requireNotNull(tasks[value]) { "Group references an unavailable task." }
            // Repeated occurrences share the note ID; date groups identify the occurrence
            // with the effective date supplied by the engine, rather than the first note row.
            val candidates = if (groupBy == "effectiveDate") members.filter { it.effectiveDate.orEmpty() == key.first } else members
            val position = positions.getOrDefault(key, 0)
            check(position < candidates.size) { "Group repeats a task outside its page membership." }
            val task = candidates[position]
            rows.add(task); represented.add(task); positions[key] = position + 1
        }
    }
    check(snapshot.tasks.all { it in represented }) { "Core groups omitted a task." }
    return groups.map { FacetTaskSection(it.key, it.value) }
}

internal data class FacetCompletionIntent(val profileId: String, val task: VaultTask, val mutationId: String = UUID.randomUUID().toString()) {
    val key get() = "$profileId:${taskRowKey(task)}"
    val command get() = completionCommand(task, !task.completed)
}
/** Presentation admission owns no committed truth; the controller owns submitted envelopes. */
internal class FacetCompletionAdmission {
    private val admitted = linkedMapOf<String, FacetCompletionIntent>()
    private var closed = false
    fun admit(profileId: String, task: VaultTask): FacetCompletionIntent? {
        if (closed) return null
        val intent = FacetCompletionIntent(profileId, task)
        if (intent.key in admitted) return null
        admitted[intent.key] = intent
        return intent
    }
    fun owns(intent: FacetCompletionIntent) = !closed && admitted[intent.key] == intent
    fun release(intent: FacetCompletionIntent) { if (admitted[intent.key] == intent) admitted.remove(intent.key) }
    fun close() { closed = true; admitted.clear() }
}
