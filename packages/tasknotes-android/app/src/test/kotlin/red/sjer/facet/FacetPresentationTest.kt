package red.sjer.facet

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import red.sjer.facet.host.VaultTask

class FacetPresentationTest {
    @Test fun unsupportedExistingFieldsRemainUntouchedDuringBodyEdit() {
        val original = task().copy(properties = JsonObject(task().properties + mapOf("timeEstimate" to buildJsonObject { put("vendor", true) }, "projects" to JsonArray(listOf(buildJsonObject { put("unknown", 42) })), "attachments" to buildJsonObject { put("old", "shape") }, "reminders" to JsonNull)))
        val changes = TaskEditorDraft.from(original).copy(body = "Reviewed").command(original).getValue("properties").jsonObject
        assertTrue(changes.isEmpty())
    }
    @Test fun typedReminderEditsPreserveUnknownData() {
        val original = task().copy(properties = JsonObject(task().properties + mapOf("timeEstimate" to Json.parseToJsonElement("9007199254740993"), "reminders" to Json.parseToJsonElement("[{\"id\":\"r1\",\"type\":\"absolute\",\"absoluteTime\":\"2026-10-03T17:00:00Z\",\"vendor\":{\"integer\":9007199254740993}}]"))))
        val draft = TaskEditorDraft.from(original)
        assertFalse(draft.copy(body = "Only body").command(original).getValue("properties").jsonObject.containsKey("timeEstimate"))
        val reminders = editEntry(Json.parseToJsonElement(draft.reminders).jsonArray, 0, "absoluteTime", "2026-10-04T17:00:00Z")
        val changed = draft.copy(reminders = reminders.toString(), attachments = "[[first.pdf]]\n[[second.pdf]]").command(original).getValue("properties").jsonObject
        assertEquals("9007199254740993", changed.getValue("reminders").jsonArray[0].jsonObject.getValue("vendor").jsonObject.getValue("integer").toString())
        assertEquals(2, changed.getValue("attachments").jsonArray.size)
    }
    private fun task() = VaultTask("id", "Tasks/custom.md", "Original", "needs-review", "urgent-client", false, "a".repeat(64), buildJsonObject {
        put("title", "Original"); put("status", "needs-review"); put("priority", "urgent-client"); put("projects", strings(listOf("[[Project, with comma]]"))); put("externalNumber", Json.parseToJsonElement("9007199254740993")); put("due", "2026-10-04")
    }, "Body", true, false, true, "2026-10-03", "2026-10-03", false)

    @Test fun bodyEditPreservesArbitraryWorkflowAndUnknownProperties() {
        val original = task()
        val command = TaskEditorDraft.from(original).copy(body = "Changed body").command(original)
        assertEquals(buildJsonObject {}, command.getValue("properties"))
        assertEquals("Changed body", command.getValue("body").jsonPrimitive.content)
        assertEquals(original.revision, command.getValue("expectedRevision").jsonPrimitive.content)
    }
    @Test fun openWorkflowStringsAndDateClearRemainExplicit() {
        val original = task()
        val command = TaskEditorDraft.from(original).copy(status = "client-approved", priority = "P0 custom", due = "").command(original)
        val props = command.getValue("properties").jsonObject
        assertEquals("edit_task", command.getValue("kind").jsonPrimitive.content)
        assertEquals("client-approved", command.getValue("status").jsonPrimitive.content)
        assertFalse(props.containsKey("status"))
        assertEquals("P0 custom", props.getValue("priority").jsonPrimitive.content)
        assertEquals(JsonNull, props.getValue("due"))
        assertFalse(props.containsKey("projects")); assertFalse(props.containsKey("externalNumber"))
    }
    @Test fun recurrenceCompletionIsAbsoluteAndPinsOccurrence() {
        val command = completionCommand(task(), true)
        assertEquals("set_completion", command.getValue("kind").jsonPrimitive.content)
        assertTrue(command.getValue("completed").jsonPrimitive.boolean)
        assertEquals("2026-10-03", command.getValue("occurrenceDate").jsonPrimitive.content)
    }
    @Test fun todayQueryDoesNotHideCompletedRecurringRowsAndUsesOpenValues() {
        val query = FacetQuery(statuses = listOf("client custom"), priorities = listOf("P0"), group = "project").document(100, 100, "2026-10-03", "2026-10-03T10:00:00Z")
        assertFalse(query.containsKey("completed")); assertFalse(query.containsKey("viewId"))
        assertEquals("today", query.getValue("scope").jsonPrimitive.content)
        assertEquals("client custom", query.getValue("statuses").jsonArray.single().jsonPrimitive.content)
        assertEquals(100, query.getValue("offset").jsonPrimitive.int)
    }
}
