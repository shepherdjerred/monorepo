import Foundation
import Observation
import TaskNotesKit

internal enum FacetBulkAction {
    case complete
    case update(String, FacetValue)
    case delete
}

internal enum FacetBulkError: LocalizedError {
    case empty, separateOccurrences, missingOccurrence, conflictingRevisions

    var errorDescription: String? {
        switch self {
        case .empty: "Select tasks before applying a bulk action."
        case .separateOccurrences:
            "Complete these occurrences separately. A bulk action can change each note only once."
        case .missingOccurrence: "Choose recurring occurrences in Agenda before completing them."
        case .conflictingRevisions:
            "Selected rows have different revisions of the same note. Refresh and review your selection."
        }
    }
}

/// The native batch contract permits one command per file. Note edits deduplicate only
/// identical reviewed revisions; occurrence completion never silently collapses rows.
internal func facetBulkCommand(_ tasks: [FacetTask], action: FacetBulkAction) throws
    -> [String: FacetValue]
{
    guard !tasks.isEmpty else { throw FacetBulkError.empty }
    var selected: [FacetTask] = []
    var revisions: [String: String] = [:]
    for task in tasks {
        if let revision = revisions[task.path] {
            if case .complete = action { throw FacetBulkError.separateOccurrences }
            guard revision == task.revision else { throw FacetBulkError.conflictingRevisions }
        } else {
            revisions[task.path] = task.revision
            selected.append(task)
        }
    }
    let commands = try selected.map { task -> FacetValue in
        var command: [String: FacetValue] = [
            "path": .string(task.path), "expectedRevision": .string(task.revision),
        ]
        switch action {
        case .complete:
            guard !task.isRecurring || task.occurrenceDate != nil else {
                throw FacetBulkError.missingOccurrence
            }
            command["kind"] = .string("set_completion")
            command["completed"] = .bool(true)
            if let day = task.occurrenceDate { command["occurrenceDate"] = .string(day) }
        case .update(let role, let value):
            command["kind"] = .string("update")
            command["properties"] = .object([role: value])
        case .delete:
            command["kind"] = .string("delete_checked")
            command["checkBacklinks"] = .bool(true)
            command["force"] = .bool(false)
        }
        return .object(command)
    }
    return ["kind": .string("batch"), "commands": .array(commands)]
}

@MainActor internal struct FacetBulkOperations {
    let ownsProfile: () -> Bool
    let execute: ([String: FacetValue], String, FacetMutationAdmission) async -> Bool
    let isResolved: (String) async throws -> Bool
}

@Observable @MainActor internal final class FacetBulkDraft {
    private(set) var isSubmitting = false
    private(set) var admittedMutationID: String?
    private(set) var error: String?
    @ObservationIgnored private var submission: (id: String, command: [String: FacetValue])?
    @ObservationIgnored private var operations: FacetBulkOperations?
    @ObservationIgnored private var executing = false

    var hasRetainedSubmission: Bool { submission != nil }

    func cancelBeforeDispatch() {
        guard !executing, admittedMutationID == nil else { return }
        clear()
        isSubmitting = false
    }

    func begin(_ tasks: [FacetTask], action: FacetBulkAction, operations: FacetBulkOperations)
        -> Bool
    {
        guard !isSubmitting, submission == nil, operations.ownsProfile() else { return false }
        do {
            let command = try facetBulkCommand(tasks, action: action)
            submission = (UUID().uuidString, command)
            self.operations = operations
            isSubmitting = true
            error = nil
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func beginRetry() -> Bool {
        guard !isSubmitting, submission != nil else { return false }
        isSubmitting = true
        return true
    }

    func submit() async -> Bool {
        guard isSubmitting, !executing, let submission, let operations else { return false }
        executing = true
        defer {
            executing = false
            isSubmitting = false
        }
        guard operations.ownsProfile() else {
            if admittedMutationID == nil { self.submission = nil }
            error = "Return to the original vault to check this bulk action."
            return false
        }
        let admission = FacetMutationAdmission()
        if await operations.execute(submission.command, submission.id, admission) {
            clear()
            return true
        }
        admittedMutationID = admission.mutationID ?? admittedMutationID
        if admittedMutationID == nil { self.submission = nil }
        error =
            admittedMutationID == nil
            ? "The action was not submitted. Your selection is retained; check the error and try again."
            : "This exact bulk action is retained. Retry it or resolve it in Saved actions before changing it."
        return false
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
        error = nil
    }
}

extension FacetStore {
    internal func bulkOperations(profileID: String) -> FacetBulkOperations? {
        guard let engine, selectedProfileID == profileID else { return nil }
        let ownsProfile = {
            self.engine === engine && self.selectedProfileID == profileID
                && !self.removingProfileIDs.contains(profileID)
        }
        return FacetBulkOperations(
            ownsProfile: ownsProfile,
            execute: { command, id, admission in
                await self.actionCoordinator.submit {
                    guard ownsProfile() else { return false }
                    return await self.executeDirect(
                        command, mutationID: id, profileID: profileID, engine: engine,
                        admission: admission)
                }
            },
            isResolved: { id in
                var cursor: String?
                while true {
                    let page = try await engine.pendingMutations(
                        profileID: profileID, afterID: cursor)
                    guard ownsProfile() else { return false }
                    if page.contains(where: { $0.id == id }) { return false }
                    guard page.count == 128, let last = page.last else { return true }
                    guard last.id != cursor else { throw FacetContractError.unsupportedResponse }
                    cursor = last.id
                }
            })
    }
}
