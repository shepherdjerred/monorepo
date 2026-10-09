package red.sjer.facet

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.automirrored.filled.EventNote
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*
import red.sjer.facet.host.VaultTask

@Composable
internal fun FacetBrowse(model: FacetViewModel, openQuery: (FacetQuery, String) -> Unit, navigate: (String) -> Unit) {
    LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { Text("Your task views", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(4.dp)) }
        item { FacetBrowseRow("All tasks", "Everything in this vault", Icons.AutoMirrored.Filled.ListAlt) { openQuery(FacetQuery(scope = "all"), "All tasks") } }
        item { FacetBrowseRow("Agenda", "Task occurrences and dates", Icons.AutoMirrored.Filled.EventNote) { openQuery(FacetQuery(scope = "agenda", group = "effectiveDate"), "Agenda") } }
        item { FacetBrowseRow("Overdue", "Tasks that need another look", Icons.Default.EventBusy) { openQuery(FacetQuery(scope = "overdue"), "Overdue") } }
        item { FacetBrowseRow("Completed", "Finished tasks", Icons.Default.DoneAll) { openQuery(FacetQuery(scope = "completed"), "Completed") } }
        item { FacetBrowseRow("Undated", "Tasks without a date", Icons.Default.EventAvailable) { openQuery(FacetQuery(scope = "undated"), "Undated") } }
        item { Text("Organize", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp)) }
        item { FacetBrowseRow("Board", "Tasks by their configured status", Icons.Default.ViewKanban) { navigate("Board") } }
        item { FacetBrowseRow("Saved views", "Your filters and ordering", Icons.Default.BookmarkBorder) { navigate("Views") } }
        listOf("projects", "contexts", "tags").forEach { field ->
            val values = model.allSnapshot?.tasks.orEmpty().flatMap { taskValues(it, field) }.distinct().sorted()
            if (values.isNotEmpty()) item { Text(field.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp)) }
            items(values, key = { "$field:$it" }) { value ->
                FacetBrowseRow(value, "", when (field) { "projects" -> Icons.Default.Folder; "contexts" -> Icons.Default.AlternateEmail; else -> Icons.Default.Tag }) {
                    openQuery(when (field) {
                        "projects" -> FacetQuery(scope = "all", projects = listOf(value))
                        "contexts" -> FacetQuery(scope = "all", contexts = listOf(value))
                        else -> FacetQuery(scope = "all", tags = listOf(value))
                    }, value)
                }
            }
        }
        item { Text("Your vault", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp)) }
        item { FacetBrowseRow("Conflicts and history", "Preserved versions and resolutions", Icons.Default.History) { navigate("Conflicts") } }
        item { FacetBrowseRow("Settings", "Account, vaults and reminders", Icons.Default.Settings) { navigate("Settings") } }
    }
}

