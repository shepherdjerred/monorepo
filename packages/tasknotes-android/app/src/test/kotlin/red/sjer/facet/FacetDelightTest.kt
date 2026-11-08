package red.sjer.facet

import java.security.MessageDigest
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class FacetDelightTest {
    @Test fun overlappingPhysicalCuesAreConsumedWithoutADeferredReplay() {
        val gate = FacetAudioGate()
        assertTrue(gate.claim(1000, 176))
        assertFalse(gate.claim(1001, 104))
        assertFalse(gate.claim(1175, 88))
        assertTrue(gate.claim(1176, 88))
    }
    private fun resource(path: String) = requireNotNull(javaClass.getResourceAsStream("/presentation/$path")).use { it.readBytes() }
    private fun policy() = FacetFeedbackPolicy.read(resource("feedback.schema.json").decodeToString(), resource("feedback.json").decodeToString(), resource("audio/palette.json").decodeToString())
    @Test fun sharedFeedbackPolicyAndActualBundledPaletteAgree() {
        val policy = policy()
        assertEquals(FacetFeedbackEffect("complete", "success"), policy.effects.getValue(FacetFeedbackKind.COMPLETED))
        assertEquals(FacetFeedbackEffect("delete", "light"), policy.effects.getValue(FacetFeedbackKind.DELETED))
        assertEquals(FacetFeedbackEffect(null, "none"), policy.effects.getValue(FacetFeedbackKind.SAVED))
        policy.cues.forEach { (_, value) ->
            val record = value.jsonObject
            val bytes = resource("audio/" + record.getValue("file").jsonPrimitive.content)
            assertEquals(record.getValue("sha256").jsonPrimitive.content, MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) })
            assertEquals("RIFF", bytes.copyOfRange(0, 4).decodeToString())
            assertEquals("WAVE", bytes.copyOfRange(8, 12).decodeToString())
        }
    }
    @Test fun divergentPolicyCannotSilentlyChangeNativeFeedback() {
        val raw = Json.parseToJsonElement(resource("feedback.json").decodeToString()).jsonObject
        val changed = JsonObject(raw + ("bulk" to JsonPrimitive("per-task")))
        try { FacetFeedbackPolicy.read(resource("feedback.schema.json").decodeToString(), changed.toString(), resource("audio/palette.json").decodeToString()); fail() } catch (_: IllegalArgumentException) { }
    }
    @Test fun explicitIndependentPreferencesSurviveMissingAndCombinedValues() {
        assertEquals(FacetFeedbackPreferences(), FacetFeedbackPreferences.read(emptyMap<String, Any>()))
        assertEquals(FacetFeedbackPreferences(false, false), FacetFeedbackPreferences.read(mapOf("feedback.enabled" to false)))
        assertEquals(FacetFeedbackPreferences(false, true), FacetFeedbackPreferences.read(mapOf("feedback.haptics" to false)))
        assertEquals(FacetFeedbackPreferences(true, false), FacetFeedbackPreferences.read(mapOf("feedback.enabled" to false, "feedback.haptics" to true)))
    }
    @Test fun malformedPreferencesRequireExplicitRecoveryInsteadOfEnablingFeedback() {
        listOf(mapOf("feedback.sound" to "false"), mapOf("feedback.haptics" to 1), mapOf("feedback.enabled" to null)).forEach { values ->
            try { FacetFeedbackPreferences.read(values); fail() } catch (failure: IllegalArgumentException) { assertTrue(requireNotNull(failure.message).contains("Reset")) }
        }
    }
    @Test fun oneReceiptCannotReplayButAnotherEngineAndVaultAreIndependent() {
        val coordinator = FacetFeedbackCoordinator()
        assertNotNull(coordinator.publish("vault", "mutation", null, engineGeneration = 7))
        assertNotNull(coordinator.consume("vault", engineGeneration = 7))
        assertNull(coordinator.publish("vault", "mutation", null, engineGeneration = 7))
        assertNotNull(coordinator.publish("other", "mutation", null, engineGeneration = 7))
        assertNotNull(coordinator.consume("other", engineGeneration = 7))
        assertNotNull(coordinator.publish("vault", "mutation", null, engineGeneration = 8))
        assertNotNull(coordinator.consume("vault", engineGeneration = 8))
    }
    @Test fun suppressedNoopOrBackgroundReceiptIsConsumedAndNeverReplayed() {
        val coordinator = FacetFeedbackCoordinator()
        assertNull(coordinator.publish("vault", "noop", null, eligible = false))
        assertNull(coordinator.publish("vault", "noop", null))
        assertNull(coordinator.publish("vault", "background", null, eligible = false))
        assertNull(coordinator.publish("vault", "background", null))
        assertNull(coordinator.consume("vault"))
    }
    @Test fun rapidIndependentReceiptsRemainOrderedWithoutCoalescingTheirCues() {
        val coordinator = FacetFeedbackCoordinator()
        coordinator.publish("vault", "one", null)
        coordinator.publish("vault", "two", null)
        coordinator.publish("vault", "three", null)
        assertEquals(listOf("one", "two", "three"), List(3) { requireNotNull(coordinator.consume("vault")).mutationId })
        assertNull(coordinator.consume("vault"))
    }
    @Test fun engineReplacementSuppressesOldCueAndNoticeWithoutChangingProfileOrScene() {
        val coordinator = FacetFeedbackCoordinator()
        coordinator.publish("vault", "old", "old", engineGeneration = 7, foregroundGeneration = 4)
        assertNull(coordinator.consume("vault", 4, engineGeneration = 8))
        assertNull(coordinator.consumeNotice("vault", 4, engineGeneration = 8))
        assertNull(coordinator.consume("vault", 4, engineGeneration = 7))
    }
    @Test fun stoppedForegroundConsumesBothPresentationsWithoutReplayingOnResume() {
        val coordinator = FacetFeedbackCoordinator()
        coordinator.publish("vault", "old", "old", foregroundGeneration = 4)
        assertNull(coordinator.consume("vault", 4, foreground = false))
        assertNull(coordinator.consumeNotice("vault", 4, foreground = false))
        assertNull(coordinator.consume("vault", 4))
        assertNull(coordinator.consumeNotice("vault", 4))
        coordinator.publish("vault", "next", null, foregroundGeneration = 4)
        assertNull(coordinator.consume("vault", 5))
    }
    @Test fun verifiedCueDoesNotWaitForUndoReadAndLateAuthorityCannotReplaceANewerNotice() {
        val coordinator = FacetFeedbackCoordinator()
        val first = requireNotNull(coordinator.publish("vault", "first", null, noticeReady = false))
        assertEquals(first, coordinator.consume("vault"))
        assertNull(coordinator.consumeNotice("vault", 0))
        val authorized = coordinator.authorizeNotice(first, "first")
        assertEquals(authorized, coordinator.consumeNotice("vault", 0))
        assertNull(coordinator.consume("vault"))
        coordinator.publish("vault", "newer", null)
        assertNull(coordinator.authorizeNotice(first, "first"))
    }
    @Test fun aBatchProjectsOneAggregateEffectAndGenericEditsStayQuiet() {
        fun command(kind: String) = buildJsonObject { put("kind", kind); if (kind == "set_completion") put("completed", true) }
        val batch = buildJsonObject { put("kind", "batch"); put("commands", JsonArray(List(3) { command("set_completion") })) }
        assertEquals(FacetFeedbackKind.COMPLETED, feedbackKind(batch))
        assertEquals(FacetFeedbackKind.SAVED, feedbackKind(command("edit_task")))
        assertEquals(FacetFeedbackKind.SAVED, feedbackKind(buildJsonObject { put("kind", "batch"); put("commands", JsonArray(listOf(command("delete"), command("edit_task")))) }))
    }
    private val preview = Json.parseToJsonElement("""{"properties":{"title":"Ship","priority":"custom","due":"2026-10-10","projects":["Parsed"],"vendor":{"keep":9007199254740993}},"body":"Parsed **notes**","diagnostics":[]}""").jsonObject
    @Test fun metadataOnlyCanonicalPreviewCannotSubmitAndDraftRemainsEditable() {
        val draft = FacetCaptureDraft("tomorrow p:Work").tokens("contexts", listOf("ACME, Inc")).copy(notes = "Keep **notes**")
        fun title(value: String) = JsonObject(preview + ("properties" to JsonObject(preview.getValue("properties").jsonObject + ("title" to JsonPrimitive(value)))))
        assertFalse(draft.hasTaskTitle(title("")))
        assertFalse(draft.hasTaskTitle(title("  \n")))
        assertTrue(draft.copy(input = "Review tomorrow p:Work").hasTaskTitle(title("Review")))
        assertEquals(draft, FacetCaptureDraft.restore(draft.saved()))
        assertEquals("Keep **notes**", draft.payload(title("")).getValue("body").jsonPrimitive.content)
        assertEquals(strings(listOf("ACME, Inc")), draft.payload(title("")).getValue("properties").jsonObject.getValue("contexts"))
    }
    @Test fun explicitCaptureOverridesPreserveParserFieldsExactTokensAndMarkdown() {
        val draft = FacetCaptureDraft("Ship tomorrow").field("due", "").field("priority", "custom-high")
            .tokens("projects", listOf("ACME, Inc", "Project")).copy(notes = "# Details\n\nKeep **Markdown**.")
        val payload = draft.payload(preview)
        assertEquals(JsonNull, payload.getValue("properties").jsonObject.getValue("due"))
        assertEquals(strings(listOf("ACME, Inc", "Project")), payload.getValue("properties").jsonObject.getValue("projects"))
        assertEquals(preview.getValue("properties").jsonObject.getValue("vendor"), payload.getValue("properties").jsonObject.getValue("vendor"))
        assertEquals("# Details\n\nKeep **Markdown**.", payload.getValue("body").jsonPrimitive.content)
        assertEquals(draft, FacetCaptureDraft.restore(draft.saved()))
    }
    @Test fun frozenCapturePayloadCannotFollowNewTextAndUnsetNotesKeepParsedBody() {
        val original = FacetCaptureDraft("Ship tomorrow")
        val frozen = original.payload(preview)
        val newer = original.copy(input = "Different task", notes = "Changed")
        assertEquals("Parsed **notes**", frozen.getValue("body").jsonPrimitive.content)
        assertNotEquals(frozen, newer.payload(preview))
        assertEquals(original, FacetCaptureDraft.restore(original.saved()))
    }
    @Test fun removingParsedScalarAndExactTokenSurvivesARefreshedParserPreview() {
        val draft = FacetCaptureDraft("Ship tomorrow").field("due", "").field("recurrence", "").tokens("projects", listOf("ACME, Inc"))
        val refreshed = JsonObject(preview + ("properties" to JsonObject(preview.getValue("properties").jsonObject + mapOf(
            "due" to JsonPrimitive("2026-11-10"), "recurrence" to JsonPrimitive("FREQ=DAILY"), "projects" to strings(listOf("ACME, Inc", "Remove me"))))))
        val properties = draft.payload(refreshed).getValue("properties").jsonObject
        assertEquals(JsonNull, properties.getValue("due"))
        assertEquals(JsonNull, properties.getValue("recurrence"))
        assertEquals(strings(listOf("ACME, Inc")), properties.getValue("projects"))
    }
}
