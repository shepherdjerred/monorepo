import Foundation
import Observation
import TaskNotesKit

@MainActor internal struct FacetSavedViewOperations {
    let ownsProfile: () -> Bool
    let execute: ([String: FacetValue], String, FacetMutationAdmission) async -> Bool
    let observe: () async throws -> [FacetSavedView]
    let isResolved: (String) async throws -> Bool
}

internal struct FacetSavedViewObservation {
    let views: [FacetSavedView]
}

/// Admission happens synchronously; every retry keeps the original view and action IDs.
@Observable @MainActor internal final class FacetSavedViewDraft {
    private(set) var isSubmitting = false
    private(set) var admittedMutationID: String?
    private(set) var needsObservation = false
    private(set) var error: String?
    private var submission: (id: String, command: [String: FacetValue])?
    @ObservationIgnored private var operations: FacetSavedViewOperations?

    var hasRetainedSubmission: Bool { submission != nil }

    func begin(_ command: [String: FacetValue], operations: FacetSavedViewOperations) -> Bool {
        guard !isSubmitting, submission == nil, operations.ownsProfile() else { return false }
        submission = (UUID().uuidString, command)
        self.operations = operations
        isSubmitting = true
        error = nil
        return true
    }

    func beginRetry() -> Bool {
        guard !isSubmitting, submission != nil else { return false }
        isSubmitting = true
        return true
    }

    func submit() async -> FacetSavedViewObservation? {
        guard isSubmitting, let submission, let operations else { return nil }
        defer { isSubmitting = false }
        guard operations.ownsProfile() else {
            error = "Return to this action’s original vault before checking its result."
            return nil
        }
        if !needsObservation {
            let admission = FacetMutationAdmission()
            guard await operations.execute(submission.command, submission.id, admission) else {
                admittedMutationID = admission.mutationID ?? admittedMutationID
                if admittedMutationID == nil { self.submission = nil }
                error =
                    admittedMutationID == nil
                    ? "The view was not submitted. Check the error and try again."
                    : "This saved-view action is retained. "
                        + "Retry its original request or resolve it below before editing."
                return nil
            }
            admittedMutationID = admission.mutationID
            needsObservation = true
        }
        do {
            let views = try await operations.observe()
            guard operations.ownsProfile() else { throw FacetContractError.unsupportedResponse }
            clear()
            return FacetSavedViewObservation(views: views)
        } catch {
            self.error =
                "The view change was saved, but its result could not be loaded. "
                + "Retry to observe it without submitting it again."
            return nil
        }
    }

    func releaseResolved() async -> Bool {
        guard !isSubmitting, let submission, let operations else { return false }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            guard operations.ownsProfile(), try await operations.isResolved(submission.id),
                operations.ownsProfile()
            else { return false }
            clear()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    private func clear() {
        submission = nil
        admittedMutationID = nil
        needsObservation = false
        error = nil
    }
}

extension FacetStore {
    internal func savedViewOperations(profileID: String, window: FacetWindowState?)
        -> FacetSavedViewOperations?
    {
        guard let engine, selectedProfileID == profileID else { return nil }
        let ownsProfile = { self.engine === engine && self.selectedProfileID == profileID }
        return FacetSavedViewOperations(
            ownsProfile: ownsProfile,
            execute: { command, id, admission in
                guard ownsProfile() else { return false }
                return await self.execute(
                    command, mutationID: id, profileID: profileID, admission: admission)
            },
            observe: {
                if let window { await window.reload(store: self) }
                guard ownsProfile() else { throw FacetContractError.unsupportedResponse }
                // Read independently: a failed reload must not turn an old snapshot into success.
                let page = try await self.readWindowSnapshot(
                    profileID: profileID,
                    query: .object([
                        "schemaVersion": .integer(1), "scope": .string("all"), "limit": .integer(1),
                    ]))
                guard let page, page.profileId == profileID else {
                    throw FacetContractError.unsupportedResponse
                }
                return page.views
            },
            isResolved: { id in
                var cursor: String?
                while true {
                    let page = try await engine.pendingMutations(
                        profileID: profileID, afterID: cursor)
                    guard ownsProfile() else { return false }
                    if page.contains(where: { $0.id == id }) { return false }
                    guard page.count == 128, let last = page.last else { return true }
                    cursor = last.id
                }
            })
    }
}
