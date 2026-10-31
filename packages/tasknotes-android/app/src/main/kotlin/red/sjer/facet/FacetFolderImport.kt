package red.sjer.facet

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** System picker requests read access only; source URI is transient and never retained. */
@Composable
internal fun FolderImport(model: FacetViewModel) {
    var picked by remember { mutableStateOf<Uri?>(null) }
    var name by remember { mutableStateOf("") }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri -> picked = uri }
    Button(onClick = { picker.launch(null) }, enabled = !model.busy) { Text("Import a folder copy") }
    model.importedCopySummary?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    picked?.let { uri ->
        AlertDialog(onDismissRequest = { picked = null }, title = { Text("Import an independent vault copy?") }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Facet copies this folder and its attachments into private app storage. It reads the source folder once. Future edits in either copy do not update the other. This copy is stored on this device and is not connected to Obsidian Sync.")
                OutlinedTextField(name, { name = it }, label = { Text("Vault name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }
        }, confirmButton = { TextButton(onClick = { model.importSnapshot(uri, name.trim()); picked = null; name = "" }, enabled = !model.busy && name.isNotBlank()) { Text("Import copy") } }, dismissButton = { TextButton(onClick = { picked = null }) { Text("Cancel") } })
    }
}
