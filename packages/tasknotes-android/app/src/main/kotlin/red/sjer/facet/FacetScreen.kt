package red.sjer.facet

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import red.sjer.facet.host.VaultTask

private val EditorIdentitySaver = listSaver<Pair<String, VaultTask>?, String>(
    save = { it?.let(::saveEditorIdentity) ?: emptyList() },
    restore = { if (it.isEmpty()) null else restoreEditorIdentity(it) })

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FacetScreen(model: FacetViewModel) {
    var destination by rememberSaveable { mutableStateOf("Today") }
    var taskTitle by rememberSaveable { mutableStateOf("Tasks") }
    var captureOwner by rememberSaveable { mutableStateOf<String?>(null) }
    var editor by rememberSaveable(stateSaver = EditorIdentitySaver) { mutableStateOf<Pair<String, VaultTask>?>(null) }
    var vaultMenu by remember { mutableStateOf(false) }
    var filters by rememberSaveable { mutableStateOf(false) }
    var searching by rememberSaveable { mutableStateOf(false) }
    var searchText by rememberSaveable(model.selected?.id) { mutableStateOf(model.query.text) }
    val profile = model.selected
    val reminder = model.pendingReminder
    val snackbar = remember { SnackbarHostState() }
    val view = LocalView.current
    val context = LocalContext.current
    val nativeFeedback = remember(context) { FacetNativeFeedback(context) }
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(nativeFeedback, lifecycle) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event -> if (event == androidx.lifecycle.Lifecycle.Event.ON_STOP) nativeFeedback.stop() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    DisposableEffect(nativeFeedback) { onDispose { nativeFeedback.close() } }
    LaunchedEffect(model.feedbackActive, profile?.id) { nativeFeedback.stop() }
    LaunchedEffect(nativeFeedback) { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { nativeFeedback.preload() } }
    val searchFocus = remember { FocusRequester() }
    LaunchedEffect(searching) { if (searching) searchFocus.requestFocus() }
    val mainRoutes = listOf("Inbox", "Today", "Upcoming", "Browse")
    val taskRoute = destination in listOf("Inbox", "Today", "Upcoming", "Tasks")
    val title = if (destination == "Tasks") taskTitle else destination
    LaunchedEffect(searchText, searching) {
        if (searching) { delay(250); if (searchText != model.query.text) model.changeQuery(model.query.copy(text = searchText)) }
    }
    LaunchedEffect(model.savedFeedback?.sequence, profile?.id, model.feedbackActive) {
        while (true) {
            val event = model.consumeSavedFeedback() ?: break
            nativeFeedback.applied(event, model.feedbackPreferences, view) { model.ownsFeedback(event) }
        }
        model.reportFeedbackDiagnostic(nativeFeedback.diagnostic)
    }
    LaunchedEffect(model.savedFeedback?.sequence, model.savedFeedback?.noticeReady, profile?.id, model.feedbackActive) {
        val event = model.consumeSavedNotice() ?: return@LaunchedEffect
        val answer = snackbar.showSnackbar(event.kind.message, if (event.undoReceiptId != null) "Undo" else null, withDismissAction = true, duration = SnackbarDuration.Indefinite)
        if (answer == SnackbarResult.ActionPerformed) model.undoFeedback(event)
    }
    LaunchedEffect(reminder, editor, captureOwner) {
        if (reminder != null && editor == null && captureOwner == null) {
            model.openReminder(reminder) { owner, task -> destination = "Tasks"; editor = owner to task }
        }
    }
    Scaffold(containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(title = {
                Column {
                    Text(if (profile == null) "Facet" else title, style = MaterialTheme.typography.headlineMedium)
                    if (profile != null) TextButton(onClick = { vaultMenu = true }, contentPadding = PaddingValues(0.dp)) {
                        Text(profile.name, maxLines = 1, style = MaterialTheme.typography.bodySmall)
                        Icon(Icons.Default.ArrowDropDown, contentDescription = null)
                    }
                    DropdownMenu(vaultMenu, { vaultMenu = false }) {
                        model.profiles.forEach { vault ->
                            DropdownMenuItem(text = { Text(vault.name) }, onClick = { model.select(vault); vaultMenu = false; destination = "Today"; searching = false })
                        }
                        DropdownMenuItem(text = { Text("Account and vaults") }, onClick = { destination = "Settings"; vaultMenu = false })
                    }
                }
            }, navigationIcon = {
                if (destination !in mainRoutes) IconButton(onClick = { destination = "Browse"; searching = false }) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back to Browse")
                }
            }, actions = {
                if (profile != null && taskRoute) {
                    IconButton(onClick = { searching = !searching }) { Icon(Icons.Default.Search, "Search tasks") }
                    IconButton(onClick = { filters = true }) { Icon(Icons.Default.Tune, "Filters, sort and grouping") }
                }
                IconButton(onClick = { destination = "Settings"; searching = false }) { Icon(Icons.Default.Settings, "Settings") }
            }, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background))
        },
        bottomBar = {
            if (profile != null) NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                mainRoutes.forEach { route ->
                    val icon = when (route) { "Inbox" -> Icons.Default.Inbox; "Today" -> Icons.Default.Today; "Upcoming" -> Icons.Default.DateRange; else -> Icons.Default.GridView }
                    NavigationBarItem(selected = destination == route || (route == "Browse" && destination !in mainRoutes),
                        onClick = {
                            destination = route; searching = false
                            if (route != "Browse") model.changeQuery(FacetQuery(scope = route.lowercase(), group = if (route == "Upcoming") "effectiveDate" else null))
                        }, icon = { Icon(icon, contentDescription = null) }, label = { Text(route) })
                }
            }
        },
        floatingActionButton = {
            if (profile != null && model.snapshot?.configuration != null && taskRoute) FloatingActionButton(onClick = { captureOwner = profile.id }) {
                Icon(Icons.Default.Add, "Add task")
            }
        }, snackbarHost = { SnackbarHost(snackbar) }
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            if (model.busy) LinearProgressIndicator(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.primary)
            if (profile == null) {
                if (destination == "Settings") Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SignInForm(model); FolderImport(model)
                } else FacetWelcome(model) { destination = "Settings" }
            } else {
                FacetSyncSummary(model)
                FacetCompletionConfirmation(model)
                if (model.savedNotice != null || model.savedMaintenance != null) Surface(color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        model.savedNotice?.messages?.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
                        model.savedMaintenance?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                    }
                }
                if (searching && taskRoute) OutlinedTextField(searchText, { searchText = it }, label = { Text("Search tasks") },
                    singleLine = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).focusRequester(searchFocus),
                    trailingIcon = { IconButton(onClick = { searchText = ""; model.changeQuery(model.query.copy(text = "")); searching = false }) { Icon(Icons.Default.Close, "Clear search") } })
                if (model.snapshot?.configuration == null && destination != "Settings") {
                    Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Text("Getting your vault ready", style = MaterialTheme.typography.titleLarge)
                        Text("Your existing TaskNotes settings will be used when they are available.")
                        model.snapshot?.problems?.forEach { Text(it.message) }
                        if (model.needsStandardConsent) Button(onClick = model::approveStandard, enabled = !model.busy) { Text("Use TaskNotes defaults") }
                    }
                } else when (destination) {
                    "Inbox", "Today", "Upcoming", "Tasks" -> FacetTaskList(model, title, { editor = profile.id to it }, { captureOwner = profile.id })
                    "Browse" -> FacetBrowse(model, { query, heading -> model.changeQuery(query); taskTitle = heading; destination = "Tasks" }, { destination = it })
                    "Board" -> FacetBoard(model) { editor = profile.id to it }
                    "Views" -> FacetViews(model) { heading -> taskTitle = heading; destination = "Tasks" }
                    "Conflicts" -> ConflictScreen(model)
                    "Settings" -> FacetSettings(model)
                }
            }
        }
    }
    if (filters && profile != null) FacetFiltersSheet(model) { filters = false }
    captureOwner?.let { owner -> CaptureForm(owner, model) { captureOwner = null } }
    editor?.let { (owner, task) -> TaskEditor(owner, task, model) { editor = null } }
    if (reminder != null && (editor != null || captureOwner != null)) Confirmation(
        "Open this reminder?", "Continuing discards the unsaved draft and opens the task in the reminder's vault.",
        "Discard draft and open", { model.dismissReminder(reminder) }
    ) { editor = null; captureOwner = null; model.openReminder(reminder) { owner, task -> destination = "Tasks"; editor = owner to task } }
    model.error?.takeIf { captureOwner == null && editor == null }?.let { message ->
        AlertDialog(onDismissRequest = model::dismissError, icon = { Icon(Icons.Default.ErrorOutline, null) },
            title = { Text("This action needs attention") }, text = { Text(message) },
            confirmButton = { TextButton(onClick = model::dismissError) { Text("OK") } })
    }
}

