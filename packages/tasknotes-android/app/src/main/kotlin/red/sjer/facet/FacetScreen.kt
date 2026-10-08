package red.sjer.facet

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import kotlinx.serialization.json.*
import red.sjer.facet.host.VaultTask

private fun taskKey(task: VaultTask) = "${task.path}:${task.occurrenceDate.orEmpty()}"
private val EditorIdentitySaver = listSaver<Pair<String, VaultTask>?, String>(save = { it?.let(::saveEditorIdentity) ?: emptyList() }, restore = { if (it.isEmpty()) null else restoreEditorIdentity(it) })

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FacetScreen(model: FacetViewModel) {
    var destination by rememberSaveable { mutableStateOf("Tasks") }
    var captureOwner by rememberSaveable { mutableStateOf<String?>(null) }
    var editor by rememberSaveable(stateSaver = EditorIdentitySaver) { mutableStateOf<Pair<String, VaultTask>?>(null) }
    var vaultMenu by remember { mutableStateOf(false) }
    val profile = model.selected
    val reminder = model.pendingReminder
    LaunchedEffect(reminder, model.busy, editor, captureOwner) {
        if (reminder != null && !model.busy && editor == null && captureOwner == null) {
            model.openReminder(reminder) { owner, task -> destination = "Tasks"; editor = owner to task }
        }
    }
    Scaffold(topBar = {
        TopAppBar(title = {
            Box {
                TextButton(onClick = { vaultMenu = true }) { Text(profile?.name ?: "Facet") }
                DropdownMenu(vaultMenu, { vaultMenu = false }) {
                    model.profiles.forEach { vault -> DropdownMenuItem(text = { Text(vault.name) }, onClick = { model.select(vault); vaultMenu = false }) }
                    DropdownMenuItem(text = { Text("Account and vaults") }, onClick = { destination = "Settings"; vaultMenu = false })
                }
            }
        }, actions = {
            TextButton(onClick = model::refresh, enabled = !model.busy) { Text("Refresh") }
            TextButton(onClick = { destination = "Settings" }) { Text("Settings") }
        })
    }, floatingActionButton = {
        if (profile != null && model.snapshot?.configuration != null && destination != "Settings") FloatingActionButton(onClick = { captureOwner = profile.id }) { Text("+") }
    }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            if (model.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (model.syncState.isNotBlank()) Text(model.syncState, Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall)
            if (model.savedNotice != null || model.savedMaintenance != null) {
                Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Saved", style = MaterialTheme.typography.titleSmall)
                    model.savedNotice?.messages?.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                    model.savedMaintenance?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                }
            }
            if (profile == null) {
                Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) { SignInForm(model); FolderImport(model) }
            } else {
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("Tasks", "Board", "Views", "Conflicts").forEach { label -> FilterChip(selected = destination == label, onClick = { destination = label }, label = { Text(label) }) }
                }
                if (model.snapshot?.configuration == null && destination != "Settings") {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Waiting for TaskNotes settings", style = MaterialTheme.typography.titleLarge)
                        Text("The vault stays available while its existing configuration is synchronized.")
                        model.snapshot?.problems?.forEach { Text(it.message) }
                        if (model.needsStandardConsent) Button(onClick = model::approveStandard, enabled = !model.busy) { Text("Use standard TaskNotes configuration") }
                    }
                } else when (destination) {
                    "Tasks" -> TaskList(model) { editor = profile.id to it }
                    "Board" -> Board(model) { editor = profile.id to it }
                    "Views" -> Views(model) { destination = "Tasks" }
                    "Conflicts" -> ConflictScreen(model)
                    "Settings" -> Settings(model)
                }
            }
        }
    }
    captureOwner?.let { owner -> CaptureForm(owner, model) { captureOwner = null } }
    editor?.let { (owner, task) -> TaskEditor(owner, task, model) { editor = null } }
    if (reminder != null && (editor != null || captureOwner != null)) Confirmation(
        "Open this reminder?",
        "An editor is open. Continuing discards its unsaved draft and opens the task in the reminder's owning vault.",
        "Discard draft and open", { model.dismissReminder(reminder) }
    ) {
        if (!model.busy) {
            editor = null; captureOwner = null
            model.openReminder(reminder) { owner, task -> destination = "Tasks"; editor = owner to task }
        }
    }
    model.error?.let { message -> AlertDialog(onDismissRequest = model::dismissError, title = { Text("Action needs attention") }, text = { Text(message) }, confirmButton = { TextButton(onClick = model::dismissError) { Text("OK") } }) }
}

