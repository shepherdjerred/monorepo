package red.sjer.facet

import java.time.LocalDate
import java.time.ZoneId
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import red.sjer.facet.host.VaultTask
import red.sjer.facet.host.VaultSnapshot

class FacetNativePresentationTest {
    private fun task(id: String, occurrence: String? = null) = VaultTask(id, "Tasks/$id.md", "Task $id", "custom-open", "client-priority", false, "a".repeat(64),
        buildJsonObject { put("projects", strings(listOf("ACME, Inc", "Design"))) }, "", occurrence != null, false, false, occurrence, occurrence, false)
    private fun group(key: String, vararg ids: String) = buildJsonObject { put("key", key); put("taskIds", strings(ids.toList())) }
    private fun snapshot(tasks: List<VaultTask>, groups: List<JsonObject>) = VaultSnapshot("vault", 1uL, tasks, tasks.size.toULong(), 0uL, 0uL, null, emptyList(), emptyList(), groups, emptyList())

    @Test fun sameNoteOccurrencesCannotEnterCompletionBatch() {
        val first = task("repeat", "2026-10-08"); val second = task("repeat", "2026-10-09")
        val failure = assertThrows(FacetBulkSelectionError::class.java) { bulkCommand(listOf(first, second), "complete") }
        assertTrue(failure.message!!.contains("separately"))
        val distinct = bulkCommand(listOf(first, task("other", "2026-10-09")), "complete").getValue("commands").jsonArray
        assertEquals(listOf("Tasks/repeat.md", "Tasks/other.md"), distinct.map { it.jsonObject.getValue("path").jsonPrimitive.content })
        assertEquals("2026-10-08", distinct.first().jsonObject.getValue("occurrenceDate").jsonPrimitive.content)
    }
    @Test fun noteScopedBulkDeduplicatesOccurrencesAndRejectsStaleReviewedRevisions() {
        val first = task("repeat", "2026-10-08"); val second = task("repeat", "2026-10-09")
        for (action in listOf("schedule", "priority", "delete")) {
            val commands = bulkCommand(listOf(first, second, task("other")), action, "custom-value").getValue("commands").jsonArray
            assertEquals(2, commands.size)
            assertEquals("a".repeat(64), commands.first().jsonObject.getValue("expectedRevision").jsonPrimitive.content)
            assertFalse(commands.first().jsonObject.containsKey("occurrenceDate"))
            assertThrows(FacetBulkSelectionError::class.java) { bulkCommand(listOf(first, second.copy(revision = "b".repeat(64))), action) }
        }
    }