@Composable
private fun FacetWelcome(model: FacetViewModel, connect: () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Spacer(Modifier.height(24.dp))
        Icon(Icons.Default.FolderOpen, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(56.dp))
        Text("Your tasks, in your vault", style = MaterialTheme.typography.headlineLarge)
        Text("Keep your notes in Markdown. Work from a private vault copy, with your tasks available offline.", style = MaterialTheme.typography.bodyLarge)
        FolderImport(model)
        OutlinedButton(onClick = connect) { Text("Connect Obsidian Sync") }
    }
}

@Composable
internal fun FacetSyncSummary(model: FacetViewModel) {
    val profile = model.selected ?: return
    val text = when {
        model.syncState.isNotBlank() -> model.syncState
        profile.kind == "local_folder" -> "On this device"
        else -> "Private vault copy"
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(if (profile.kind == "local_folder") Icons.Default.Folder else Icons.Default.CloudQueue, null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        if ((model.snapshot?.conflictCount ?: 0uL) > 0uL) Text(model.snapshot!!.conflictCount.toString() + " conflicts", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
internal fun Confirmation(title: String, message: String, action: String, dismiss: () -> Unit, confirm: () -> Unit) {
    AlertDialog(onDismissRequest = dismiss, title = { Text(title) }, text = { Text(message) },
        confirmButton = { TextButton(onClick = confirm) { Text(action) } }, dismissButton = { TextButton(onClick = dismiss) { Text("Cancel") } })
}