@Composable
private fun TaskList(model: FacetViewModel, edit: (VaultTask) -> Unit) {
    val profile = requireNotNull(model.selected)
    val snapshot = model.snapshot
    var selected by remember(profile.id, model.query) { mutableStateOf<Set<String>>(emptySet()) }
    var bulkAction by remember { mutableStateOf<String?>(null) }
    var bulkValue by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        QueryControls(model)
        Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${snapshot?.totalCount ?: 0uL} tasks", Modifier.weight(1f))
            TextButton(onClick = model::undo, enabled = !model.busy && model.undoDepth > 0) { Text("Undo (${model.undoDepth})") }
        }
        if (selected.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { selected = emptySet() }) { Text("Clear ${selected.size}") }
            listOf("complete", "schedule", "priority", "delete").forEach { action -> TextButton(onClick = { bulkValue = ""; bulkAction = action }, enabled = !model.busy) { Text(action.replaceFirstChar { it.uppercase() }) } }
        }
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 88.dp)) {
            items(snapshot?.tasks.orEmpty(), key = ::taskKey) { task ->
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Checkbox(checked = taskKey(task) in selected, onCheckedChange = { checked -> selected = if (checked) selected + taskKey(task) else selected - taskKey(task) })
                    Checkbox(checked = task.completed, onCheckedChange = { model.toggle(profile.id, task) }, enabled = !model.busy)
                    Column(Modifier.weight(1f).clickable { edit(task) }.padding(vertical = 12.dp)) {
                        Text(task.title, style = MaterialTheme.typography.titleMedium)
                        val details = listOfNotNull(task.occurrenceDate ?: task.effectiveDate, task.status, task.priority.takeIf { it.isNotEmpty() }, "Blocked".takeIf { task.isBlocked }, "Pending sync".takeIf { task.isPending })
                        Text(details.joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                    }
                }
                HorizontalDivider()
            }
            if (snapshot != null && snapshot.tasks.size.toULong() < snapshot.totalCount) item { TextButton(onClick = model::loadMore, enabled = !model.busy) { Text("Load more tasks") } }
        }
    }
    bulkAction?.let { action ->
        val tasks = snapshot?.tasks.orEmpty().filter { taskKey(it) in selected }
        AlertDialog(onDismissRequest = { bulkAction = null }, title = { Text("${action.replaceFirstChar { it.uppercase() }} ${tasks.size} tasks?") }, text = {
            when (action) {
                "schedule" -> OutlinedTextField(bulkValue, { bulkValue = it }, label = { Text("Scheduled date (YYYY-MM-DD; empty clears)") })
                "priority" -> ChoiceField("Priority", bulkValue, workflow(snapshot?.configuration, "priorities")) { bulkValue = it }
                else -> Text("Apply this action to the selected notes in ${profile.name}.")
            }
        }, confirmButton = { TextButton(onClick = { model.bulk(profile.id, tasks, action, bulkValue); bulkAction = null }, enabled = !model.busy) { Text("Apply") } }, dismissButton = { TextButton(onClick = { bulkAction = null }) { Text("Cancel") } })
    }
}

