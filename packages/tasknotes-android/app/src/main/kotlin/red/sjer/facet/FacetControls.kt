package red.sjer.facet

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.focus.FocusRequester
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FacetSheet(title: String, dismiss: () -> Unit, action: String? = null, enabled: Boolean = true,
    save: () -> Unit = {}, large: Boolean = false, initialFocus: FocusRequester? = null, focusKey: Any? = null,
    content: @Composable ColumnScope.() -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = dismiss, sheetState = sheetState,
        modifier = if (large) Modifier.fillMaxHeight(0.9f) else Modifier,
        containerColor = MaterialTheme.colorScheme.surface, sheetMaxWidth = 720.dp) {
        val windowFocused = LocalWindowInfo.current.isWindowFocused
        val keyboard = LocalSoftwareKeyboardController.current
        var deliveredFocusKey by remember { mutableStateOf<Any?>(null) }
        LaunchedEffect(initialFocus, focusKey, windowFocused, sheetState.currentValue, sheetState.isAnimationRunning) {
            if (initialFocus != null && focusKey != deliveredFocusKey && windowFocused &&
                sheetState.currentValue == SheetValue.Expanded && !sheetState.isAnimationRunning) {
                initialFocus.requestFocus()
                keyboard?.show()
                deliveredFocusKey = focusKey
            }
        }
        Column(Modifier.fillMaxWidth().imePadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = dismiss) { Text("Cancel") }
                Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f).padding(horizontal = 8.dp))
                if (action != null) TextButton(onClick = save, enabled = enabled) { Text(action) }
            }
            HorizontalDivider()
            Column(Modifier.fillMaxWidth().weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
        }
    }
}

@Composable
internal fun FacetChoiceSheet(title: String, choices: List<WorkflowOption>, dismiss: () -> Unit, change: (String) -> Unit) {
    FacetSheet(title, dismiss) {
        choices.forEach { option ->
            ListItem(headlineContent = { Text(option.label) }, trailingContent = { Icon(Icons.Default.ChevronRight, null) },
                modifier = Modifier.fillMaxWidth().clickable { change(option.value) })
        }
        if (choices.isEmpty()) Text("No choices are configured for this vault.")
    }
}