@Composable
private fun FacetBrowseRow(title: String, detail: String, image: androidx.compose.ui.graphics.vector.ImageVector, action: () -> Unit) {
    Surface(shape = MaterialTheme.shapes.medium) {
        ListItem(headlineContent = { Text(title) }, supportingContent = if (detail.isEmpty()) null else ({ Text(detail) }),
            leadingContent = { Icon(image, null, tint = MaterialTheme.colorScheme.primary) },
            trailingContent = { Icon(Icons.Default.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
            modifier = Modifier.fillMaxWidth().clickable(onClick = action))
    }
}

@Composable
internal fun FacetBoard(model: FacetViewModel, edit: (VaultTask) -> Unit) {
    val profile = requireNotNull(model.selected)
    val tasks = model.allSnapshot?.tasks.orEmpty()
    val configuration = model.allSnapshot?.configuration
    val configured = workflow(configuration, "statuses")
    val choices = configured + tasks.map { it.status }.distinct().filter { raw -> configured.none { it.value == raw } }.map { WorkflowOption(it, it) }
    var moving by remember(profile.id) { mutableStateOf<VaultTask?>(null) }
    Row(Modifier.fillMaxSize().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        choices.forEach { status ->
            val rows = tasks.filter { it.status == status.value }
            Column(Modifier.width(300.dp).fillMaxHeight()) {
                Row(Modifier.fillMaxWidth().padding(vertical = 16.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Text(status.label, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    Text(rows.size.toString(), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                workflowColor(configuration, "statuses", status.value)?.let(::projectFacetColor)?.diagnostic?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                LazyColumn(contentPadding = PaddingValues(bottom = 88.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (rows.isEmpty()) item { Text("No tasks in " + status.label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp)) }
                    items(rows, key = { taskRowKey(it) }) { task ->
                        Surface(shape = MaterialTheme.shapes.medium, tonalElevation = 1.dp) {
                            Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(task.title, Modifier.fillMaxWidth().clickable { edit(task) }.padding(vertical = 8.dp), style = MaterialTheme.typography.bodyLarge)
                                task.effectiveDate?.let { Text(displayDate(it, java.time.LocalDate.now()), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                val metadata = taskValues(task, "projects") + taskValues(task, "tags").map { "#$it" }
                                if (metadata.isNotEmpty()) Text(metadata.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                                Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                    if (task.isRecurring) Icon(Icons.Default.Repeat, "Repeating task", Modifier.size(16.dp))
                                    Spacer(Modifier.weight(1f))
                                    TextButton(onClick = { moving = task }, enabled = !model.busy) { Text("Move"); Icon(Icons.Default.ChevronRight, null, Modifier.size(18.dp)) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    moving?.let { task -> FacetChoiceSheet("Move task", choices, { moving = null }) { model.move(profile.id, task, it); moving = null } }
}

@Composable
internal fun FacetViews(model: FacetViewModel, opened: (String) -> Unit) {
    var draft by rememberSaveable(stateSaver = listSaver<FacetSavedViewIntent?, String>(
        save = { it?.saved().orEmpty() }, restore = { if (it.isEmpty()) null else FacetSavedViewIntent.restore(it) })) { mutableStateOf(null) }
    var deleting by remember { mutableStateOf<JsonObject?>(null) }
    var restore by remember { mutableStateOf(false) }
    val views = model.allSnapshot?.views.orEmpty()
    LazyColumn(Modifier.padding(horizontal = 16.dp), contentPadding = PaddingValues(bottom = 88.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Text("Keep a useful view", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 16.dp))
            Text("Save the current filters, grouping and ordering.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 8.dp))
            OutlinedButton(onClick = { draft = model.viewIntent() }) { Icon(Icons.Default.Add, null); Spacer(Modifier.width(8.dp)); Text("Save current view") }
        }
        items(views, key = { it.getValue("id").jsonPrimitive.content }) { view ->
            var actions by remember { mutableStateOf(false) }
            val heading = view.getValue("view").jsonObject.getValue("name").jsonPrimitive.content
            Surface(shape = MaterialTheme.shapes.medium) {
                ListItem(headlineContent = { Text(heading) }, leadingContent = { Icon(Icons.Default.BookmarkBorder, null, tint = MaterialTheme.colorScheme.primary) },
                    modifier = Modifier.fillMaxWidth().clickable { model.openView(view); opened(heading) },
                    trailingContent = {
                        Box {
                            IconButton(onClick = { actions = true }) { Icon(Icons.Default.MoreHoriz, "Actions for $heading") }
                            DropdownMenu(actions, { actions = false }) {
                                DropdownMenuItem(text = { Text("Update with current filters") }, onClick = { actions = false; draft = model.viewIntent(view) })
                                DropdownMenuItem(text = { Text("Duplicate") }, enabled = !model.busy, onClick = { actions = false; model.duplicateView(view) })
                                DropdownMenuItem(text = { Text("Move up") }, enabled = !model.busy && views.firstOrNull() != view, onClick = { actions = false; model.moveView(view, views.indexOf(view) - 1) })
                                DropdownMenuItem(text = { Text("Move down") }, enabled = !model.busy && views.lastOrNull() != view, onClick = { actions = false; model.moveView(view, views.indexOf(view) + 1) })
                                DropdownMenuItem(text = { Text("Delete") }, onClick = { actions = false; deleting = view })
                            }
                        }
                    })
            }
        }
        item { TextButton(onClick = { restore = true }, enabled = !model.busy) { Text("Restore default views") } }
    }
    draft?.let { intent ->
        val submitted = intent.mutationId in model.submittedActions || model.pendingActions.any { it.mutationId == intent.mutationId }
        val blocked = model.busy || submitted
        FacetSheet("Save view", { if (!model.busy) draft = null }, "Save", !blocked && intent.name.isNotBlank(), save = {
            model.saveView(intent) { if (draft == intent) draft = null }
        }) {
            Text("The filters, grouping and ordering captured when this form opened will be saved with this name.")
            if (submitted) Text("This action was submitted. Review Saved actions in Settings before changing this view.", color = MaterialTheme.colorScheme.error)
            OutlinedTextField(intent.name, { draft = intent.renamed(it) }, label = { Text("Name") }, enabled = !blocked, modifier = Modifier.fillMaxWidth())
        }
    }
    deleting?.let { view -> Confirmation("Delete saved view?", "The task notes remain in the vault.", "Delete", { deleting = null }) { model.deleteView(view); deleting = null } }
    if (restore) Confirmation("Restore default views?", "The current saved views will be replaced by TaskNotes defaults.", "Restore", { restore = false }) { model.restoreViews(); restore = false }
}
