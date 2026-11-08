import TaskNotesKit

@MainActor
internal struct FacetUndoOperations {
    let pending: () async throws -> FacetPendingMutation?
    let available: () async throws -> FacetValue
    let resume: (FacetPendingMutation) async -> Void
    let perform: ([String: FacetValue]) async -> Void
    let ownsEngine: () -> Bool
}

extension FacetStore {
    internal func undoWithOperations(profileID: String, operations: FacetUndoOperations) async {
        guard !isSaving else { return }
        let current = presentationOwner(profileID: profileID, ownsEngine: operations.ownsEngine)
        guard current() else { return }
        clearSavedNotice()
        do {
            let pending = try await operations.pending()
            guard current() else { return }
            if let pending {
                guard pending.profileID == profileID else {
                    throw FacetContractError.unsupportedResponse
                }
                await operations.resume(pending)
                return
            }
            let value = try await operations.available()
            guard current() else { return }
            let available = try FacetFeatureProjection.decode(FacetUndoAvailable.self, from: value)
            guard available.canUndo, let receiptID = available.receiptId else { return }
            await operations.perform(["kind": .string("undo"), "receiptId": .string(receiptID)])
        } catch { if current() { reportNativeFailure(error) } }
    }
}
