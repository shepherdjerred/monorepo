package red.sjer.facet

internal enum class FacetFeedbackKind(val message: String) { SAVED("Saved"), CREATED("Task added"), COMPLETED("Task completed"), REOPENED("Task reopened"), DELETED("Task deleted"), UNDONE("Change undone") }
internal data class FacetSavedFeedback(val sequence: Long, val profileId: String, val mutationId: String, val undoReceiptId: String?, val kind: FacetFeedbackKind = FacetFeedbackKind.SAVED)
internal data class FacetFeedbackPreferences(val haptics: Boolean = true, val sound: Boolean = true)
/** Owned by the ViewModel, so recreating a composition cannot replay an observed receipt. */
internal class FacetFeedbackCoordinator {
    private var sequence = 0L
    private var consumed = 0L
    private var latest: FacetSavedFeedback? = null
    fun publish(profileId: String, mutationId: String, undoReceiptId: String?, kind: FacetFeedbackKind = FacetFeedbackKind.SAVED): FacetSavedFeedback {
        val event = FacetSavedFeedback(++sequence, profileId, mutationId, undoReceiptId, kind)
        latest = event
        return event
    }
    fun consume(selectedProfileId: String?): FacetSavedFeedback? {
        val event = latest ?: return null
        if (event.sequence <= consumed) return null
        consumed = event.sequence
        return event.takeIf { it.profileId == selectedProfileId }
    }
    fun mayUndo(event: FacetSavedFeedback, selectedProfileId: String?, authoritativeHead: String?) =
        event.profileId == selectedProfileId && event.undoReceiptId != null && event.undoReceiptId == authoritativeHead
}
