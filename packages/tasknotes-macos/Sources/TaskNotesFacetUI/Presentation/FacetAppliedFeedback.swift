import Foundation
import SwiftUI
import TaskNotesKit

internal struct FacetAppliedFeedback: Hashable {
    let profileID: String
    let mutationID: String
}

internal struct FacetAppliedFeedbackView: View {
    let store: FacetStore
    let profileID: String
    @State private var available: FacetAppliedFeedback?
    @State private var isUndoing = false
    var body: some View {
        Group {
            if let feedback = store.appliedFeedback, feedback.profileID == profileID {
                HStack {
                    Label("Saved", systemImage: "checkmark.circle.fill")
                    Spacer()
                    if available == feedback {
                        Button("Undo") { undo(feedback) }.disabled(isUndoing)
                    }
                    Button("Dismiss", systemImage: "xmark") { store.clearSavedNotice() }
                        .labelStyle(.iconOnly)
                }.padding().background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
                    .padding(.horizontal)
            }
        }
        .task(id: store.appliedFeedback) {
            available = nil
            guard let feedback = store.appliedFeedback, feedback.profileID == profileID,
                let value = await store.readFeature(
                    ["kind": .string("undo_available")], profileID: profileID)
            else { return }
            do {
                let result = try FacetFeatureProjection.decode(FacetUndoAvailable.self, from: value)
                if result.canUndo, result.receiptId == feedback.mutationID,
                    store.appliedFeedback == feedback
                {
                    available = feedback
                }
            } catch { store.reportNativeFailure(error) }
        }
    }

    private func undo(_ feedback: FacetAppliedFeedback) {
        guard !isUndoing, available == feedback, store.appliedFeedback == feedback else { return }
        isUndoing = true
        _Concurrency.Task {
            _ = await store.perform(
                ["kind": .string("undo"), "receiptId": .string(feedback.mutationID)],
                profileID: profileID)
            isUndoing = false
        }
    }
}
