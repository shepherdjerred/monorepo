package red.sjer.facet

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.util.UUID
import kotlinx.serialization.json.*

@Composable
internal fun ConflictScreen(model: FacetViewModel) {
    val profile = requireNotNull(model.selected)
    var reviewing by remember(profile.id) { mutableStateOf<JsonObject?>(null) }
    LaunchedEffect(profile.id) { model.readConflicts() }
    LazyColumn(Modifier.padding(12.dp), contentPadding = PaddingValues(bottom = 88.dp)) {
        item { Text("Preserved versions", style = MaterialTheme.typography.titleLarge); Text("Review each version before choosing a resolution.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        items(model.conflicts, key = { it.getValue("id").jsonPrimitive.content }) { conflict ->
            ListItem(headlineContent = { Text(conflict.getValue("path").jsonPrimitive.content) }, supportingContent = { Text("Review local, remote and base versions") },
                leadingContent = { Icon(Icons.Default.Difference, null, tint = MaterialTheme.colorScheme.primary) },
                trailingContent = { Icon(Icons.Default.ChevronRight, null) }, modifier = Modifier.clickable { reviewing = conflict })
        }
        if (model.conflictCursor != null) item { TextButton(onClick = { model.readConflicts(more = true) }, enabled = !model.busy) { Text("Load more conflicts") } }
        if (model.conflicts.isEmpty() && !model.busy) item { Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
            ListItem(headlineContent = { Text("No conflicts to review") }, supportingContent = { Text("No preserved conflicts were returned for the current page.") },
                leadingContent = { Icon(Icons.Default.CheckCircleOutline, null) }, colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainer))
        } }
        item { Text("Resolution history", style = MaterialTheme.typography.titleLarge) }
        items(model.resolutionIds, key = { "history:$it" }) { id ->
            TextButton(onClick = { model.readResolution(id) }, enabled = !model.busy) { Text("Inspect resolution $id") }
            if (model.undoHead == id) TextButton(onClick = { model.undoResolution(id) }, enabled = !model.busy) { Text("Undo latest resolution") }
        }
        model.resolutionHistory?.let { history -> item {
            val conflict = history.getValue("conflict").jsonObject
            Text("Preserved: ${conflict.getValue("path").jsonPrimitive.content}")
            listOf("base", "local", "remote").forEach { version -> TextButton(onClick = { model.previewConflict(profile.id, conflict, version) }, enabled = !model.busy) { Text("Inspect preserved $version") } }
            model.conflictPreview?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        } }
    }
    reviewing?.let { conflict -> ConflictReview(profile.id, conflict, model) { reviewing = null } }
}

@Composable
private fun ConflictReview(profileId: String, conflict: JsonObject, model: FacetViewModel, dismiss: () -> Unit) {
    var choice by rememberSaveable(profileId, conflict.getValue("id").toString()) { mutableStateOf("keep_local") }
    var newPath by rememberSaveable { mutableStateOf("") }
    var replacement by rememberSaveable { mutableStateOf("") }
    var deleteFile by rememberSaveable { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    val mutationId = rememberSaveable(profileId, conflict.getValue("id").toString(), choice, newPath, replacement, deleteFile) { UUID.randomUUID().toString() }
    val markdown = conflict.getValue("path").jsonPrimitive.content.endsWith(".md", ignoreCase = true)
    FacetSheet("Review conflict", { if (!model.busy) dismiss() }, "Resolve", !model.busy && (choice != "keep_both" || newPath.isNotBlank()), save = { confirm = true }) {
            Text(conflict.getValue("path").jsonPrimitive.content, style = MaterialTheme.typography.titleMedium)
            listOf("base", "local", "remote").forEach { version ->
                val metadata = conflict.getValue(version)
                Text("$version: ${if (metadata == JsonNull) "deleted" else metadata.jsonObject.getValue("size").jsonPrimitive.content + " bytes"}")
                TextButton(onClick = { model.previewConflict(profileId, conflict, version) }, enabled = !model.busy) { Text("Inspect $version") }
            }
            model.conflictPreview?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            val choices = listOf(WorkflowOption("keep_local", "Keep local"), WorkflowOption("keep_remote", "Keep remote"), WorkflowOption("keep_both", "Keep both")) + if (markdown) listOf(WorkflowOption("replace_payload", "Save edited Markdown")) else emptyList()
            ChoiceField("Resolution", choice, choices, !model.busy) { choice = it }
            if (choice == "keep_both") OutlinedTextField(newPath, { newPath = it }, label = { Text("New vault-relative path") }, enabled = !model.busy)
            if (choice == "replace_payload") {
                OutlinedTextField(replacement, { replacement = it }, label = { Text("Complete replacement Markdown") }, minLines = 5, enabled = !model.busy && !deleteFile)
                Row { Checkbox(deleteFile, { deleteFile = it }); Text("Resolve as deleted file", Modifier.padding(top = 12.dp)) }
            }
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("Apply this resolution?") }, text = { Text("Rust will verify all four version revisions before changing the vault. Preserved versions remain recoverable through resolution history.") }, confirmButton = { TextButton(onClick = { model.resolveConflict(profileId, conflict, choice, newPath, if (deleteFile) null else replacement, mutationId) { confirm = false; dismiss() } }, enabled = !model.busy) { Text("Apply resolution") } }, dismissButton = { TextButton(onClick = { confirm = false }) { Text("Review again") } })
}
