import TaskNotesKit

extension FacetStore {
    internal func feedbackUndoAvailable(for feedback: FacetAppliedFeedback) async -> Bool {
        guard let engine else { return false }
        return await feedbackUndoAvailable(
            for: feedback, ownsEngine: { self.engine === engine },
            load: {
                try await engine.features(
                    profileID: feedback.profileID,
                    request: .object(["kind": .string("undo_available")]))
            })
    }

    internal func feedbackUndoAvailable(
        for feedback: FacetAppliedFeedback, ownsEngine: @escaping () -> Bool,
        load: () async throws -> FacetValue
    ) async -> Bool {
        // The action's own list refresh must not invalidate its receipt lookup.
        let owns = presentationOwner(
            profileID: feedback.profileID, tracksRequest: false, ownsEngine: ownsEngine)
        guard owns(), appliedFeedback == feedback else { return false }
        do {
            let value = try await load()
            guard owns(), appliedFeedback == feedback else { return false }
            let result = try FacetFeatureProjection.decode(FacetUndoAvailable.self, from: value)
            return result.canUndo && result.receiptId == feedback.mutationID
        } catch {
            if owns(), appliedFeedback == feedback { reportNativeFailure(error) }
            return false
        }
    }
}
