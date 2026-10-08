package red.sjer.facet

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import java.util.UUID
import kotlinx.serialization.json.*
import red.sjer.facet.host.VaultTask

@Composable
internal fun ChoiceField(label: String, value: String, choices: List<WorkflowOption>, enabled: Boolean = true, change: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Text("$label: ${choices.firstOrNull { it.value == value }?.label ?: value}") }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            choices.forEach { option -> DropdownMenuItem(text = { Text(option.label) }, onClick = { open = false; change(option.value) }) }
        }
    }
}

private val DraftSaver = listSaver<TaskEditorDraft, String>(
    save = { listOf(it.title, it.body, it.status, it.priority, it.due, it.scheduled, it.recurrence, it.recurrenceAnchor, it.projects, it.contexts, it.tags, it.estimate, it.completedDate, it.completeInstances, it.skippedInstances, it.blockedBy, it.timeEntries, it.reminders, it.attachments, it.dateCreated) },
    restore = { TaskEditorDraft(it[0], it[1], it[2], it[3], it[4], it[5], it[6], it[7], it[8], it[9], it[10], it[11], it[12], it[13], it[14], it[15], it[16], it[17], it[18], it[19]) },
)

private val TaskBasisSaver = listSaver<VaultTask, String>(
    save = { saveTaskBasis(it) },
    restore = ::restoreTaskBasis,
)
private val WorkflowSaver = listSaver<List<WorkflowOption>, String>(
    save = { it.flatMap { option -> listOf(option.value, option.label) } },
    restore = { it.chunked(2).map { pair -> WorkflowOption(pair[0], pair[1]) } },
)

