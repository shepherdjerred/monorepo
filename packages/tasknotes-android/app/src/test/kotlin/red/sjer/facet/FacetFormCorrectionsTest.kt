package red.sjer.facet

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.ObjectInputStream
import java.io.ObjectOutputStream
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import red.sjer.facet.host.FacetRepeatDraft
import red.sjer.facet.host.FacetRepeatEnd
import red.sjer.facet.host.FacetRepeatOrdinal
import red.sjer.facet.host.FacetRepeatPattern
import red.sjer.facet.host.FacetRepeatProjection
import red.sjer.facet.host.FacetRepeatWeekday

class FacetFormCorrectionsTest {
    @Test fun selectingDailyForANewRuleAppliesTheBuiltRuleAfterSavedState() = runBlocking<Unit> {
        val daily = FacetRepeatDraft(1u, FacetRepeatPattern.Daily, FacetRepeatEnd.Never)
        val unopened = FacetRecurrenceForm.from("", FacetRepeatProjection("2026-10-05", daily))
        assertNull(unopened.selectedFrequency)
        assertNull(unopened.changeToApply { _, _ -> fail("Opening and closing an empty rule must not build a recurrence."); "unexpected" })

        val selected = restore(unopened.selectFrequency(FacetRepeatPattern.Daily))
        assertEquals("DAILY", selected.selectedFrequency)
        assertTrue(selected.changed)
        assertTrue(selected.valid)
        var builds = 0
        val applied = selected.changeToApply { draft, start ->
            builds++
            assertEquals(daily, draft)
            assertEquals("2026-10-05", start)
            "FREQ=DAILY"
        }
        assertEquals(1, builds)
        assertEquals("FREQ=DAILY", applied)
    }

    @Test fun selectingAnExistingDailyFrequencyKeepsDoneUnchanged() = runBlocking<Unit> {
        val rule = "FREQ=DAILY;INTERVAL=2;COUNT=7"
        val daily = FacetRepeatDraft(2u, FacetRepeatPattern.Daily, FacetRepeatEnd.AfterOccurrences(7u))
        val original = FacetRecurrenceForm.from(rule, FacetRepeatProjection("2026-10-05", daily))
        assertEquals("DAILY", original.selectedFrequency)
        val selected = restore(original.selectFrequency(FacetRepeatPattern.Daily))
        assertEquals(original, selected)
        assertFalse(selected.changed)
        assertEquals(rule, selected.original)
        assertNull(selected.changeToApply { _, _ -> fail("An unchanged existing rule must keep its bytes without rebuilding."); "unexpected" })
    }

    @Test fun editingWeeklyIntervalPreservesWeekdaysAndCountAcrossSavedState() {
        val original = FacetRepeatDraft(2u, FacetRepeatPattern.Weekly(listOf(FacetRepeatWeekday.MONDAY, FacetRepeatWeekday.WEDNESDAY)), FacetRepeatEnd.AfterOccurrences(10u))
        val form = FacetRecurrenceForm.from("FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2;COUNT=10", FacetRepeatProjection("2026-10-05", original))
        assertEquals("WEEKLY", form.frequency)
        assertEquals("2", form.interval)
        assertEquals("10", form.count)
        assertFalse(form.changed)
        assertEquals(form, form.selectFrequency(original.pattern))
        val edited = form.copy(interval = "3", changed = true)
        assertTrue(edited.valid)
        val restored = restore(edited)
        assertEquals(edited, restored)
        assertEquals(original.copy(interval = 3u), restored.buildDraft())
    }

    @Test fun intervalEditsRetainMonthlyAndYearlySelectorsAndDateEndings() {
        val patterns = listOf(FacetRepeatPattern.MonthlyDay(31u),
            FacetRepeatPattern.MonthlyWeekday(FacetRepeatOrdinal.LAST, FacetRepeatWeekday.FRIDAY), FacetRepeatPattern.Yearly(2u, 29u))
        for (pattern in patterns) {
            val original = FacetRepeatDraft(2u, pattern, FacetRepeatEnd.OnDate("2032-10-04"))
            val form = FacetRecurrenceForm.from("unchanged core-owned rule", FacetRepeatProjection("2028-02-29", original))
            val edited = restore(form.copy(interval = "4", changed = true)).buildDraft()
            assertEquals(original.copy(interval = 4u), edited)
        }
    }

