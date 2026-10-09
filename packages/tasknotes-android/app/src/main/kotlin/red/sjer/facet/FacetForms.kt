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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import java.util.UUID
import kotlinx.serialization.json.*
import red.sjer.facet.host.VaultTask

@Composable
internal fun ChoiceField(label: String, value: String, choices: List<WorkflowOption>, enabled: Boolean = true, change: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    FacetFieldRow(label, choices.firstOrNull { it.value == value }?.label ?: value,
        if (label == "Priority") Icons.Default.Flag else Icons.Default.Tune, enabled) { open = true }
    if (open) FacetChoiceSheet(label, choices, { open = false }) { open = false; change(it) }
}

private val DraftSaver = listSaver<TaskEditorDraft, String>(
    save = { listOf(it.title, it.body, it.status, it.priority, it.due, it.scheduled, it.recurrence, it.recurrenceAnchor, it.projects, it.contexts, it.tags, it.completedDate, it.completeInstances, it.skippedInstances, it.blockedBy, it.reminders, it.attachments, it.dateCreated, it.tokenEdits.toString()) },
    restore = { TaskEditorDraft(it[0], it[1], it[2], it[3], it[4], it[5], it[6], it[7], it[8], it[9], it[10], it[11], it[12], it[13], it[14], it[15], it[16], it[17], Json.parseToJsonElement(it[18]).jsonObject) },
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
    var extras by rememberSaveable(profileId, task.id) { mutableStateOf(false) }
    val mutationId = rememberSaveable(profileId, task.id, draft) { UUID.randomUUID().toString() }
    val submitted = mutationId in model.submittedActions || model.pendingActions.any { it.mutationId == mutationId }
    val blocked = model.busy || submitted
    fun close() { if (!submitted && draft != original) discard = true else dismiss() }
    FacetSheet("Task details", { if (!model.busy) close() }, "Save", !blocked && draft.title.isNotBlank(),
        save = { model.update(profileId, basis, draft, mutationId, dismiss) }) {
            if (submitted) Text("This action was submitted. Your original draft is retained; review Saved actions in Settings to resume its exact action or check its outcome.", color = MaterialTheme.colorScheme.error)
            Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
                Column {
                    val colors = TextFieldDefaults.colors(focusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer, disabledContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                        focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent, unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                        disabledIndicatorColor = androidx.compose.ui.graphics.Color.Transparent)
                    TextField(draft.title, { draft = draft.copy(title = it) }, placeholder = { Text("Task title") }, textStyle = MaterialTheme.typography.headlineLarge,
                        colors = colors, enabled = !blocked, modifier = Modifier.fillMaxWidth())
                    HorizontalDivider(Modifier.padding(horizontal = 16.dp))
                    TextField(draft.body, { draft = draft.copy(body = it) }, placeholder = { Text("Add details · Markdown supported") },
                        minLines = 3, colors = colors, enabled = !blocked, modifier = Modifier.fillMaxWidth())
                }
            }
            Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
                Column {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        FacetTaskCheckbox(basis, model.snapshot?.configuration, !blocked && draft == original && (!basis.isRecurring || basis.occurrenceDate != null)) { model.toggle(profileId, basis, dismiss) }
                        Text(if (basis.completed) "Completed" else "Mark complete", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                        if (basis.isRecurring) Icon(Icons.Default.Repeat, "Repeating task", Modifier.size(20.dp))
                    }
                    if (draft != original) Text("Save your changes before changing completion.", Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall)
                    else if (basis.isRecurring && basis.occurrenceDate == null) Text("Choose a recurring occurrence in Today or Agenda.", Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall)
                }
            }
            Text("Plan", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
                Column {
                    FacetDateField("Planned", draft.scheduled, !blocked) { draft = draft.copy(scheduled = it) }
                    HorizontalDivider(Modifier.padding(horizontal = 16.dp))
                    FacetDateField("Deadline", draft.due, !blocked) { draft = draft.copy(due = it) }
                    HorizontalDivider(Modifier.padding(horizontal = 16.dp))
                    ChoiceField("Priority", draft.priority, priorities, !blocked) { draft = draft.copy(priority = it) }
                }
            }
            Text("Repeat", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
                Column {
                    FacetRecurrenceField(draft.recurrence, !blocked) { draft = draft.copy(recurrence = it) }
                    if (draft.recurrence.isNotEmpty()) ChoiceField("Anchor", draft.recurrenceAnchor,
                        listOf(WorkflowOption("scheduled", "From planned date"), WorkflowOption("completion", "After completion")), !blocked) { draft = draft.copy(recurrenceAnchor = it) }
                }
            }
            Text("Organize", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Surface(modifier = Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    listOf("projects", "contexts", "tags").forEach { field ->
                        val values = draft.tokenEdits[field]?.jsonArray?.map { it.jsonPrimitive.content } ?: taskValues(basis, field)
                        val suggestions = model.allSnapshot?.tasks.orEmpty().flatMap { taskValues(it, field) }.distinct().sorted()
                        FacetTokenField(field.replaceFirstChar { it.uppercase() }, values, suggestions, !blocked) {
                            draft = draft.copy(tokenEdits = JsonObject(draft.tokenEdits + (field to strings(it))))
                        }
                    }
                }
            }
            Text("Dependencies", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (basis.isBlocked) Text("Blocked by other work", style = MaterialTheme.typography.bodyMedium)
            if (basis.isBlocking) Text("Blocking other work", style = MaterialTheme.typography.bodyMedium)
            DraftField("Blocked by task references", draft.blockedBy, blocked) { draft = draft.copy(blockedBy = it) }
            TextButton(onClick = { deleting = true }, enabled = !blocked) { Icon(Icons.Default.DeleteOutline, null, tint = MaterialTheme.colorScheme.error); Spacer(Modifier.width(8.dp)); Text("Delete task", color = MaterialTheme.colorScheme.error) }
            TextButton(onClick = { extras = !extras }) { Text(if (extras) "Hide additional fields" else "Additional fields"); Icon(if (extras) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null) }
            if (extras) {
                ChoiceField("Status", draft.status, statuses, !blocked) { draft = draft.copy(status = it) }
                FacetDateField("Completed date", draft.completedDate, !blocked) { draft = draft.copy(completedDate = it) }
                DraftField("Completed occurrences", draft.completeInstances, blocked) { draft = draft.copy(completeInstances = it) }
                DraftField("Skipped occurrences", draft.skippedInstances, blocked) { draft = draft.copy(skippedInstances = it) }
                DraftField("Created time · RFC3339", draft.dateCreated, blocked) { draft = draft.copy(dateCreated = it) }
                OutlinedTextField(draft.attachments, { draft = draft.copy(attachments = it) }, label = { Text("Attachment references · one per line") }, minLines = 2, enabled = !blocked, modifier = Modifier.fillMaxWidth())
                TypedReminders(draft.reminders, blocked) { draft = draft.copy(reminders = it) }
                basis.occurrenceDate?.let { Text("Selected occurrence: $it", style = MaterialTheme.typography.bodySmall) }
            }
    }
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text("Discard unsaved changes?") }, text = { Text("Your changes have not been saved to this vault.") }, confirmButton = { TextButton(onClick = { discard = false; dismiss() }) { Text("Discard") } }, dismissButton = { TextButton(onClick = { discard = false }) { Text("Keep editing") } })
    if (deleting) AlertDialog(onDismissRequest = { deleting = false }, title = { Text("Delete task?") }, text = { Text("The task note will be deleted from this vault.") }, confirmButton = { TextButton(onClick = { model.delete(profileId, basis, dismiss) }, enabled = !blocked) { Text("Delete") } }, dismissButton = { TextButton(onClick = { deleting = false }) { Text("Cancel") } })
}

