package red.sjer.facet.host

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import uniffi.TaskNotesCore.CommonRecurrenceDraft
import uniffi.TaskNotesCore.CommonRecurrenceEnd
import uniffi.TaskNotesCore.CommonRecurrencePattern
import uniffi.TaskNotesCore.CommonWeekday
import uniffi.TaskNotesCore.CoreException
import uniffi.TaskNotesCore.MonthlyOrdinal

class FacetRecurrenceEditorTest {
    @Test fun weeklyProjectionAndBuildKeepCoreOwnedDaysIntervalCountAndOriginalInputs() = runBlocking {
        val caller = Thread.currentThread()
        val original = CommonRecurrenceDraft(2u, CommonRecurrencePattern.Weekly(listOf(CommonWeekday.MONDAY, CommonWeekday.WEDNESDAY)), CommonRecurrenceEnd.AfterOccurrences(7u))
        val core = RecordingCore(original, caller)
        val editor = FacetRecurrenceEditor(core)
        val rule = "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2;COUNT=7"
        val projection = editor.project(rule, "2026-10-05T09:00:00-07:00", "2026-09-01T08:00:00Z", "2026-10-04")
        assertEquals(listOf(rule, "2026-10-05T09:00:00-07:00", "2026-09-01T08:00:00Z"), core.startInputs)
        assertEquals(rule to "2026-10-05", core.parseInput)
        val draft = checkNotNull(projection.draft)
        assertEquals(2u, draft.interval)
        assertEquals(FacetRepeatPattern.Weekly(listOf(FacetRepeatWeekday.MONDAY, FacetRepeatWeekday.WEDNESDAY)), draft.pattern)
        assertEquals(FacetRepeatEnd.AfterOccurrences(7u), draft.ending)
        assertEquals("canonical core rule", editor.build(draft.copy(interval = 3u), projection.start))
        assertEquals(original.copy(interval = 3u), core.built)
        assertEquals("2026-10-05", core.buildStart)
        assertEquals(3, core.offCallerCalls)
    }

    @Test fun allCorePatternsAndEndingsRoundTripThroughThePortableHostSeam() = runBlocking {
        val patterns = listOf(CommonRecurrencePattern.Daily,
            CommonRecurrencePattern.Weekly(CommonWeekday.entries),
            CommonRecurrencePattern.MonthlyDayOfMonth(31u),
            CommonRecurrencePattern.YearlyMonthDay(2u, 29u)) + MonthlyOrdinal.entries.map {
                CommonRecurrencePattern.MonthlyOrdinalWeekday(it, CommonWeekday.FRIDAY)
            }
        val endings = listOf(CommonRecurrenceEnd.Never, CommonRecurrenceEnd.OnDate("2032-10-04"), CommonRecurrenceEnd.AfterOccurrences(11u))
        for (pattern in patterns) for (ending in endings) {
            val expected = CommonRecurrenceDraft(2u, pattern, ending)
            val core = RecordingCore(expected, Thread.currentThread())
            val editor = FacetRecurrenceEditor(core)
            val projection = editor.project("exact raw input", null, "2026-10-05T09:00:00Z", "2026-10-04")
            editor.build(checkNotNull(projection.draft), projection.start)
            assertEquals(expected, core.built)
        }
    }

    @Test fun aRuleDeclinedByTheCoreOrWithoutAResolvedAnchorStaysUnrepresentable() = runBlocking {
        val core = RecordingCore(null, Thread.currentThread())
        val editor = FacetRecurrenceEditor(core)
        val raw = "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9"
        assertNull(editor.project(raw, null, null, "2026-10-04").draft)
        assertEquals(raw to "2026-10-05", core.parseInput)
        core.resolved = null; core.parseInput = null
        assertNull(editor.project(raw, "unreadable original", null, "2026-10-04").draft)
        assertNull(core.parseInput)
        assertNull(core.built)
    }

    @Test fun newPatternDefaultsAreResolvedByCoreAndValidationKeepsItsTypedExplanation() = runBlocking {
        val core = RecordingCore(CommonRecurrenceDraft(1u, CommonRecurrencePattern.Weekly(listOf(CommonWeekday.MONDAY)), CommonRecurrenceEnd.Never), Thread.currentThread())
        val editor = FacetRecurrenceEditor(core)
        assertEquals(FacetRepeatPattern.Weekly(listOf(FacetRepeatWeekday.MONDAY)), editor.pattern("WEEKLY", "2026-10-05"))
        assertEquals("FREQ=WEEKLY" to "2026-10-05", core.parseInput)
        core.buildFailure = CoreException.Validation("weekly recurrence must select at least one weekday")
        try {
            editor.build(FacetRepeatDraft(1u, FacetRepeatPattern.Weekly(emptyList()), FacetRepeatEnd.Never), "2026-10-05")
            fail("Invalid common values must remain an editable validation failure.")
        } catch (failure: FacetActionError) { assertEquals("weekly recurrence must select at least one weekday", failure.explanation) }
    }

    private class RecordingCore(private val parsed: CommonRecurrenceDraft?, private val caller: Thread) : FacetRecurrenceCore {
        var resolved: String? = "2026-10-05"
        var startInputs: List<String?>? = null
        var parseInput: Pair<String, String>? = null
        var built: CommonRecurrenceDraft? = null
        var buildStart: String? = null
        var buildFailure: CoreException.Validation? = null
        var offCallerCalls = 0
        private fun offCaller() { check(Thread.currentThread() !== caller); offCallerCalls++ }
        override fun resolvedStart(rule: String, scheduled: String?, created: String?): String? {
            offCaller(); startInputs = listOf(rule, scheduled, created); return resolved
        }
        override fun parse(rule: String, start: String): CommonRecurrenceDraft? {
            offCaller(); parseInput = rule to start; return parsed
        }
        override fun build(draft: CommonRecurrenceDraft, start: String): String {
            offCaller(); built = draft; buildStart = start; buildFailure?.let { throw it }; return "canonical core rule"
        }
    }
}