@Composable
internal fun TaskEditor(profileId: String, task: VaultTask, model: FacetViewModel, dismiss: () -> Unit) {
    var basis by rememberSaveable(profileId, task.id, stateSaver = TaskBasisSaver) { mutableStateOf(task) }
    val original = remember(basis) { TaskEditorDraft.from(basis) }
    val statuses = rememberSaveable(profileId, task.id, saver = WorkflowSaver) { workflow(model.snapshot?.configuration, "statuses") }
    val priorities = rememberSaveable(profileId, task.id, saver = WorkflowSaver) { workflow(model.snapshot?.configuration, "priorities") }
    var draft by rememberSaveable(profileId, task.id, stateSaver = DraftSaver) { mutableStateOf(original) }
    var discard by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var section by rememberSaveable { mutableStateOf("Details") }
    val mutationId = rememberSaveable(profileId, task.id, draft) { UUID.randomUUID().toString() }
    LaunchedEffect(profileId, basis.path, basis.revision, section) {
        if (section == "Time") model.loadTrackingHistory(profileId, basis)
    }
    fun close() { if (draft != original) discard = true else dismiss() }
    AlertDialog(onDismissRequest = { if (!model.busy) close() }, title = { Text(task.title) }, text = {
        Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("Details", "Recurrence", "Time", "Extras").forEach { label -> FilterChip(selected = section == label, onClick = { section = label }, label = { Text(label) }) }
            }
            when (section) {
                "Details" -> {
                    OutlinedTextField(draft.title, { draft = draft.copy(title = it) }, label = { Text("Title") }, enabled = !model.busy, modifier = Modifier.fillMaxWidth())
                    ChoiceField("Status", draft.status, statuses, !model.busy) { draft = draft.copy(status = it) }
                    ChoiceField("Priority", draft.priority, priorities, !model.busy) { draft = draft.copy(priority = it) }
                    DraftField("Due date (YYYY-MM-DD)", draft.due, model.busy) { draft = draft.copy(due = it) }
                    DraftField("Scheduled date (YYYY-MM-DD)", draft.scheduled, model.busy) { draft = draft.copy(scheduled = it) }
                    DraftField("Projects (comma separated)", draft.projects, model.busy) { draft = draft.copy(projects = it) }
                    DraftField("Contexts (comma separated)", draft.contexts, model.busy) { draft = draft.copy(contexts = it) }
                    DraftField("Tags (comma separated)", draft.tags, model.busy) { draft = draft.copy(tags = it) }
                    DraftField("Blocked by task references", draft.blockedBy, model.busy) { draft = draft.copy(blockedBy = it) }
                    OutlinedTextField(draft.body, { draft = draft.copy(body = it) }, label = { Text("Note") }, minLines = 4, enabled = !model.busy, modifier = Modifier.fillMaxWidth())
                }
                "Recurrence" -> {
                    DraftField("Recurrence rule", draft.recurrence, model.busy) { draft = draft.copy(recurrence = it) }
                    DraftField("Recurrence anchor", draft.recurrenceAnchor, model.busy) { draft = draft.copy(recurrenceAnchor = it) }
                    DraftField("Completed date", draft.completedDate, model.busy) { draft = draft.copy(completedDate = it) }
                    DraftField("Completed occurrences (dates)", draft.completeInstances, model.busy) { draft = draft.copy(completeInstances = it) }
                    DraftField("Skipped occurrences (dates)", draft.skippedInstances, model.busy) { draft = draft.copy(skippedInstances = it) }
                    task.occurrenceDate?.let { Text("Selected occurrence: $it") }
                }
                "Time" -> {
                    DraftField("Estimate (minutes)", draft.estimate, model.busy) { draft = draft.copy(estimate = it) }
                    Text("${basis.totalTrackedMinutes} minutes tracked")
                    model.trackingHistory?.takeIf { page -> page.owner.profileId == profileId && page.owner.taskPath == basis.path && page.owner.taskRevision == basis.revision }?.let { page ->
                        Text("${page.rows.size} entries on this page · ${page.totalCount} total")
                        if (page.problemCount != 0uL) Text("${page.problemCount} entries need review")
                        page.rows.forEach { row -> Text("${row.getValue("startedAt").jsonPrimitive.content} → ${row.getValue("endedAt").jsonPrimitive.contentOrNull ?: "Running"} · ${row.getValue("elapsedSeconds").jsonPrimitive.content} seconds") }
                        if (page.next != null) Button(onClick = { model.loadTrackingHistory(profileId, basis, true) }, enabled = !model.busy) { Text("More time entries") }
                    }
                    Button(onClick = { model.track(profileId, basis, !basis.hasActiveTimeSession) { changed -> basis = changed; draft = TaskEditorDraft.from(changed) } }, enabled = !model.busy && draft == original) { Text(if (basis.hasActiveTimeSession) "Stop tracking" else "Start tracking") }
                    TypedTimeEntries(draft.timeEntries, model.busy) { draft = draft.copy(timeEntries = it) }
                }
                "Extras" -> {
                    DraftField("Created time (explicit RFC3339)", draft.dateCreated, model.busy) { draft = draft.copy(dateCreated = it) }
                    OutlinedTextField(draft.attachments, { draft = draft.copy(attachments = it) }, label = { Text("Attachment references (one per line)") }, minLines = 2, enabled = !model.busy, modifier = Modifier.fillMaxWidth())
                    TypedReminders(draft.reminders, model.busy) { draft = draft.copy(reminders = it) }
                }
            }
            TextButton(onClick = { deleting = true }, enabled = !model.busy) { Text("Delete task") }
        }
    }, confirmButton = { TextButton(onClick = { model.update(profileId, basis, draft, mutationId, dismiss) }, enabled = !model.busy && draft.title.isNotBlank()) { Text("Save") } }, dismissButton = { TextButton(onClick = ::close, enabled = !model.busy) { Text("Cancel") } })
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text("Discard unsaved changes?") }, text = { Text("Your changes have not been saved to this vault.") }, confirmButton = { TextButton(onClick = { discard = false; dismiss() }) { Text("Discard") } }, dismissButton = { TextButton(onClick = { discard = false }) { Text("Keep editing") } })
    if (deleting) AlertDialog(onDismissRequest = { deleting = false }, title = { Text("Delete task?") }, text = { Text("The task note will be deleted from this vault.") }, confirmButton = { TextButton(onClick = { model.delete(profileId, basis, dismiss) }, enabled = !model.busy) { Text("Delete") } }, dismissButton = { TextButton(onClick = { deleting = false }) { Text("Cancel") } })
}