@Composable
private fun DraftField(label: String, value: String, busy: Boolean, change: (String) -> Unit) = OutlinedTextField(value, change, label = { Text(label) }, singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth())

@Composable
internal fun CaptureForm(profileId: String, model: FacetViewModel, dismiss: () -> Unit) {
    var input by rememberSaveable(profileId) { mutableStateOf("") }
    var discard by remember { mutableStateOf(false) }
    var another by rememberSaveable(profileId) { mutableStateOf(false) }
    var saving by rememberSaveable(profileId) { mutableStateOf(false) }
    val preview = model.capturePreview.takeIf { model.capturePreviewOwner == profileId && model.capturePreviewInput == input }
    val mutationId = rememberSaveable(profileId, input) { UUID.randomUUID().toString() }
    LaunchedEffect(profileId, input) { if (input.isNotBlank()) { kotlinx.coroutines.delay(200); model.preview(profileId, input) } }
    val submitted = mutationId in model.submittedActions || model.pendingActions.any { it.mutationId == mutationId }
    LaunchedEffect(model.busy) { if (!model.busy) saving = false }
    val blocked = saving || submitted
    fun close() { if (!submitted && input.isNotBlank()) discard = true else dismiss() }
    FacetSheet("Add task", { if (!saving) close() }, "Add", !blocked && input.isNotBlank() && preview != null && model.capturePreviewInput == input,
        save = { preview?.let { saving = true; model.create(profileId, it, mutationId) { saving = false; if (another) input = "" else dismiss() } } }, large = true) {
            if (submitted) Text("This action was submitted. Review Saved actions in Settings before creating another version of this task.", color = MaterialTheme.colorScheme.error)
            OutlinedTextField(input, { input = it }, label = { Text("What needs doing?") }, placeholder = { Text("Ship tomorrow !high p:Work @desktop #release") }, minLines = 3, enabled = !blocked, modifier = Modifier.fillMaxWidth())
            Text("Add dates, priority, projects, contexts and tags naturally.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            preview?.let {
                val properties = it.getValue("properties").jsonObject
                Surface(modifier = Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Preview", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                        properties["title"]?.jsonPrimitive?.contentOrNull?.let { title -> Text(title, style = MaterialTheme.typography.titleMedium) }
                        properties.filterKeys { key -> key != "title" }.forEach { (key, value) ->
                            val text = when (value) { JsonNull -> null; is JsonArray -> value.joinToString(" · ") { item -> (item as? JsonPrimitive)?.content ?: item.toString() }; is JsonPrimitive -> value.content; else -> value.toString() }
                            if (!text.isNullOrEmpty()) {
                                val display = when (key) {
                                    "status" -> workflowLabel(model.snapshot?.configuration, "statuses", text)
                                    "priority" -> workflowLabel(model.snapshot?.configuration, "priorities", text)
                                    "due", "scheduled" -> displayDate(text, java.time.LocalDate.now())
                                    else -> text
                                }
                                Text(key.replaceFirstChar { char -> char.uppercase() } + ": " + display, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Text("Add another", modifier = Modifier.weight(1f)); Switch(another, { another = it }, enabled = !blocked)
            }
    }
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
