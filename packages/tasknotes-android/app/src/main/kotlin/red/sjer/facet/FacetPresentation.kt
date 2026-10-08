package red.sjer.facet

import java.time.Instant
import java.time.LocalDate
import kotlinx.serialization.json.*
import red.sjer.facet.host.VaultTask

/** Presentation choices become explicit shared-core query inputs. No filtering runs here. */
data class FacetQuery(
    val text: String = "", val scope: String = "today", val viewId: String? = null,
    val statuses: List<String> = emptyList(), val priorities: List<String> = emptyList(),
    val projects: List<String> = emptyList(), val contexts: List<String> = emptyList(), val tags: List<String> = emptyList(),
    val sort: String = "effectiveDate", val descending: Boolean = false, val group: String? = null,
) {
    fun document(offset: Int = 0, limit: Int = 100, today: String = LocalDate.now().toString(), at: String = Instant.now().toString()): JsonObject = buildJsonObject {
        put("schemaVersion", 1); put("scope", scope); put("today", today); put("at", at); put("offset", offset); put("limit", limit)
        if (text.isNotEmpty()) put("text", text)
        if (statuses.isNotEmpty()) put("statuses", strings(statuses))
        if (priorities.isNotEmpty()) put("priorities", strings(priorities))
        if (projects.isNotEmpty()) put("projects", strings(projects))
        if (contexts.isNotEmpty()) put("contexts", strings(contexts))
        if (tags.isNotEmpty()) put("tags", strings(tags))
        put("sortField", sort); put("sortDirection", if (descending) "desc" else "asc")
        group?.let { put("groupBy", it) }
    }
}

data class WorkflowOption(val value: String, val label: String)

fun workflow(configuration: JsonObject?, field: String): List<WorkflowOption> =
    configuration?.getValue(field)?.jsonArray?.map {
        val item = it.jsonObject
        WorkflowOption(item.getValue("value").jsonPrimitive.content, item.getValue("label").jsonPrimitive.content)
    } ?: emptyList()

/** Complete editable normalized fields; unknown properties remain owned by Rust's document merge. */
data class TaskEditorDraft(
    val title: String, val body: String, val status: String, val priority: String,
    val due: String, val scheduled: String, val recurrence: String, val recurrenceAnchor: String,
    val projects: String, val contexts: String, val tags: String, val estimate: String,
    val completedDate: String, val completeInstances: String, val skippedInstances: String,
    val blockedBy: String, val timeEntries: String,
    val reminders: String = "[]", val attachments: String = "",
    val dateCreated: String = "",
) {
    fun command(task: VaultTask): JsonObject {
        val original = from(task)
        val fields = buildJsonObject {
            if (title != original.title) put("title", title)
            if (priority != original.priority) put("priority", priority)
            fun nullable(name: String, value: String, before: String) { if (value != before) put(name, value.takeIf { it.isNotBlank() }?.let(::JsonPrimitive) ?: JsonNull) }
            nullable("due", due, original.due); nullable("scheduled", scheduled, original.scheduled)
            nullable("recurrence", recurrence, original.recurrence); nullable("recurrenceAnchor", recurrenceAnchor, original.recurrenceAnchor)
            nullable("completedDate", completedDate, original.completedDate)
            nullable("dateCreated", dateCreated, original.dateCreated)
            fun list(name: String, value: String, before: String) { if (value != before) put(name, strings(splitValues(value))) }
            list("projects", projects, original.projects); list("contexts", contexts, original.contexts); list("tags", tags, original.tags)
            list("completeInstances", completeInstances, original.completeInstances); list("skippedInstances", skippedInstances, original.skippedInstances); list("blockedBy", blockedBy, original.blockedBy)
            if (estimate != original.estimate) put("timeEstimate", if (estimate.isBlank()) JsonNull else exactNumber(estimate))
            if (timeEntries != original.timeEntries) put("timeEntries", Json.parseToJsonElement(timeEntries).jsonArray)
            if (reminders != original.reminders) put("reminders", Json.parseToJsonElement(reminders).jsonArray)
            if (attachments != original.attachments) put("attachments", strings(attachments.lines().map(String::trim).filter(String::isNotEmpty)))
        }
        return buildJsonObject {
            put("kind", "edit_task"); put("path", task.path); put("expectedRevision", task.revision); put("properties", fields)
            if (status != original.status) put("status", status)
            task.occurrenceDate?.let { put("occurrenceDate", it) }
            if (body != original.body) put("body", body)
        }
    }

    companion object {
        fun from(task: VaultTask): TaskEditorDraft {
            fun scalar(key: String) = task.properties[key]?.let { value -> if (value is JsonPrimitive) value.contentOrNull ?: "" else value.toString() } ?: ""
            fun list(key: String) = task.properties[key]?.let { value ->
                when (value) { JsonNull -> ""; is JsonArray -> value.joinToString(", ") { if (it is JsonPrimitive) it.content else it.toString() }; is JsonPrimitive -> value.content; else -> value.toString() }
            } ?: ""
            val attachments = task.properties["attachments"]?.let { value -> if (value is JsonArray) value.joinToString("\n") { if (it is JsonPrimitive) it.content else it.toString() } else if (value == JsonNull) "" else value.toString() } ?: ""
            return TaskEditorDraft(task.title, task.body, task.status, task.priority, scalar("due"), scalar("scheduled"), scalar("recurrence"), scalar("recurrenceAnchor"), list("projects"), list("contexts"), list("tags"), scalar("timeEstimate"), scalar("completedDate"), list("completeInstances"), list("skippedInstances"), list("blockedBy"), task.properties["timeEntries"]?.toString() ?: "[]", task.properties["reminders"]?.toString() ?: "[]", attachments, scalar("dateCreated"))
        }
    }
}

/** Parses an exact JSON numeric token; no integer truncation or binary floating-point conversion. */
fun exactNumber(text: String): JsonPrimitive {
    val value = Json.parseToJsonElement(text.trim())
    require(value is JsonPrimitive && !value.isString && value != JsonNull && value.content != "true" && value.content != "false") { "Enter a numeric estimate in minutes." }
    return value
}

fun strings(values: List<String>): JsonArray = JsonArray(values.map(::JsonPrimitive))
fun splitValues(text: String): List<String> = text.split(',').map { it.trim() }.filter { it.isNotEmpty() }

fun completionCommand(task: VaultTask, completed: Boolean): JsonObject = buildJsonObject {
    put("kind", "set_completion"); put("path", task.path); put("expectedRevision", task.revision); put("completed", completed)
    task.occurrenceDate?.let { put("occurrenceDate", it) }
}