@Composable
private fun DraftField(label: String, value: String, busy: Boolean, change: (String) -> Unit) = OutlinedTextField(value, change, label = { Text(label) }, singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth())

@Composable
internal fun CaptureForm(profileId: String, model: FacetViewModel, dismiss: () -> Unit) {
    var input by rememberSaveable(profileId) { mutableStateOf("") }
    var discard by remember { mutableStateOf(false) }
    val preview = model.capturePreview.takeIf { model.capturePreviewOwner == profileId }
    val mutationId = rememberSaveable(profileId, input) { UUID.randomUUID().toString() }
    LaunchedEffect(profileId, input) { if (input.isNotBlank()) model.preview(profileId, input) }
    fun close() { if (input.isNotBlank()) discard = true else dismiss() }
    AlertDialog(onDismissRequest = { if (!model.busy) close() }, title = { Text("Add task") }, text = {
        Column(Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(input, { input = it }, label = { Text("Task, dates, projects and tags") }, placeholder = { Text("Ship tomorrow !high p:Work @desktop #release") }, minLines = 2, modifier = Modifier.fillMaxWidth())
            preview?.let {
                val properties = it.getValue("properties").jsonObject
                properties.forEach { (key, value) -> Text("$key: ${value.toString()}", style = MaterialTheme.typography.bodySmall) }
            }
        }
    }, confirmButton = { TextButton(onClick = { preview?.let { model.create(profileId, it, mutationId, dismiss) } }, enabled = !model.busy && input.isNotBlank() && preview != null && model.capturePreviewInput == input) { Text("Save") } }, dismissButton = { TextButton(onClick = ::close, enabled = !model.busy) { Text("Cancel") } })
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text("Discard this task draft?") }, confirmButton = { TextButton(onClick = dismiss) { Text("Discard") } }, dismissButton = { TextButton(onClick = { discard = false }) { Text("Keep editing") } })
}

@Composable
internal fun SignInForm(model: FacetViewModel) {
    var email by remember { mutableStateOf("") }; var password by remember { mutableStateOf("") }; var code by remember { mutableStateOf("") }
    var vaultPassword by remember { mutableStateOf("") }
    LaunchedEffect(model.remoteChoices) { if (model.remoteChoices.isNotEmpty()) { password = ""; code = "" } }
    Text("Your tasks, with your vault", style = MaterialTheme.typography.headlineMedium)
    Text("Connect an existing Obsidian Sync vault. Your private copy remains available offline.")
    OutlinedTextField(email, { email = it }, label = { Text("Obsidian email") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(password, { password = it }, label = { Text("Obsidian password") }, visualTransformation = PasswordVisualTransformation(), singleLine = true, modifier = Modifier.fillMaxWidth())
    if (model.needsCode) OutlinedTextField(code, { code = it }, label = { Text("Verification code") }, singleLine = true)
    Button(onClick = { model.signIn(email, password, code) }, enabled = !model.busy && email.isNotBlank() && password.isNotEmpty()) { Text("Sign in") }
    Button(onClick = model::discoverVaults, enabled = !model.busy) { Text("Discover authorized vaults") }
    if (model.remoteChoices.isNotEmpty()) {
        OutlinedTextField(vaultPassword, { vaultPassword = it }, label = { Text("Vault encryption password") }, visualTransformation = PasswordVisualTransformation(), singleLine = true, modifier = Modifier.fillMaxWidth())
        model.remoteChoices.forEach { choice ->
            Button(onClick = { model.connect(choice, if (choice.managed) null else vaultPassword) }, enabled = !model.busy && (choice.managed || vaultPassword.isNotEmpty())) { Text("Connect ${choice.name}") }
            model.selected?.takeIf { it.kind == "obsidian_sync" }?.let { profile ->
                TextButton(onClick = { model.reauthorize(profile.id, choice, if (choice.managed) null else vaultPassword) }, enabled = !model.busy && (choice.managed || vaultPassword.isNotEmpty())) { Text("Reauthorize ${profile.name} with ${choice.name}") }
            }
        }
    }
}
