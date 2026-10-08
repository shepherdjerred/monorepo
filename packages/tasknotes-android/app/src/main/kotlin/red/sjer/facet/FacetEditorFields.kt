package red.sjer.facet

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.util.UUID
import kotlinx.serialization.json.*

/** Only a changed control replaces its property; all unknown entry fields survive. */
internal fun editEntry(entries: JsonArray, index: Int, field: String, value: String?): JsonArray {
    val original = entries[index].jsonObject
    val updated = JsonObject(original.toMutableMap().apply { put(field, value?.let(::JsonPrimitive) ?: JsonNull) })
    return JsonArray(entries.mapIndexed { position, entry -> if (position == index) updated else entry })
}

@Composable
internal fun TypedTimeEntries(document: String, busy: Boolean, change: (String) -> Unit) {
    val parsed = Json.parseToJsonElement(document)
    Text("Time entries", style = MaterialTheme.typography.titleSmall)
    if (parsed !is JsonArray) {
        Text("The existing time-entry value is preserved. Correct it in your vault before editing entries.")
        return
    }
    parsed.forEachIndexed { index, entry ->
        if (entry !is JsonObject) Text("Existing entry ${index + 1} is preserved and cannot be edited here.")
        else Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Entry ${index + 1}")
            val start = (entry["startTime"] as? JsonPrimitive)?.contentOrNull ?: ""
            val end = (entry["endTime"] as? JsonPrimitive)?.contentOrNull ?: ""
            OutlinedTextField(start, { change(editEntry(parsed, index, "startTime", it).toString()) }, label = { Text("Start (RFC3339)") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(end, { change(editEntry(parsed, index, "endTime", it.takeIf(String::isNotBlank)).toString()) }, label = { Text("End (blank for active entry)") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
            TextButton(onClick = { change(JsonArray(parsed.filterIndexed { position, _ -> position != index }).toString()) }, enabled = !busy) { Text("Remove entry") }
        }
    }
    TextButton(onClick = { change(JsonArray(parsed + buildJsonObject { put("startTime", ""); put("endTime", JsonNull) }).toString()) }, enabled = !busy) { Text("Add time entry") }
}

@Composable
internal fun TypedReminders(document: String, busy: Boolean, change: (String) -> Unit) {
    val parsed = Json.parseToJsonElement(document)
    Text("Reminders", style = MaterialTheme.typography.titleSmall)
    if (parsed !is JsonArray) {
        Text("The existing reminder value is preserved. Correct it in your vault before editing reminders.")
        return
    }
    parsed.forEachIndexed { index, entry ->
        if (entry !is JsonObject) Text("Existing reminder ${index + 1} is preserved and cannot be edited here.")
        else Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            fun value(name: String) = (entry[name] as? JsonPrimitive)?.contentOrNull ?: ""
            fun set(name: String, value: String) = change(editEntry(parsed, index, name, value).toString())
            Text("Reminder ${index + 1}")
            ChoiceField("Type", value("type"), listOf(WorkflowOption("relative", "Relative"), WorkflowOption("absolute", "Absolute")), !busy) { set("type", it) }
            when (value("type")) {
                "relative" -> {
                    ChoiceField("Relative to", value("relatedTo"), listOf(WorkflowOption("due", "Due date"), WorkflowOption("scheduled", "Scheduled date")), !busy) { set("relatedTo", it) }
                    OutlinedTextField(value("offset"), { set("offset", it) }, label = { Text("Offset (for example -PT15M)") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
                }
                "absolute" -> OutlinedTextField(value("absoluteTime"), { set("absoluteTime", it) }, label = { Text("Time (RFC3339)") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
                else -> Text("The existing reminder type is preserved; choose a supported type to change it.")
            }
            TextButton(onClick = { change(JsonArray(parsed.filterIndexed { position, _ -> position != index }).toString()) }, enabled = !busy) { Text("Remove reminder") }
        }
    }
    TextButton(onClick = {
        change(JsonArray(parsed + buildJsonObject { put("id", UUID.randomUUID().toString()); put("type", "relative"); put("relatedTo", "due"); put("offset", "-PT15M") }).toString())
    }, enabled = !busy) { Text("Add reminder") }
}
