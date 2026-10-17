package red.sjer.facet

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

@Composable
internal fun FacetSettings(model: FacetViewModel) {
    var signOut by remember { mutableStateOf(false) }
    var remove by remember { mutableStateOf<red.sjer.facet.host.VaultProfile?>(null) }
    var retire by remember { mutableStateOf<red.sjer.facet.host.PendingFacetMutation?>(null) }
    var section by rememberSaveable { mutableStateOf("Overview") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (section != "Overview") TextButton(onClick = { section = "Overview" }) { Text("All settings") }
        when (section) {
            "Account and vaults" -> {
                SignInForm(model); HorizontalDivider(Modifier.padding(vertical = 8.dp)); FolderImport(model)
                if (model.profiles.any { it.kind == "obsidian_sync" }) TextButton(onClick = { signOut = true }, enabled = !model.busy) { Text("Sign out and retain vault copies") }
                model.selected?.let { profile -> TextButton(onClick = { remove = profile }, enabled = !model.busy) { Text("Remove " + profile.name + " from Facet") } }
            }
            "Reminders" -> ReminderSettings(model)
            "Saved actions" -> {
                Text("Saved actions", style = MaterialTheme.typography.titleLarge)
                Text("Interrupted work stays with its original vault and action. Resume after reviewing an error; retire only when the engine confirms it is safe.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (model.pendingActions.isEmpty()) SettingsRow("Everything is settled", "No saved actions need resuming.", Icons.Default.CheckCircleOutline) {}
                model.pendingActions.forEach { action ->
                    val owner = model.profiles.firstOrNull { it.id == action.profileId }?.name ?: action.profileId
                    Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = MaterialTheme.shapes.medium) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(if (action.canResume) action.mutation.getValue("command").jsonObject.getValue("kind").jsonPrimitive.content.replace('_', ' ') else "Removed feature action", style = MaterialTheme.typography.titleMedium)
                            Text(owner, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Row {
                                TextButton(onClick = { model.resume(action) }, enabled = !model.busy && action.canResume) { Text("Resume") }
                                TextButton(onClick = { retire = action }, enabled = !model.busy) { Text("Check and retire") }
                            }
                        }
                    }
                }
            }
            "Vault health" -> {
                Text("Vault health", style = MaterialTheme.typography.titleLarge)
                model.snapshot?.let { snapshot ->
                    Text(snapshot.pendingCount.toString() + " pending uploads · " + snapshot.conflictCount + " conflicts")
                    if (snapshot.problems.isEmpty()) Text("No vault problems were reported.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    snapshot.problems.forEach { problem -> ListItem(headlineContent = { Text(problem.path) }, supportingContent = { Text(problem.message) }, leadingContent = { Icon(Icons.Default.Info, null, tint = MaterialTheme.colorScheme.error) }) }
                    listOf("statuses", "priorities").forEach { field -> snapshot.configuration?.get(field)?.jsonArray?.forEach { item ->
                        val choice = item.jsonObject
                        choice["color"]?.jsonPrimitive?.contentOrNull?.let(::projectFacetColor)?.diagnostic?.let {
                            Text(choice.getValue("label").jsonPrimitive.content + ": " + it, color = MaterialTheme.colorScheme.error)
                        }
                    } }
                }
                OutlinedButton(onClick = model::refresh, enabled = !model.busy) { Text("Refresh vault") }
            }
            else -> {
                Text(model.selected?.name ?: "Your vaults", style = MaterialTheme.typography.titleLarge)
                Text("Preferences belong to this device. Task workflow values come from your vault's TaskNotes settings.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                SettingsRow("Account and vaults", "Connect Sync or import a local vault copy", Icons.Default.Folder) { section = "Account and vaults" }
                SettingsRow("Reminders", if (model.remindersEnabled) "Enabled on this device" else "Disabled on this device", Icons.Default.NotificationsNone) { section = "Reminders" }
                SettingsRow("Saved actions", if (model.pendingActions.isEmpty()) "All actions settled" else model.pendingActions.size.toString() + " retained actions", Icons.Default.Restore) { section = "Saved actions" }
                SettingsRow("Vault health", "Sync, preserved conflicts and configuration", Icons.Default.HealthAndSafety) { section = "Vault health" }
                Spacer(Modifier.height(8.dp)); Text("Appearance", style = MaterialTheme.typography.titleMedium)
                Text("Follows your Android light or dark theme, text size and reduced motion preferences. Controls keep native touch targets.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                model.feedbackPreferenceError?.let { message ->
                    Text(message, color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = { model.setFeedbackPreferences(FacetFeedbackPreferences()) }, enabled = !model.busy) { Text("Reset task feedback") }
                }
                FeedbackToggle("Haptic feedback", model.feedbackPreferences.haptics, !model.busy && model.feedbackPreferenceError == null) { model.setFeedbackPreferences(model.feedbackPreferences.copy(haptics = it)) }
                FeedbackToggle("Task sounds", model.feedbackPreferences.sound, !model.busy && model.feedbackPreferenceError == null) { model.setFeedbackPreferences(model.feedbackPreferences.copy(sound = it)) }
                Text("Subtle feedback for adding, completing, deleting and undoing tasks. Respects device sound and haptic settings.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                model.feedbackDiagnostic?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                Text("Facet · Markdown tasks in your vault", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    if (signOut) Confirmation("Sign out?", "Synchronization stops before credentials are removed. Vault copies and pending actions remain on this device.", "Sign out", { signOut = false }) { model.signOut(); signOut = false }
    remove?.let { profile -> Confirmation("Remove ${profile.name}?", "Facet stops synchronization and removes this vault's settled app state and access key. Files remain intact. Pending uploads, conflicts or saved actions must be resolved first.", "Remove vault", { remove = null }) { model.removeProfile(profile); remove = null } }
    retire?.let { action -> Confirmation("Retire saved action?", if (action.canResume) "The native engine must confirm this action is absent or parked. Pending and applied actions stay retained. No preserved conflict versions are removed." else "Facet checks the original saved outcome before clearing this private draft. Pending work remains retained; applied changes and preserved vault versions remain intact.", "Check and retire", { retire = null }) { model.retireRejected(action); retire = null } }
}

@Composable
private fun FeedbackToggle(label: String, value: Boolean, enabled: Boolean, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(value, enabled = enabled, role = Role.Switch, onValueChange = change),
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Switch(value, onCheckedChange = null, enabled = enabled)
    }
}

@Composable
private fun SettingsRow(title: String, detail: String, icon: androidx.compose.ui.graphics.vector.ImageVector, action: () -> Unit) {
    Surface(shape = MaterialTheme.shapes.medium) {
        ListItem(headlineContent = { Text(title) }, supportingContent = { Text(detail) }, leadingContent = { Icon(icon, null, tint = MaterialTheme.colorScheme.primary) },
            trailingContent = { Icon(Icons.Default.ChevronRight, null) }, modifier = Modifier.fillMaxWidth().clickable(onClick = action))
    }
}