@Composable
private fun QueryControls(model: FacetViewModel) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    val query = model.query
    Column(Modifier.padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("inbox", "today", "agenda", "upcoming", "overdue", "all", "completed", "undated").forEach { scope -> FilterChip(query.scope == scope && query.viewId == null, onClick = { model.changeQuery(query.copy(scope = scope, viewId = null)) }, label = { Text(scope.replaceFirstChar { it.uppercase() }) }) }
        }
        OutlinedTextField(query.text, { model.changeQuery(query.copy(text = it)) }, label = { Text("Search tasks") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Hide filters" else "Filters, sort and grouping") }
        if (expanded) Column(Modifier.heightIn(max = 300.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            ChoiceField("Status", query.statuses.singleOrNull().orEmpty(), listOf(WorkflowOption("", "Any")) + workflow(model.snapshot?.configuration, "statuses")) { model.changeQuery(query.copy(statuses = listOf(it).filter(String::isNotEmpty))) }
            ChoiceField("Priority", query.priorities.singleOrNull().orEmpty(), listOf(WorkflowOption("", "Any")) + workflow(model.snapshot?.configuration, "priorities")) { model.changeQuery(query.copy(priorities = listOf(it).filter(String::isNotEmpty))) }
            listOf("projects", "contexts", "tags").forEach { field ->
                val values = model.allSnapshot?.tasks.orEmpty().flatMap { task -> when (val value = task.properties[field]) { is JsonArray -> value.map { it.jsonPrimitive.content }; is JsonPrimitive -> listOfNotNull(value.contentOrNull); else -> emptyList() } }.distinct().sorted()
                val selected = when (field) { "projects" -> query.projects; "contexts" -> query.contexts; else -> query.tags }
                ChoiceField(field.replaceFirstChar { it.uppercase() }, selected.singleOrNull().orEmpty(), listOf(WorkflowOption("", "Any")) + values.map { WorkflowOption(it, it) }) { value ->
                    val next = listOf(value).filter(String::isNotEmpty)
                    model.changeQuery(when (field) { "projects" -> query.copy(projects = next); "contexts" -> query.copy(contexts = next); else -> query.copy(tags = next) })
                }
            }
            ChoiceField("Sort", query.sort, listOf("title", "priority", "status", "dueDate", "effectiveDate", "manual").map { WorkflowOption(it, it) }) { model.changeQuery(query.copy(sort = it)) }
            Row { Switch(query.descending, onCheckedChange = { model.changeQuery(query.copy(descending = it)) }); Text("Descending", Modifier.padding(12.dp)) }
            ChoiceField("Group", query.group.orEmpty(), listOf(WorkflowOption("", "None")) + listOf("status", "priority", "project", "context", "effectiveDate").map { WorkflowOption(it, it) }) { model.changeQuery(query.copy(group = it.takeIf(String::isNotEmpty))) }
            TextButton(onClick = { model.changeQuery(FacetQuery(scope = query.scope)) }) { Text("Clear filters") }
        }
    }
}

@Composable
private fun Board(model: FacetViewModel, edit: (VaultTask) -> Unit) {
    val profile = requireNotNull(model.selected)
    val tasks = model.allSnapshot?.tasks.orEmpty()
    val configured = workflow(model.snapshot?.configuration, "statuses")
    val choices = configured + tasks.map { it.status }.distinct().filter { raw -> configured.none { it.value == raw } }.map { WorkflowOption(it, it) }
    Row(Modifier.fillMaxSize().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        choices.forEach { status ->
            Column(Modifier.width(280.dp).fillMaxHeight().padding(8.dp)) {
                Text(status.label, style = MaterialTheme.typography.titleLarge)
                LazyColumn(contentPadding = PaddingValues(bottom = 88.dp)) {
                    items(tasks.filter { it.status == status.value }, key = { it.path }) { task ->
                        ElevatedCard(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(task.title, Modifier.clickable { edit(task) }, style = MaterialTheme.typography.titleMedium)
                                task.effectiveDate?.let { Text(it) }
                                ChoiceField("Move to", task.status, choices, !model.busy) { model.move(profile.id, task, it) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Views(model: FacetViewModel, opened: () -> Unit) {
    var editing by remember { mutableStateOf<JsonObject?>(null) }
    var name by rememberSaveable { mutableStateOf("") }
    var showName by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<JsonObject?>(null) }
    var restore by remember { mutableStateOf(false) }
    val views = model.allSnapshot?.views.orEmpty()
    LazyColumn(Modifier.padding(12.dp), contentPadding = PaddingValues(bottom = 88.dp)) {
        item {
            Button(onClick = { editing = null; name = ""; showName = true }) { Text("Save current task view") }
            TextButton(onClick = { restore = true }, enabled = !model.busy) { Text("Restore default views") }
        }
        items(views, key = { it.getValue("id").jsonPrimitive.content }) { view ->
            Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                TextButton(onClick = { model.openView(view); opened() }) { Text(view.getValue("view").jsonObject.getValue("name").jsonPrimitive.content) }
                Row(Modifier.horizontalScroll(rememberScrollState())) {
                    TextButton(onClick = { editing = view; name = view.getValue("view").jsonObject.getValue("name").jsonPrimitive.content; showName = true }) { Text("Update") }
                    TextButton(onClick = { model.duplicateView(view) }, enabled = !model.busy) { Text("Duplicate") }
                    TextButton(onClick = { model.moveView(view, views.indexOf(view) - 1) }, enabled = !model.busy && views.firstOrNull() != view) { Text("Up") }
                    TextButton(onClick = { model.moveView(view, views.indexOf(view) + 1) }, enabled = !model.busy && views.lastOrNull() != view) { Text("Down") }
                    TextButton(onClick = { deleting = view }) { Text("Delete") }
                }
            }
        }
    }
    if (showName) AlertDialog(onDismissRequest = { showName = false }, title = { Text("Save task view") }, text = { Column { Text("Save the current filters and ordering with this name."); OutlinedTextField(name, { name = it }, label = { Text("Name") }) } }, confirmButton = { TextButton(onClick = { model.saveView(name, editing); showName = false }, enabled = !model.busy && name.isNotBlank()) { Text("Save") } }, dismissButton = { TextButton(onClick = { showName = false }) { Text("Cancel") } })
    deleting?.let { view -> Confirmation("Delete saved view?", "The task notes remain in the vault.", "Delete", { deleting = null }) { model.deleteView(view); deleting = null } }
    if (restore) Confirmation("Restore default views?", "The current saved views will be replaced by TaskNotes defaults.", "Restore", { restore = false }) { model.restoreViews(); restore = false }
}

@Composable
private fun Settings(model: FacetViewModel) {
    var signOut by remember { mutableStateOf(false) }
    var remove by remember { mutableStateOf<red.sjer.facet.host.VaultProfile?>(null) }
    var retire by remember { mutableStateOf<red.sjer.facet.host.PendingFacetMutation?>(null) }
    Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SignInForm(model)
        FolderImport(model)
        ReminderSettings(model)
        TextButton(onClick = { signOut = true }, enabled = !model.busy) { Text("Sign out and retain replicas") }
        model.selected?.let { profile -> TextButton(onClick = { remove = profile }, enabled = !model.busy) { Text("Remove this vault from Facet") } }
        Text("Saved actions", style = MaterialTheme.typography.titleLarge)
        if (model.pendingActions.isEmpty()) Text("No saved actions need resuming.")
        model.pendingActions.forEach { action ->
            val owner = model.profiles.firstOrNull { it.id == action.profileId }?.name ?: action.profileId
            Text("${if (action.canResume) action.mutation.getValue("command").jsonObject.getValue("kind").jsonPrimitive.content else "Removed feature action"} · $owner")
            TextButton(onClick = { model.resume(action) }, enabled = !model.busy && action.canResume) { Text("Resume saved action") }
            TextButton(onClick = { retire = action }, enabled = !model.busy) { Text("Retire saved action") }
        }
        model.snapshot?.let { Text("${it.pendingCount} pending uploads · ${it.conflictCount} conflicts"); it.problems.forEach { problem -> Text("${problem.path}: ${problem.message}") } }
    }
    if (signOut) Confirmation("Sign out?", "Synchronization stops before credentials are removed. Vault copies and pending actions remain on this device.", "Sign out", { signOut = false }) { model.signOut(); signOut = false }
    remove?.let { profile -> Confirmation("Remove ${profile.name}?", "Facet stops synchronization and removes this vault's settled app state and access key. Files remain intact. Pending uploads, conflicts or saved actions must be resolved first.", "Remove vault", { remove = null }) { model.removeProfile(profile); remove = null } }
    retire?.let { action -> Confirmation("Retire saved action?", if (action.canResume) "The native engine must confirm this action is absent or parked. Pending and applied actions stay retained. No preserved conflict versions are removed." else "Facet checks the original saved outcome before clearing this private draft. Pending work remains retained; applied changes and preserved vault versions remain intact.", "Check and retire", { retire = null }) { model.retireRejected(action); retire = null } }
}

@Composable
internal fun Confirmation(title: String, message: String, action: String, dismiss: () -> Unit, confirm: () -> Unit) {
    AlertDialog(onDismissRequest = dismiss, title = { Text(title) }, text = { Text(message) }, confirmButton = { TextButton(onClick = confirm) { Text(action) } }, dismissButton = { TextButton(onClick = dismiss) { Text("Cancel") } })
}
