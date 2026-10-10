import Foundation
import TaskNotesKit

@MainActor
internal struct FacetProfileRemovalOperations {
    let stop: () async -> Void
    let removeDomain: () async throws -> FacetFailureDiagnostic?
    let detach: () async throws -> Void
    let retire: () async -> Void
    let reload: () async throws -> [FacetProfile]
    let ownsEngine: () -> Bool
    let reconcile: () async -> Void
}

extension FacetStore {
    internal func removeProfileWithOperations(
        profileID: String, operations: FacetProfileRemovalOperations
    ) async {
        guard !removingProfileIDs.contains(profileID) else { return }
        requestGeneration += 1
        syncGeneration += 1
        removingProfileIDs.insert(profileID)
        await operations.stop()
        do {
            let diagnostic = try await operations.removeDomain()
            await completeProfileRemoval(
                profileID: profileID, operations: operations, diagnostic: diagnostic)
        } catch {
            let diagnostic = FacetFailureDiagnostic(error)
            self.error =
                diagnostic.classification == "conflict"
                ? "Resolve this profile's pending uploads and conflicts before removing it. "
                    + "Its permissions and credentials are retained."
                : diagnostic.action
        }
        removingProfileIDs.remove(profileID)
        await operations.reconcile()
    }

    private func completeProfileRemoval(
        profileID: String, operations: FacetProfileRemovalOperations,
        diagnostic: FacetFailureDiagnostic?
    ) async {
        var warning = diagnostic
        do { try await operations.detach() } catch {
            if warning == nil { warning = FacetFailureDiagnostic(error) }
        }
        await operations.retire()
        do {
            let profiles = try await operations.reload()
            if operations.ownsEngine() {
                self.profiles = profiles
                if selectedProfileID == profileID {
                    selectedProfileID = profiles.first?.id
                    snapshot = nil
                    await refresh()
                }
            }
        } catch { if warning == nil { warning = FacetFailureDiagnostic(error) } }
        if let warning {
            error = "The profile was removed, but private cleanup is pending. " + warning.action
        }
    }
}