    @Test fun customRawRuleRemainsExactAndCannotBecomeSimpleWithoutAProjection() = runBlocking<Unit> {
        val raw = "DTSTART:20261005T090000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=7"
        val form = FacetRecurrenceForm.from(raw, FacetRepeatProjection("2026-10-05", null))
        val restored = restore(form)
        assertTrue(restored.advanced)
        assertEquals(raw, restored.raw)
        assertEquals(raw, restored.original)
        assertNull(restored.draft)
        assertNull(restored.frequency)
        assertFalse(restored.changed)
        assertNull(restored.changeToApply { _, _ -> fail("An unchanged advanced rule must not build a simple recurrence."); "unexpected" })
        val edited = restored.copy(raw = raw + ";WKST=SU", changed = true)
        assertEquals(edited.raw, edited.changeToApply { _, _ -> fail("Advanced text must remain authoritative."); "unexpected" })
    }

    @Test fun invalidCommonInputsDoNotEnableDoneOrDropTheirOtherFields() {
        val draft = FacetRepeatDraft(2u, FacetRepeatPattern.Weekly(listOf(FacetRepeatWeekday.MONDAY)), FacetRepeatEnd.AfterOccurrences(7u))
        val form = FacetRecurrenceForm.from("FREQ=WEEKLY;INTERVAL=2;COUNT=7", FacetRepeatProjection("2026-10-05", draft))
        for (text in listOf("", "0", "-1", "4294967296")) {
            assertFalse(form.copy(interval = text, changed = true).valid)
            assertFalse(form.copy(count = text, changed = true).valid)
        }
        assertFalse(form.withPattern(FacetRepeatPattern.Weekly(emptyList())).valid)
        assertEquals(draft.ending, form.withPattern(FacetRepeatPattern.Daily).buildDraft().ending)
    }

    @Test fun relativeToAbsoluteRemovesOnlyRelativeFieldsAndBuildsAnAbsolutePayload() {
        val original = Json.parseToJsonElement("""[{"id":"r1","type":"relative","relatedTo":"scheduled","offset":"-PT15M","description":"Keep this","vendor":{"integer":9007199254740993}},{"id":"r2","type":"relative","relatedTo":"due","offset":"-PT1H"}]""").jsonArray
        val switched = editEntry(original, 0, "type", "absolute")
        val completed = editEntry(switched, 0, "absoluteTime", "2026-10-26T09:00:00Z")
        val reminder = completed[0].jsonObject
        assertFalse(reminder.containsKey("relatedTo")); assertFalse(reminder.containsKey("offset"))
        assertEquals("2026-10-26T09:00:00Z", reminder.getValue("absoluteTime").jsonPrimitive.content)
        assertEquals("r1", reminder.getValue("id").jsonPrimitive.content)
        assertEquals("Keep this", reminder.getValue("description").jsonPrimitive.content)
        assertEquals(original[0].jsonObject.getValue("vendor"), reminder.getValue("vendor"))
        assertEquals(original[1], completed[1])
    }

    @Test fun absoluteToRelativeRemovesOnlyAbsoluteTimeAndKeepsOtherReminderEntries() {
        val original = Json.parseToJsonElement("""[{"id":"r1","type":"absolute","absoluteTime":"2026-10-26T09:00:00Z","vendor":true},{"id":"r2","type":"absolute","absoluteTime":"2026-10-27T09:00:00Z"}]""").jsonArray
        val switched = editEntry(original, 0, "type", "relative")
        val related = editEntry(switched, 0, "relatedTo", "due")
        val completed = editEntry(related, 0, "offset", "-PT30M")
        val reminder = completed[0].jsonObject
        assertFalse(reminder.containsKey("absoluteTime"))
        assertEquals("due", reminder.getValue("relatedTo").jsonPrimitive.content)
        assertEquals("-PT30M", reminder.getValue("offset").jsonPrimitive.content)
        assertEquals(JsonPrimitive(true), reminder.getValue("vendor"))
        assertEquals(original[1], completed[1])
    }

    @Test fun sameTypeAndOrdinaryEditsRetainAllExistingFields() {
        val original = Json.parseToJsonElement("""[{"id":"r1","type":"absolute","absoluteTime":"2026-10-26T09:00:00Z","relatedTo":"legacy","offset":"legacy","vendor":true}]""").jsonArray
        assertEquals(original, editEntry(original, 0, "type", "absolute"))
        val edited = editEntry(original, 0, "absoluteTime", "2026-10-27T09:00:00Z")[0].jsonObject
        assertEquals(JsonPrimitive("legacy"), edited.getValue("relatedTo"))
        assertEquals(JsonPrimitive("legacy"), edited.getValue("offset"))
        assertEquals(JsonPrimitive(true), edited.getValue("vendor"))
    }

    private fun restore(form: FacetRecurrenceForm): FacetRecurrenceForm {
        val bytes = ByteArrayOutputStream().also { output -> ObjectOutputStream(output).use { it.writeObject(form) } }.toByteArray()
        return ObjectInputStream(ByteArrayInputStream(bytes)).use { it.readObject() as FacetRecurrenceForm }
    }
}
