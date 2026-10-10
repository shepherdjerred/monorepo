package red.sjer.facet

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun FacetFiltersSheet(model: FacetViewModel, dismiss: () -> Unit) {
    val profile = requireNotNull(model.selected)
    var draft by remember(profile.id, model.query) { mutableStateOf(model.query) }
    FacetSheet("Filter and sort", dismiss, "Apply", save = { model.changeQuery(draft.copy(viewId = null)); dismiss() }) {
        Text("Filters", style = MaterialTheme.typography.titleMedium)
        listOf("statuses", "priorities").forEach { field ->
            Text(field.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelLarge)
            val values = if (field == "statuses") draft.statuses else draft.priorities
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val configured = workflow(model.snapshot?.configuration, field)
                val unknown = model.allSnapshot?.tasks.orEmpty().map { if (field == "statuses") it.status else it.priority }
                    .distinct().filter { value -> configured.none { it.value == value } }.map { WorkflowOption(it, it) }
                (configured + unknown).forEach { option ->
                    FilterChip(option.value in values, {
                        val next = if (option.value in values) values - option.value else values + option.value
                        draft = if (field == "statuses") draft.copy(statuses = next) else draft.copy(priorities = next)
                    }, label = { Text(option.label) })
                }
            }
        }
        listOf("projects", "contexts", "tags").forEach { field ->
            val values = when (field) { "projects" -> draft.projects; "contexts" -> draft.contexts; else -> draft.tags }
            val suggestions = model.allSnapshot?.tasks.orEmpty().flatMap { taskValues(it, field) }.distinct().sorted()
            FacetTokenField(field.replaceFirstChar { it.uppercase() }, values, suggestions, true) {
                draft = when (field) { "projects" -> draft.copy(projects = it); "contexts" -> draft.copy(contexts = it); else -> draft.copy(tags = it) }
            }
        }
        Text("Ordering", style = MaterialTheme.typography.titleMedium)
        ChoiceField("Sort by", draft.sort, listOf(
            WorkflowOption("effectiveDate", "Task date"), WorkflowOption("priority", "Configured priority"),
            WorkflowOption("title", "Title"), WorkflowOption("status", "Configured status"),
            WorkflowOption("dueDate", "Due date"), WorkflowOption("manual", "Manual order")
        )) { draft = draft.copy(sort = it) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Descending"); Switch(draft.descending, { draft = draft.copy(descending = it) })
        }
        ChoiceField("Group by", draft.group.orEmpty(), listOf(
            WorkflowOption("", "None"), WorkflowOption("effectiveDate", "Task date"), WorkflowOption("status", "Status"),
            WorkflowOption("priority", "Priority"), WorkflowOption("project", "Project"), WorkflowOption("context", "Context")
        )) { draft = draft.copy(group = it.ifEmpty { null }) }
        TextButton(onClick = { draft = FacetQuery(scope = draft.scope) }) { Icon(Icons.Default.FilterAltOff, null); Spacer(Modifier.width(8.dp)); Text("Reset filters and ordering") }
    }
}
