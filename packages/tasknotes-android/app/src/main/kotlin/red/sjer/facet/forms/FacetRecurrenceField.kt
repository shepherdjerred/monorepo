package red.sjer.facet

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import kotlinx.coroutines.launch
import red.sjer.facet.host.FacetActionError
import red.sjer.facet.host.FacetRecurrenceEditor
import red.sjer.facet.host.FacetRepeatDraft
import red.sjer.facet.host.FacetRepeatEnd
import red.sjer.facet.host.FacetRepeatPattern
import red.sjer.facet.host.FacetRepeatWeekday

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun FacetRecurrenceField(value: String, scheduled: String, created: String, enabled: Boolean, change: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val label = when (value) { "" -> "Does not repeat"; "FREQ=DAILY" -> "Daily"; "FREQ=WEEKLY" -> "Weekly"; "FREQ=MONTHLY" -> "Monthly"; "FREQ=YEARLY" -> "Yearly"; else -> "Custom repeat rule" }
    FacetFieldRow("Repeat", label, Icons.Default.Repeat, enabled) { open = true }
    if (!open) return

    val codec = FacetRecurrenceEditor.shared
    val scope = rememberCoroutineScope()
    var form by rememberSaveable(value, scheduled, created) { mutableStateOf<FacetRecurrenceForm?>(null) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(value, scheduled, created) {
        if (form == null) form = FacetRecurrenceForm.from(value,
            codec.project(value, scheduled.takeIf(String::isNotEmpty), created.takeIf(String::isNotEmpty), LocalDate.now().toString()))
    }
    fun action(operation: suspend () -> Unit) {
        if (saving) return
        saving = true; error = null
        scope.launch {
            try { operation() }
            catch (failure: FacetActionError) { error = failure.explanation }
            finally { saving = false }
        }
    }
    val current = form
    FacetSheet("Repeat task", { if (!saving) open = false }, "Done", enabled = enabled && !saving && current?.valid == true, save = {
        if (current != null) action {
            if (current.changed) change(if (current.advanced) current.raw else codec.build(current.buildDraft(), current.start))
            open = false
        }
    }) {
        if (value.isNotEmpty()) Text("Current rule: $value", style = MaterialTheme.typography.bodyMedium)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (current == null) { Text("Loading repeat rule…"); return@FacetSheet }
        Text("The vault engine validates the rule when you save the task.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Advanced rule")
            Switch(current.advanced, { advanced -> action {
                if (advanced) form = current.copy(advanced = true,
                    raw = if (current.changed) codec.build(current.buildDraft(), current.start) else current.raw)
                else {
                    val parsed = codec.project(current.raw, scheduled.takeIf(String::isNotEmpty), created.takeIf(String::isNotEmpty), current.start)
                    if (parsed.draft == null) error = "This rule uses advanced options. Keep editing it here, or explicitly replace it with a simple rule."
                    else form = FacetRecurrenceForm.from(current.raw, parsed).copy(original = current.original, changed = current.changed)
                }
            } }, enabled = enabled && !saving)
        }
        if (current.advanced) {
            OutlinedTextField(current.raw, { form = current.copy(raw = it, draft = null, changed = true) }, label = { Text("Recurrence rule") }, enabled = enabled && !saving, modifier = Modifier.fillMaxWidth())
            if (current.draft == null) {
                Text("Raw rule text stays authoritative. Turn off Advanced rule to check the simple controls, or explicitly replace the rule.", style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { action {
                    val pattern = codec.pattern("DAILY", current.start)
                    val replacement = FacetRepeatDraft(1u, pattern, FacetRepeatEnd.Never)
                    form = current.copy(draft = replacement, interval = "1", endDate = "", count = "1", advanced = false, changed = true)
                } }, enabled = enabled && !saving) { Text("Replace with a simple rule") }
            }
        } else {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("DAILY" to "Daily", "WEEKLY" to "Weekly", "MONTHLY" to "Monthly", "YEARLY" to "Yearly").forEach { (frequency, text) ->
                    FilterChip(current.frequency == frequency, {
                        if (current.frequency != frequency) action { form = current.withPattern(codec.pattern(frequency, current.start)) }
                    }, enabled = enabled && !saving, label = { Text(text) })
                }
            }
            OutlinedTextField(current.interval, { form = current.copy(interval = it, changed = true) }, label = { Text("Every · interval") }, singleLine = true,
                isError = current.interval.toUIntOrNull()?.let { it > 0u } != true, enabled = enabled && !saving, modifier = Modifier.fillMaxWidth())
            when (val pattern = current.draft?.pattern) {
                is FacetRepeatPattern.Weekly -> FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FacetRepeatWeekday.entries.forEach { day ->
                        FilterChip(day in pattern.weekdays, {
                            form = current.withPattern(pattern.copy(weekdays = if (day in pattern.weekdays) pattern.weekdays - day else pattern.weekdays + day))
                        }, enabled = enabled && !saving, label = { Text(day.label) })
                    }
                }
                is FacetRepeatPattern.MonthlyDay -> Text("On day ${pattern.day}")
                is FacetRepeatPattern.MonthlyWeekday -> Text("On the ${pattern.ordinal.label} ${pattern.weekday.label}")
                is FacetRepeatPattern.Yearly -> Text("On ${pattern.month}/${pattern.day}")
                FacetRepeatPattern.Daily, null -> Unit
            }
            val ending = checkNotNull(current.draft).ending
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(ending == FacetRepeatEnd.Never, { form = current.withEnding(FacetRepeatEnd.Never) }, enabled = enabled && !saving, label = { Text("Never ends") })
                FilterChip(ending is FacetRepeatEnd.OnDate, {
                    if (ending !is FacetRepeatEnd.OnDate) form = current.withEnding(FacetRepeatEnd.OnDate(current.start))
                }, enabled = enabled && !saving, label = { Text("On a date") })
                FilterChip(ending is FacetRepeatEnd.AfterOccurrences, {
                    if (ending !is FacetRepeatEnd.AfterOccurrences) form = current.withEnding(FacetRepeatEnd.AfterOccurrences(1u))
                }, enabled = enabled && !saving, label = { Text("After a count") })
            }
            when (ending) {
                is FacetRepeatEnd.OnDate -> FacetDateField("Ends on", current.endDate, enabled && !saving) { form = current.copy(endDate = it, changed = true) }
                is FacetRepeatEnd.AfterOccurrences -> OutlinedTextField(current.count, { form = current.copy(count = it, changed = true) }, label = { Text("Number of occurrences") },
                    singleLine = true, isError = current.count.toUIntOrNull()?.let { it > 0u } != true, enabled = enabled && !saving, modifier = Modifier.fillMaxWidth())
                FacetRepeatEnd.Never -> Unit
            }
        }
        TextButton(onClick = { change(""); open = false }, enabled = enabled && !saving) { Text("Does not repeat") }
    }
}
