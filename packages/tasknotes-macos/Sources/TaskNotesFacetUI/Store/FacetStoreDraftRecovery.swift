import TaskNotesKit

internal struct FacetDraftRecoveryObservation {
    let pending: FacetPendingMutation?
}

extension FacetStore {
    internal func observeDraftRecovery(
        profileID: String, mutationID: String,
        expectedEngine: FacetEngine?
    ) async throws -> FacetDraftRecoveryObservation {
        guard let expectedEngine, engine === expectedEngine, selectedProfileID == profileID else {
            throw FacetDraftError.changedOperation
        }
        var cursor: String?
        while true {
            let page = try await expectedEngine.pendingMutations(
                profileID: profileID, afterID: cursor)
            guard engine === expectedEngine, selectedProfileID == profileID else {
                throw FacetDraftError.changedOperation
            }
            if let pending = page.first(where: { $0.id == mutationID }) {
                return FacetDraftRecoveryObservation(pending: pending)
            }
            guard page.count == 128, let last = page.last else {
                return FacetDraftRecoveryObservation(pending: nil)
            }
            cursor = last.id
        }
    }
}
