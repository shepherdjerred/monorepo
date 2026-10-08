import Foundation
public import TaskNotesKit

extension FacetStore {
    internal func exportConflict(
        profileID: String, conflict: FacetConflict, version: FacetConflictVersion
    ) async -> URL? {
        guard let engine, let metadata = conflict.metadata(version: version) else { return nil }
        let current = conflictPresentationFence(profileID: profileID) { self.engine === engine }
        guard current() else { return nil }
        do {
            let result = try await engine.exportConflict(
                profileID: profileID, id: conflict.id, version: version.rawValue, metadata: metadata
            )
            guard current() else { return nil }
            if let cleanup = result.cleanupDiagnostic { error = cleanup.action }
            return result.url
        } catch {
            if current() { reportNativeFailure(error) }
            return nil
        }
    }

    internal func submitConflictDecision(_ decision: FacetConflictDecision) async -> Bool {
        await runConflictDecision(mutationID: decision.id) {
            await self.applyConflictDecision(decision)
        }
    }

    internal func runConflictDecision(mutationID: String, operation: () async -> Bool) async -> Bool
    {
        guard !isSaving, activeMutationID == nil else { return false }
        isSaving = true
        activeMutationID = mutationID
        defer {
            isSaving = false
            activeMutationID = nil
        }
        return await operation()
    }

    private func applyConflictDecision(_ decision: FacetConflictDecision) async -> Bool {
        guard let engine else { return false }
        let lifecycle = syncGeneration
        let current = conflictPresentationFence(profileID: decision.profileID) {
            self.engine === engine
        }
        let command = FacetValue.object(
            conflictCommand(decision.conflict, resolution: decision.resolution))
        do {
            let id =
                try await engine.savedMutationID(profileID: decision.profileID, command: command)
                ?? decision.id
            guard self.engine === engine, lifecycle == syncGeneration,
                !removingProfileIDs.contains(decision.profileID)
            else { return false }
            let receipt: FacetMutationReceipt
            if !decision.replacesText {
                receipt = try await engine.execute(
                    profileID: decision.profileID, command: command, mutationID: id)
            } else {
                receipt = try await engine.executePayload(
                    profileID: decision.profileID, command: command, mutationID: id,
                    payload: decision.payload)
            }
            activeMutationID = id
            var notice = receipt.savedMessage
            var maintenanceError: String?
            do { try await engine.discardObservedMutation(id: id) } catch {
                let issue = savedMaintenanceIssue(
                    error, maintenance: "The resolution was saved, but cleanup could not finish.")
                notice = [notice, issue.notice].compactMap { $0 }.joined(separator: "\n")
                maintenanceError = issue.error
            }
            guard current() else { return true }
            savedNotice = notice
            if let maintenanceError { error = maintenanceError }
            conflicts.removeAll { $0.id == decision.conflict.id }
            await reloadQuery(preservingSavedNotice: true)
            return true
        } catch {
            if current() { reportNativeFailure(error) }
            return false
        }
    }

    public func loadConflicts() async {
        guard let engine, let profileID = selectedProfileID else { return }
        let current = conflictPresentationFence(profileID: profileID) { self.engine === engine }
        do {
            let page = try await engine.conflictPage(profileID: profileID, afterID: nil)
            guard current() else { return }
            conflicts = page.conflicts
            conflictCursor = page.nextCursor
            showsConflicts = true
        } catch {
            if current() { reportNativeFailure(error) }
        }
    }

    public func loadMoreConflicts(profileID: String) async {
        guard let engine, let conflictCursor else { return }
        let current = conflictPresentationFence(profileID: profileID) { self.engine === engine }
        guard current() else { return }
        do {
            let page = try await engine.conflictPage(profileID: profileID, afterID: conflictCursor)
            guard self.conflictCursor == conflictCursor, current() else { return }
            conflicts += page.conflicts
            self.conflictCursor = page.nextCursor
        } catch {
            if current() { reportNativeFailure(error) }
        }
    }

    internal func conflictPreview(
        profileID: String, conflict: FacetConflict, version: FacetConflictVersion
    ) async
        -> String?
    {
        let metadata = conflict.metadata(version: version)
        guard let metadata else { return "Deleted" }
        guard metadata.size <= FacetRetainedText.maximumBytes else {
            return
                "This version contains \(metadata.size) bytes. Its full contents remain retained in the conflict inbox."
        }
        guard let engine else { return nil }
        return await loadConflictPresentation(
            profileID: profileID, ownsEngine: { self.engine === engine },
            load: {
                try await engine.conflictText(
                    profileID: profileID, id: conflict.id, version: version.rawValue,
                    metadata: metadata
                )
            },
            present: { result in
                if let cleanup = result.cleanupDiagnostic { self.error = cleanup.action }
            })?.text
    }

    internal func conflictPresentationFence(
        profileID: String, ownsEngine: @escaping () -> Bool
    ) -> () -> Bool {
        let request = requestGeneration
        let lifecycle = syncGeneration
        return {
            request == self.requestGeneration && lifecycle == self.syncGeneration
                && self.selectedProfileID == profileID
                && !self.removingProfileIDs.contains(profileID) && ownsEngine()
        }
    }

    internal func loadConflictPresentation<Value>(
        profileID: String, ownsEngine: @escaping () -> Bool,
        load: () async throws -> Value, present: (Value) -> Void
    ) async -> Value? {
        let current = conflictPresentationFence(profileID: profileID, ownsEngine: ownsEngine)
        guard current() else { return nil }
        do {
            let result = try await load()
            guard current() else { return nil }
            present(result)
            return result
        } catch {
            if current() { reportNativeFailure(error) }
            return nil
        }
    }

    public func resolveConflict(
        conflict: FacetConflict, resolution: FacetValue, mutationID: String, profileID: String
    ) async -> Bool {
        await submitConflictDecision(
            FacetConflictDecision(
                profileID: profileID, conflict: conflict, resolution: resolution, id: mutationID))
    }

    internal func conflictCommand(_ conflict: FacetConflict, resolution: FacetValue)
        -> [String: FacetValue]
    {
        let revisions = FacetValue.object([
            "base": conflict.base.map { .string($0.revision) } ?? .null,
            "local": conflict.local.map { .string($0.revision) } ?? .null,
            "remote": conflict.remote.map { .string($0.revision) } ?? .null,
            "current": conflict.currentRevision.map { .string($0) } ?? .null,
        ])
        return [
            "kind": .string("resolve_conflict"), "conflictId": .string(conflict.id),
            "expectedRevisions": revisions, "resolution": resolution,
        ]
    }
}