    @Test fun groupsKeepCoreOrderAndAllowMultipleProjectMembership() {
        val a = task("a"); val b = task("b")
        val sections = taskSections(snapshot(listOf(a, b), listOf(group("Second", "b", "a"), group("First", "a"))))
        assertEquals(listOf("Second", "First"), sections.map { it.key })
        assertEquals(listOf(b, a), sections[0].tasks)
        assertEquals(listOf(a), sections[1].tasks)
    }
    @Test fun continuedGroupsKeepSeparateOccurrenceIdentitiesAndPageOrder() {
        val first = task("repeat", "2026-10-08"); val second = task("repeat", "2026-10-09")
        val sections = taskSections(snapshot(listOf(first, second), listOf(group("day", "repeat"), group("day", "repeat"))))
        assertEquals(listOf(first, second), sections.single().tasks)
        assertNotEquals(taskRowKey(first), taskRowKey(second))
    }
    @Test fun omittedOrForeignGroupMembersFailAtTheContractBoundary() {
        try { taskSections(snapshot(listOf(task("a")), listOf(group("x", "missing")))); fail() } catch (_: IllegalArgumentException) {}
        try { taskSections(snapshot(listOf(task("a"), task("b")), listOf(group("x", "a")))); fail() } catch (_: IllegalStateException) {}
    }
    @Test fun dateGroupIdentityJoinsTheCorrectOccurrenceOfOneNote() {
        val first = task("repeat", "2026-10-08"); val second = task("repeat", "2026-10-09")
        val sections = taskSections(snapshot(listOf(first, second), listOf(group("2026-10-08", "repeat"), group("2026-10-09", "repeat"))), "effectiveDate")
        assertEquals(first, sections[0].tasks.single()); assertEquals(second, sections[1].tasks.single())
    }
    @Test fun timestampDatesUseTheViewingZoneWhileCivilDatesStayCivil() {
        assertEquals(LocalDate.parse("2026-10-07"), civilDate("2026-10-08T00:30:00Z", ZoneId.of("America/Los_Angeles")))
        assertEquals(LocalDate.parse("2026-10-08"), civilDate("2026-10-07T23:30:00-10:00", ZoneId.of("Europe/Paris")))
        assertEquals(LocalDate.parse("2026-10-08"), civilDate("2026-10-08", ZoneId.of("Pacific/Honolulu")))
    }
    @Test fun differentRowsAreAdmittedWithoutRetargetingTheOriginalRevision() {
        val admission = FacetCompletionAdmission()
        val a = requireNotNull(admission.admit("original", task("a")))
        val b = requireNotNull(admission.admit("original", task("b")))
        assertNotEquals(a.mutationId, b.mutationId)
        assertNull(admission.admit("original", task("a").copy(revision = "b".repeat(64))))
        assertEquals("a".repeat(64), a.command.getValue("expectedRevision").jsonPrimitive.content)
        assertTrue(a.command.getValue("completed").jsonPrimitive.boolean)
        assertTrue(admission.owns(a)); assertTrue(admission.owns(b))
    }
    @Test fun profileSwitchDoesNotRetargetQueuedOldProfileIntent() {
        val admission = FacetCompletionAdmission()
        val old = requireNotNull(admission.admit("original", task("same")))
        val next = requireNotNull(admission.admit("new", task("same")))
        assertEquals("original", old.profileId); assertEquals("new", next.profileId)
        admission.release(next)
        assertTrue(admission.owns(old)); assertFalse(admission.owns(next))
        assertEquals("Tasks/same.md", old.command.getValue("path").jsonPrimitive.content)
    }
    @Test fun occurrenceAdmissionCancellationAndDisposalCannotReuseOldIntent() {
        val admission = FacetCompletionAdmission()
        val first = requireNotNull(admission.admit("vault", task("repeat", "2026-10-08")))
        val second = requireNotNull(admission.admit("vault", task("repeat", "2026-10-09")))
        assertEquals("2026-10-09", second.command.getValue("occurrenceDate").jsonPrimitive.content)
        admission.release(first)
        val retry = requireNotNull(admission.admit("vault", task("repeat", "2026-10-08")))
        admission.release(first)
        assertTrue(admission.owns(retry))
        assertNotEquals(first.mutationId, retry.mutationId)
        admission.close()
        assertFalse(admission.owns(second)); assertFalse(admission.owns(retry))
        assertNull(admission.admit("other", task("new")))
    }
    @Test fun structuredTokenEditsPreserveCommasInsideAnIndividualValue() {
        val original = task("a")
        val draft = TaskEditorDraft.from(original).copy(tokenEdits = buildJsonObject { put("projects", strings(listOf("ACME, Inc", "New project"))) })
        assertEquals(strings(listOf("ACME, Inc", "New project")), draft.command(original).getValue("properties").jsonObject.getValue("projects"))
        val unchanged = TaskEditorDraft.from(original).copy(tokenEdits = buildJsonObject { put("projects", original.properties.getValue("projects")) })
        assertTrue(unchanged.command(original).getValue("properties").jsonObject.isEmpty())
    }
    @Test fun configuredColorsUseCssRgbaRatherThanAndroidArgb() {
        mapOf("#abc" to 0xffaabbccL, "#abcd" to 0xddaabbccL, "#112233" to 0xff112233L, "#11223380" to 0x80112233L,
            " RED " to 0xffff0000L, "transparent" to 0L).forEach { (raw, expected) ->
            val result = projectFacetColor(raw); assertEquals(expected, result.argb); assertNull(result.diagnostic)
        }
    }
    @Test fun consumedFeedbackDoesNotReplayAfterCompositionRecreation() {
        val coordinator = FacetFeedbackCoordinator()
        val event = coordinator.publish("vault", "receipt", "receipt")
        assertEquals(event, coordinator.consume("vault"))
        assertNull(coordinator.consume("vault"))
    }
    @Test fun feedbackCannotUndoAnotherVaultOrANewerReceipt() {
        val coordinator = FacetFeedbackCoordinator()
        val event = coordinator.publish("original", "receipt", "receipt")
        assertFalse(coordinator.mayUndo(event, "other", "receipt"))
        assertFalse(coordinator.mayUndo(event, "original", "newer"))
        assertTrue(coordinator.mayUndo(event, "original", "receipt"))
        assertNull(coordinator.consume("other")); assertNull(coordinator.consume("original"))
        val noUndo = coordinator.publish("original", "create", null)
        assertFalse(coordinator.mayUndo(noUndo, "original", "newer"))
    }
    @Test fun unsupportedColorsProduceAnActionableDiagnosticWithoutChangingRawValues() {
        listOf("", "#zzffff", "#12", "rgb(1,2,3)", "brand-indigo").forEach { raw ->
            val result = projectFacetColor(raw); assertNull(result.argb); assertTrue(requireNotNull(result.diagnostic).contains(raw)); assertTrue(result.diagnostic.contains("TaskNotes settings"))
        }
    }
    private fun resource(name: String) = requireNotNull(javaClass.getResourceAsStream("/presentation/$name")).bufferedReader().use { it.readText() }
    @Test fun sharedPresentationTokensValidateInKotlin() {
        val tokens = FacetPresentationTokens.read(resource("tokens.json"), resource("presentation.schema.json"))
        assertEquals(48, tokens.number("hitTargets", "android"))
        assertEquals(22, tokens.number("mobile", "checkboxSize"))
    }
    @Test fun sharedColorPolicyIsStrictAndEveryNamedProjectionMatchesIt() {
        val policy = Json.parseToJsonElement(resource("color-policy.json")).jsonObject
        val schema = red.sjer.facet.host.FacetSchema(resource("presentation.schema.json"))
        schema.validate("colorPolicy", policy)
        policy.getValue("namedColors").jsonObject.forEach { (name, hex) ->
            assertEquals(projectFacetColor(hex.jsonPrimitive.content).argb, projectFacetColor("  " + name.uppercase() + "  ").argb)
        }
        try { schema.validate("colorPolicy", JsonObject(policy + ("hexOrder" to JsonPrimitive("argb")))); fail() } catch (_: IllegalArgumentException) {}
    }
    @Test fun missingUnknownAndNestedWrongTokensAreRejected() {
        val original = Json.parseToJsonElement(resource("tokens.json")).jsonObject
        val values = listOf(
            JsonObject(original - "colorRoles"),
            JsonObject(original + ("unknown" to JsonPrimitive(true))),
            JsonObject(original + ("hitTargets" to JsonObject(original.getValue("hitTargets").jsonObject + ("android" to JsonPrimitive(1))))),
            JsonObject(original + ("motion" to JsonObject(original.getValue("motion").jsonObject + ("unknown" to JsonPrimitive(0)))))
        )
        values.forEach { document -> try { FacetPresentationTokens.read(document.toString(), resource("presentation.schema.json")); fail() } catch (_: IllegalArgumentException) {} }
    }
}
