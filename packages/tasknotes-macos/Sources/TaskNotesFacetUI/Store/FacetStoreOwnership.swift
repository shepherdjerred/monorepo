import Foundation
import TaskNotesKit

extension FacetStore {
    internal func presentationOwner(
        profileID: String, tracksRequest: Bool = true, ownsEngine: @escaping () -> Bool
    ) -> () -> Bool {
        let request = requestGeneration
        let lifecycle = syncGeneration
        let selection = selectionGeneration
        return { [weak self] in
            guard let self else { return false }
            return self.selectedProfileID == profileID
                && (!tracksRequest || self.requestGeneration == request)
                && self.selectionGeneration == selection && self.syncGeneration == lifecycle
                && !self.removingProfileIDs.contains(profileID) && ownsEngine()
        }
    }

    internal func runSavedAction(
        action: (mutationID: String, profileID: String), ownsEngine: @escaping () -> Bool,
        apply: () async throws -> FacetMutationReceipt,
        cleanup: () async throws -> Void, reload: () async -> Void,
        verified: ((FacetMutationReceipt, Bool) -> Void)? = nil
    ) async -> Bool {
        let (mutationID, profileID) = action
        guard activeMutationID == nil else {
            error = "Wait for the current action to finish before submitting another change."
            return false
        }
        let ownsPresentation = presentationOwner(profileID: profileID, ownsEngine: ownsEngine)
        let ownsAction = presentationOwner(
            profileID: profileID, tracksRequest: false, ownsEngine: ownsEngine)
        activeMutationID = mutationID
        isSaving = true
        defer {
            activeMutationID = nil
            isSaving = false
        }
        do {
            let receipt = try await apply()
            guard receipt.applied, receipt.mutationId == mutationID else {
                throw FacetContractError.unsupportedResponse
            }
            verified?(receipt, ownsAction())
            var notice = receipt.savedMessage
            var maintenanceError: String?
            do { try await cleanup() } catch {
                let issue = savedMaintenanceIssue(
                    error, maintenance: "The task was saved, but cleanup could not finish.")
                notice = [notice, issue.notice].compactMap { $0 }.joined(separator: "\n")
                maintenanceError = issue.error
            }
            if ownsPresentation() {
                savedNotice = notice
                if let maintenanceError { error = maintenanceError }
                await reload()
            }
            return true
        } catch {
            if ownsPresentation() { self.error = error.localizedDescription }
            return false
        }
    }

    internal func savedMaintenanceIssue(
        _ failure: any Error, maintenance: String
    ) -> (notice: String, error: String?) {
        let diagnostic = FacetFailureDiagnostic(failure)
        if diagnostic.classification == "storage" {
            return (maintenance + " Check available storage.", nil)
        }
        if diagnostic.classification == "provider" {
            return (maintenance + " Restore folder access.", nil)
        }
        return ("The task was saved.", diagnostic.action)
    }

    internal func refreshSavedActions(
        ownsPresentation: () -> Bool, load: () async throws -> [FacetPendingMutation]
    ) async {
        do {
            let pending = try await load()
            if ownsPresentation() { pendingActions = pending }
        } catch {
            guard ownsPresentation() else { return }
            let issue = savedMaintenanceIssue(
                error, maintenance: "The task was saved, but saved actions could not refresh.")
            savedNotice = [savedNotice, issue.notice].compactMap { $0 }.joined(separator: "\n")
            if let failure = issue.error { self.error = failure }
        }
    }
}
