package red.sjer.facet

import kotlinx.serialization.json.*

internal enum class FacetFeedbackKind(val message: String) { SAVED("Saved"), CREATED("Task added"), COMPLETED("Task completed"), REOPENED("Task reopened"), DELETED("Task deleted"), UNDONE("Change undone") }
internal fun feedbackKind(command: JsonObject): FacetFeedbackKind = when (command.getValue("kind").jsonPrimitive.content) {
    "create" -> FacetFeedbackKind.CREATED
    "delete" -> FacetFeedbackKind.DELETED
    "set_completion" -> if (command.getValue("completed").jsonPrimitive.boolean) FacetFeedbackKind.COMPLETED else FacetFeedbackKind.REOPENED
    "undo" -> FacetFeedbackKind.UNDONE
    "batch" -> command.getValue("commands").jsonArray.map { feedbackKind(it.jsonObject) }.distinct().singleOrNull() ?: FacetFeedbackKind.SAVED
    else -> FacetFeedbackKind.SAVED
}
internal data class FacetSavedFeedback(val sequence: Long, val profileId: String, val mutationId: String, val undoReceiptId: String?, val kind: FacetFeedbackKind = FacetFeedbackKind.SAVED, val engineGeneration: Long = 1, val foregroundGeneration: Long = 0, val noticeReady: Boolean = true)
internal data class FacetCompletionPresentation(val profileId: String, val mutationId: String, val task: red.sjer.facet.host.VaultTask, val completed: Boolean, val foregroundGeneration: Long, val engineGeneration: Long)
/** Physical cues are consumed during an existing cue, rather than queued or replayed later. */
internal class FacetAudioGate {
    private var until = 0L
    fun claim(now: Long, milliseconds: Long): Boolean {
        require(now >= 0 && milliseconds > 0)
        if (now < until) return false
        until = now + milliseconds
        return true
    }
}
internal data class FacetFeedbackPreferences(val haptics: Boolean = true, val sound: Boolean = true) {
    companion object {
        fun read(values: Map<String, *>): FacetFeedbackPreferences {
            fun stored(key: String): Boolean? {
                if (!values.containsKey(key)) return null
                return values[key] as? Boolean ?: throw IllegalArgumentException("The saved feedback preference '$key' is invalid. Reset task feedback in Settings.")
            }
            val combined = stored("feedback.enabled")
            return FacetFeedbackPreferences(stored("feedback.haptics") ?: combined ?: true, stored("feedback.sound") ?: combined ?: true)
        }
    }
}
/** Owned by the ViewModel, so recreating a composition cannot replay an observed receipt. */
internal class FacetFeedbackCoordinator {
    private var sequence = 0L
    private val pending = ArrayDeque<FacetSavedFeedback>()
    private var noticeConsumed = 0L
    private var latest: FacetSavedFeedback? = null
    private val observed = mutableSetOf<Triple<Long, String, String>>()
    fun publish(profileId: String, mutationId: String, undoReceiptId: String?, kind: FacetFeedbackKind = FacetFeedbackKind.SAVED,
        engineGeneration: Long = 1, foregroundGeneration: Long = 0, eligible: Boolean = true, noticeReady: Boolean = true): FacetSavedFeedback? {
        if (!observed.add(Triple(engineGeneration, profileId, mutationId)) || !eligible) return null
        val event = FacetSavedFeedback(++sequence, profileId, mutationId, undoReceiptId, kind, engineGeneration, foregroundGeneration, noticeReady)
        latest = event
        pending.addLast(event)
        return event
    }
    fun consume(selectedProfileId: String?, foregroundGeneration: Long = 0, foreground: Boolean = true, engineGeneration: Long = 1): FacetSavedFeedback? {
        while (pending.isNotEmpty()) {
            val event = pending.removeFirst()
            if (foreground && event.engineGeneration == engineGeneration && event.profileId == selectedProfileId && event.foregroundGeneration == foregroundGeneration) return event
        }
        return null
    }
    fun authorizeNotice(event: FacetSavedFeedback, receiptId: String?): FacetSavedFeedback? {
        if (latest?.sequence != event.sequence) return null
        return event.copy(undoReceiptId = receiptId, noticeReady = true).also { latest = it }
    }
    fun consumeNotice(selectedProfileId: String?, foregroundGeneration: Long, foreground: Boolean = true, engineGeneration: Long = 1): FacetSavedFeedback? {
        val event = latest ?: return null
        if (!event.noticeReady || event.sequence <= noticeConsumed) return null
        noticeConsumed = event.sequence
        return event.takeIf { foreground && it.engineGeneration == engineGeneration && it.profileId == selectedProfileId && it.foregroundGeneration == foregroundGeneration }
    }
    fun mayUndo(event: FacetSavedFeedback?, selectedProfileId: String?, authoritativeHead: String?) =
        event != null && event.profileId == selectedProfileId && event.undoReceiptId != null && event.undoReceiptId == authoritativeHead
}