@Composable
internal fun FacetFieldRow(label: String, value: String, icon: androidx.compose.ui.graphics.vector.ImageVector,
    enabled: Boolean = true, action: () -> Unit) {
    Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
        BoxWithConstraints(Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = action).heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 12.dp)) {
            val stack = maxWidth < 280.dp || LocalDensity.current.fontScale > 1.3f
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(icon, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                if (stack) Column(Modifier.weight(1f)) {
                    Text(label, style = MaterialTheme.typography.bodyMedium)
                    Text(value.ifEmpty { "None" }, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(0.45f))
                    Text(value.ifEmpty { "None" }, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(0.55f))
                }
                Icon(Icons.Default.ChevronRight, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
internal fun FacetDateField(label: String, value: String, enabled: Boolean = true, change: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val date = remember(value) { if (value.isBlank()) null else runCatching { civilDate(value) }.getOrNull() }
    FacetFieldRow(label, date?.let { displayDate(it.toString(), LocalDate.now()) } ?: value, Icons.Default.Event, enabled) { open = true }
    if (value.isNotBlank() && date == null) Text("The existing $label value cannot be shown as a calendar date. It is retained until you choose a replacement.",
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    if (open) FacetDatePicker(label, value, { open = false }) { change(it); open = false }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FacetDatePicker(title: String, value: String, dismiss: () -> Unit, change: (String) -> Unit) {
    val date = remember(value) { runCatching { civilDate(value) }.getOrNull() }
    val state = rememberDatePickerState(initialSelectedDateMillis = date?.atStartOfDay(ZoneOffset.UTC)?.toInstant()?.toEpochMilli())
    DatePickerDialog(onDismissRequest = dismiss,
        confirmButton = { TextButton(onClick = {
            state.selectedDateMillis?.let { change(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()) }
        }, enabled = state.selectedDateMillis != null) { Text("Set date") } },
        dismissButton = { TextButton(onClick = dismiss) { Text("Cancel") } }) {
        Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp))
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            TextButton(onClick = { change(LocalDate.now().toString()) }) { Text("Today") }
            TextButton(onClick = { change(LocalDate.now().plusDays(1).toString()) }) { Text("Tomorrow") }
            TextButton(onClick = { change("") }) { Text("Clear") }
        }
        DatePicker(state, showModeToggle = true)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun FacetTokenField(label: String, values: List<String>, suggestions: List<String>, enabled: Boolean, change: (List<String>) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            values.forEach { value -> InputChip(selected = true, onClick = { open = true }, enabled = enabled,
                label = { Text(value) }, modifier = Modifier.heightIn(min = 48.dp)) }
            AssistChip(onClick = { open = true }, enabled = enabled, label = { Text("Add " + label.lowercase()) },
                leadingIcon = { Icon(Icons.Default.Add, null, Modifier.size(16.dp)) }, modifier = Modifier.heightIn(min = 48.dp))
        }
    }
    if (open) {
        var chosen by remember(values) { mutableStateOf(values) }
        var input by rememberSaveable { mutableStateOf("") }
        FacetSheet(label, { open = false }, "Done", save = { change(chosen); open = false }) {
            Text("Select existing values or add your own.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                (chosen + suggestions).distinct().forEach { token ->
                    FilterChip(selected = token in chosen, onClick = {
                        chosen = if (token in chosen) chosen - token else chosen + token
                    }, label = { Text(token) }, trailingIcon = if (token in chosen) ({ Icon(Icons.Default.Check, null, Modifier.size(16.dp)) }) else null)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(input, { input = it }, label = { Text("Add a value") }, singleLine = true, modifier = Modifier.weight(1f))
                IconButton(onClick = { chosen = (chosen + input.trim()).distinct(); input = "" }, enabled = input.isNotBlank()) { Icon(Icons.Default.Add, "Add value") }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun FacetRecurrenceField(value: String, enabled: Boolean, change: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val label = when (value) { "" -> "Does not repeat"; "FREQ=DAILY" -> "Daily"; "FREQ=WEEKLY" -> "Weekly"; "FREQ=MONTHLY" -> "Monthly"; "FREQ=YEARLY" -> "Yearly"; else -> "Custom repeat rule" }
    FacetFieldRow("Repeat", label, Icons.Default.Repeat, enabled) { open = true }
    if (open) {
        var frequency by rememberSaveable { mutableStateOf("DAILY") }
        var interval by rememberSaveable { mutableStateOf("1") }
        var weekdays by remember { mutableStateOf<List<String>>(emptyList()) }
        var end by rememberSaveable { mutableStateOf("") }
        var advanced by rememberSaveable { mutableStateOf(false) }
        var rule by rememberSaveable(value) { mutableStateOf(value) }
        var changed by remember { mutableStateOf(false) }
        val positive = interval.toIntOrNull()?.let { it > 0 } == true
        FacetSheet("Repeat task", { open = false }, "Done", enabled = advanced || !changed || positive, save = {
            if (advanced) change(rule)
            else if (changed) change(buildList {
                add("FREQ=$frequency"); if (interval != "1") add("INTERVAL=$interval")
                if (frequency == "WEEKLY" && weekdays.isNotEmpty()) add("BYDAY=" + weekdays.joinToString(","))
                if (end.isNotEmpty()) add("UNTIL=" + end.replace("-", ""))
            }.joinToString(";"))
            open = false
        }) {
            if (value.isNotEmpty()) Text("Current rule: $value", style = MaterialTheme.typography.bodyMedium)
            Text("The vault engine validates the rule when you save the task.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Advanced rule"); Switch(advanced, { advanced = it })
            }
            if (advanced) OutlinedTextField(rule, { rule = it }, label = { Text("Recurrence rule") }, modifier = Modifier.fillMaxWidth())
            else {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("DAILY" to "Daily", "WEEKLY" to "Weekly", "MONTHLY" to "Monthly", "YEARLY" to "Yearly").forEach { (key, label) ->
                        FilterChip(changed && frequency == key, { frequency = key; changed = true }, label = { Text(label) })
                    }
                }
                OutlinedTextField(interval, { interval = it; changed = true }, label = { Text("Every · interval") }, singleLine = true, isError = !positive, modifier = Modifier.fillMaxWidth())
                if (frequency == "WEEKLY") FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("MO" to "Mon", "TU" to "Tue", "WE" to "Wed", "TH" to "Thu", "FR" to "Fri", "SA" to "Sat", "SU" to "Sun").forEach { (key, label) ->
                        FilterChip(key in weekdays, { weekdays = if (key in weekdays) weekdays - key else weekdays + key; changed = true }, label = { Text(label) })
                    }
                }
                FacetDateField("Ends on", end) { end = it; changed = true }
            }
            TextButton(onClick = { change(""); open = false }) { Text("Does not repeat") }
        }
    }
}
