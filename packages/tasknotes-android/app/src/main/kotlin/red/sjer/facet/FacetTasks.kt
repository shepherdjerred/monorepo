package red.sjer.facet

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import kotlinx.coroutines.launch
import red.sjer.facet.host.VaultTask
import kotlinx.serialization.json.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FacetTaskList(model: FacetViewModel, title: String, edit: (VaultTask) -> Unit, create: () -> Unit) {
    val profile = requireNotNull(model.selected)
    val snapshot = model.snapshot
    var selected by remember(profile.id, model.query) { mutableStateOf<Set<String>>(emptySet()) }
    var selecting by remember(profile.id, model.query) { mutableStateOf(false) }
    var selectionGeneration by remember(profile.id, model.query) { mutableLongStateOf(0L) }
    var menu by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<List<VaultTask>?>(null) }
    var scheduling by remember { mutableStateOf<List<VaultTask>?>(null) }
    var prioritizing by remember { mutableStateOf<List<VaultTask>?>(null) }
    val today = remember(snapshot?.version) { LocalDate.now() }
    val sections = remember(snapshot, model.query.group) { snapshot?.let { taskSections(it, model.query.group) }.orEmpty() }
    val motion = LocalFacetMotion.current
    val selection = snapshot?.tasks.orEmpty().filter { taskRowKey(it) in selected }
    val selectionQuery = model.query
    fun selectRows(keys: Set<String>, active: Boolean = true) {
        selectionGeneration++; selected = keys; selecting = active
    }
    fun applySelection(tasks: List<VaultTask>, action: String, value: String = "") {
        val ownedKeys = selected
        val ownerGeneration = selectionGeneration
        model.bulk(profile.id, tasks, action, value) {
            if (model.selected?.id == profile.id && model.query == selectionQuery && selected == ownedKeys && selectionGeneration == ownerGeneration) {
                selectRows(emptySet(), false)
            }
        }
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            val count = snapshot?.totalCount ?: 0uL
            Text(if (selecting) selected.size.toString() + " selected" else count.toString() + if (count == 1uL) " task" else " tasks",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
            if (selecting) TextButton(onClick = { selectRows(emptySet(), false) }) { Text("Done") }
            else Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreHoriz, "List actions") }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem(text = { Text("Select tasks") }, onClick = { selectRows(selected); menu = false })
                    DropdownMenuItem(text = { Text("Refresh") }, onClick = { model.refresh(); menu = false })
                    DropdownMenuItem(text = { Text("Undo last saved change") }, enabled = model.undoDepth > 0, onClick = { model.undo(); menu = false })
                }
            }
        }
        if (selecting && selected.isNotEmpty()) Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            IconButton(onClick = { applySelection(selection, "complete") }, enabled = !model.busy) { Icon(Icons.Default.Check, "Complete selected tasks") }
            IconButton(onClick = { scheduling = selection }) { Icon(Icons.Default.Event, "Schedule selected tasks") }
            IconButton(onClick = { prioritizing = selection }) { Icon(Icons.Default.Flag, "Set selected priority") }
            IconButton(onClick = { deleting = selection }) { Icon(Icons.Default.DeleteOutline, "Delete selected tasks") }
        }
        if (snapshot == null) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        else if (snapshot.tasks.isEmpty()) FacetEmptyTasks(model, title, create)
        else LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 88.dp)) {
            sections.forEachIndexed { index, section ->
                section.key?.let { key -> item("group:$index:$key") {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        val label = when (model.query.group) {
                            "effectiveDate" -> if (key.isEmpty()) "Undated" else displayDate(key, today)
                            "status" -> workflowLabel(snapshot.configuration, "statuses", key)
                            "priority" -> workflowLabel(snapshot.configuration, "priorities", key)
                            else -> key.ifEmpty { "Unassigned" }
                        }
                        Text(label, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        Text(section.tasks.size.toString() + " loaded", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } }
                items(section.tasks, key = { task -> index.toString() + ":" + taskRowKey(task) }) { task ->
                    val pending = (profile.id + ":" + taskRowKey(task)) in model.admittedCompletions
                    var actions by remember { mutableStateOf(false) }
                    val scope = rememberCoroutineScope()
                    val swipe = rememberSwipeToDismissBoxState()
                    LaunchedEffect(swipe.currentValue) {
                        when (swipe.currentValue) {
                            SwipeToDismissBoxValue.StartToEnd -> { model.toggle(profile.id, task); scope.launch { if (motion) swipe.reset() else swipe.snapTo(SwipeToDismissBoxValue.Settled) } }
                            SwipeToDismissBoxValue.EndToStart -> { deleting = listOf(task); scope.launch { if (motion) swipe.reset() else swipe.snapTo(SwipeToDismissBoxValue.Settled) } }
                            SwipeToDismissBoxValue.Settled -> Unit
                        }
                    }
                    SwipeToDismissBox(state = swipe, modifier = Modifier.animateItem(fadeInSpec = if (motion) tween(200) else null, placementSpec = if (motion) spring() else null, fadeOutSpec = if (motion) tween(200) else null),
                        enableDismissFromStartToEnd = !selecting && !pending, enableDismissFromEndToStart = !selecting && !pending,
                        backgroundContent = {
                            Box(Modifier.fillMaxSize().padding(horizontal = 24.dp),
                                contentAlignment = if (swipe.dismissDirection == SwipeToDismissBoxValue.StartToEnd) Alignment.CenterStart else Alignment.CenterEnd) {
                                Icon(if (swipe.dismissDirection == SwipeToDismissBoxValue.StartToEnd) Icons.Default.Check else Icons.Default.DeleteOutline, null,
                                    tint = if (swipe.dismissDirection == SwipeToDismissBoxValue.StartToEnd) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
                            }
                        }) {
                        Surface(color = if (taskRowKey(task) in selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface) {
                            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                if (selecting) Checkbox(taskRowKey(task) in selected, { checked -> selectRows(if (checked) selected + taskRowKey(task) else selected - taskRowKey(task)) })
                                else FacetTaskCheckbox(task, snapshot.configuration, !pending) { model.toggle(profile.id, task) }
                                Column(Modifier.weight(1f).combinedClickable(
                                    onClick = { if (selecting) selectRows(if (taskRowKey(task) in selected) selected - taskRowKey(task) else selected + taskRowKey(task)) else edit(task) },
                                    onLongClick = { selectRows(selected + taskRowKey(task)) },
                                    role = Role.Button, onClickLabel = if (selecting) "Select task" else "Open task",
                                    onLongClickLabel = "Select tasks"
                                ).padding(vertical = 4.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Text(task.title, style = MaterialTheme.typography.bodyLarge,
                                            color = if (task.completed) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                                            textDecoration = if (task.completed) TextDecoration.LineThrough else null,
                                            modifier = Modifier.weight(1f))
                                        if (task.isRecurring) Icon(Icons.Default.Repeat, "Repeating task", Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                        if (task.isPending || pending) Icon(if (pending) Icons.Default.MoreHoriz else Icons.Default.CloudUpload, if (pending) "Locally queued action" else "Waiting to sync", Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    val date = task.occurrenceDate ?: task.effectiveDate
                                    val metadata = taskValues(task, "projects") + taskValues(task, "contexts").map { "@$it" } + taskValues(task, "tags").map { "#$it" }
                                    if (date != null || metadata.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                        date?.let {
                                            Icon(Icons.Default.Event, null, Modifier.size(13.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                            Text(displayDate(it, today), style = MaterialTheme.typography.bodySmall,
                                                color = if (!task.completed && civilDate(it) < today) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                        if (metadata.isNotEmpty()) Text(metadata.take(2).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary, maxLines = 2)
                                    }
                                    if (task.isBlocked) Text("Blocked", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    model.completionFailures[profile.id + ":" + taskRowKey(task)]?.let {
                                        Text("Action needs attention: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                                    }
                                    workflowColor(snapshot.configuration, "priorities", task.priority)?.let(::projectFacetColor)?.diagnostic?.let {
                                        Text(workflowLabel(snapshot.configuration, "priorities", task.priority) + ": " + it,
                                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                                    }
                                }
                                if (!selecting) Box {
                                    IconButton(onClick = { actions = true }) { Icon(Icons.Default.MoreHoriz, "Actions for " + task.title, tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                                    DropdownMenu(actions, { actions = false }) {
                                        DropdownMenuItem(text = { Text("Edit task") }, onClick = { actions = false; edit(task) })
                                        DropdownMenuItem(text = { Text("Schedule") }, onClick = { actions = false; scheduling = listOf(task) })
                                        DropdownMenuItem(text = { Text("Priority") }, onClick = { actions = false; prioritizing = listOf(task) })
                                        DropdownMenuItem(text = { Text("Delete") }, onClick = { actions = false; deleting = listOf(task) })
                                    }
                                }
                            }
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
            if (snapshot.tasks.size.toULong() < snapshot.totalCount) item {
                TextButton(onClick = model::loadMore, enabled = !model.busy, modifier = Modifier.fillMaxWidth()) { Text("Load more tasks") }
            }
        }
    }
    deleting?.let { tasks -> Confirmation("Delete " + tasks.size + if (tasks.size == 1) " task?" else " tasks?",
        "The task notes will be deleted from this vault.", "Delete", { deleting = null }) {
        applySelection(tasks, "delete"); deleting = null
    } }
    scheduling?.let { tasks -> FacetDatePicker("Schedule tasks", "", { scheduling = null }) { date ->
        applySelection(tasks, "schedule", date); scheduling = null
    } }
    prioritizing?.let { tasks -> FacetChoiceSheet("Priority", workflow(snapshot?.configuration, "priorities"), { prioritizing = null }) { value ->
        applySelection(tasks, "priority", value); prioritizing = null
    } }
}

@Composable
internal fun FacetTaskCheckbox(task: VaultTask, configuration: kotlinx.serialization.json.JsonObject?, enabled: Boolean, toggle: () -> Unit) {
    val configured = workflowColor(configuration, "priorities", task.priority)
    val projection = remember(configured) { configured?.let(::projectFacetColor) }
    val tint = projection?.argb?.let { Color(it.toInt()) } ?: MaterialTheme.colorScheme.onSurfaceVariant
    val tokens = LocalFacetTokens.current.document.getValue("motion").jsonObject
    val springTokens = tokens.getValue("checkboxSpring").jsonObject
    val fill = tokens.getValue("milliseconds").jsonObject.getValue("checkboxFill").jsonPrimitive.int
    val motion = LocalFacetMotion.current
    val scale = remember(taskRowKey(task)) { Animatable(1f) }
    var previous by remember(taskRowKey(task)) { mutableStateOf(task.completed) }
    LaunchedEffect(task.completed, motion) {
        if (previous != task.completed && motion) {
            scale.animateTo(springTokens.getValue("peakScale").jsonPrimitive.float, tween(fill))
            val stiffness = springTokens.getValue("stiffness").jsonPrimitive.float
            val damping = springTokens.getValue("damping").jsonPrimitive.float / (2f * kotlin.math.sqrt(stiffness))
            scale.animateTo(1f, spring(dampingRatio = damping, stiffness = stiffness))
        } else scale.snapTo(1f)
        previous = task.completed
    }
    val color by animateColorAsState(if (task.completed) tint else tint.copy(alpha = 0.8f), animationSpec = if (motion) tween(fill) else snap(), label = "Completion color")
    IconToggleButton(checked = task.completed, onCheckedChange = { toggle() }, enabled = enabled,
        modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp).semantics { contentDescription = (if (task.completed) "Uncomplete " else "Complete ") + task.title + (task.occurrenceDate?.let { ", occurrence $it" } ?: "") }) {
        val glyph = Modifier.size(LocalFacetTokens.current.number("mobile", "checkboxSize").dp).graphicsLayer { scaleX = scale.value; scaleY = scale.value }
        if (task.completed) Icon(Icons.Default.CheckCircle, null, glyph, tint = color)
        else Canvas(glyph) { drawCircle(color, style = Stroke(2.dp.toPx())) }
    }
}

@Composable
private fun FacetEmptyTasks(model: FacetViewModel, title: String, create: () -> Unit) {
    val filtered = model.query.text.isNotBlank() || listOf(model.query.statuses, model.query.priorities, model.query.projects, model.query.contexts, model.query.tags).any { it.isNotEmpty() }
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Icon(if (filtered) Icons.Default.SearchOff else Icons.Default.CheckCircleOutline, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(16.dp))
        Text(if (filtered) "No matching tasks" else if (title == "Today") "Nothing planned for today" else title + " is empty", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        Text(if (filtered) "Try a different search or clear your filters." else "Your tasks will appear here when they belong to this view.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(20.dp))
        if (filtered) OutlinedButton(onClick = { model.changeQuery(FacetQuery(scope = model.query.scope)); }) { Text("Clear filters and search") }
        else Button(onClick = create) { Text("Add task") }
    }
}
