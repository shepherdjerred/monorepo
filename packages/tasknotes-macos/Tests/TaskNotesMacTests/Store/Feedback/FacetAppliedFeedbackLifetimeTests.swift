import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite @MainActor struct FacetAppliedFeedbackLifetimeTests {
    @Test func clearingCurrentFeedbackPreservesSavedWarningAndError() {
        let store = FacetStore()
        let feedback = feedback()
        store.appliedFeedback = feedback
        store.savedNotice = receipt().savedMessage
        store.error = "Maintenance needs attention."

        store.clearAppliedFeedback(ifMatching: feedback)

        #expect(store.appliedFeedback == nil)
        #expect(store.savedNotice == FacetMutationReceipt.Diagnostic.templateMissing.message)
        #expect(store.error == "Maintenance needs attention.")
    }

    @Test func staleFeedbackCannotClearReplacementWithTheSameMutationIdentity() {
        let store = FacetStore()
        let stale = feedback()
        let replacement = feedback()
        #expect(stale.profileID == replacement.profileID)
        #expect(stale.mutationID == replacement.mutationID)
        #expect(stale != replacement)
        store.appliedFeedback = replacement
        store.savedNotice = receipt().savedMessage

        store.clearAppliedFeedback(ifMatching: stale)

        #expect(store.appliedFeedback == replacement)
        #expect(store.savedNotice == FacetMutationReceipt.Diagnostic.templateMissing.message)
    }

    @Test func explicitSavedNoticeAcknowledgementStillClearsWarningAndFeedback() {
        let store = FacetStore()
        store.appliedFeedback = feedback()
        store.savedNotice = receipt().savedMessage
        store.error = "Maintenance needs attention."

        store.clearSavedNotice()

        #expect(store.savedNotice == nil)
        #expect(store.appliedFeedback == nil)
        #expect(store.error == "Maintenance needs attention.")
    }

    private func feedback() -> FacetAppliedFeedback {
        FacetAppliedFeedback(
            event: FacetFeedbackEvent(
                sessionID: UUID(), profileID: "A", receipt: receipt(),
                command: ["kind": .string("set_completion"), "completed": .bool(true)],
                origin: nil))
    }

    private func receipt() -> FacetMutationReceipt {
        FacetMutationReceipt(
            mutationId: "completion", applied: true, taskPath: "Tasks/Recurring.md",
            cleanupPending: false, paths: ["Tasks/Recurring.md"], diagnostics: [.templateMissing])
    }
}
