import Foundation
import Observation
import TaskNotesKit

@MainActor internal struct FacetInspectorOperations {
    let execute: ([String: FacetValue], String, FacetMutationAdmission) async -> Bool
    let read: (FacetValue) async throws -> FacetSnapshot?
    let reload: () async -> Void
}

/// A window keeps failed drafts and an immutable submission until it is resolved.
@Observable @MainActor
internal final class FacetInspectorDraft {
    private(set) var task: FacetTask
    let profileID: String
    var title: String
    var markdown: String
    private(set) var isSaving = false
    private(set) var error: String?
    private var submission: (id: String, command: [String: FacetValue])?
    private(set) var needsObservation = false
    private(set) var admittedMutationID: String?
    let occurrenceDate: String?
    private var waiters: [CheckedContinuation<Void, Never>] = []
    @ObservationIgnored private let operations: FacetInspectorOperations?

    init(task: FacetTask, profileID: String, operations: FacetInspectorOperations? = nil) {
        self.task = task
        self.profileID = profileID
        occurrenceDate = task.occurrenceDate
        title = task.title
        markdown = task.body
        self.operations = operations
    }
    var rowID: FacetTaskRowID { FacetTaskRowID(taskID: task.id, occurrenceDate: occurrenceDate) }

    var isDirty: Bool { title != task.title || markdown != task.body || submission != nil }

    func flush(store: FacetStore, window: FacetWindowState) async -> Bool {
        if isSaving { await withCheckedContinuation { waiters.append($0) } }
        guard isDirty else { return true }
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "Enter a task title before leaving this task."
            return false
        }
        if submission != nil, !(await retry(store: store, window: window)) { return false }
        guard await commitTitle(store: store, window: window) else { return false }
        guard await commitMarkdown(store: store, window: window) else { return false }
        return !isDirty
    }

    func commitTitle(store: FacetStore, window: FacetWindowState) async -> Bool {
        guard title != task.title else { return true }
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "Enter a task title before saving."
            return false
        }
        return await commit(
            edit(properties: ["title": .string(title)]), store: store, window: window)
    }

    func commitMarkdown(store: FacetStore, window: FacetWindowState) async -> Bool {
        guard markdown != task.body else { return true }
        var command = edit(properties: [:])
        command["body"] = .string(markdown)
        return await commit(command, store: store, window: window)
    }

    func retry(store: FacetStore, window: FacetWindowState) async -> Bool {
        guard let submission else { return await flush(store: store, window: window) }
        return await commit(submission.command, store: store, window: window, retry: true)
    }

    func setProperty(_ key: String, value: FacetValue, store: FacetStore, window: FacetWindowState)
        async -> Bool
    {
        return await commit(edit(properties: [key: value]), store: store, window: window)
    }

    func setProperties(
        _ properties: [String: FacetValue], store: FacetStore, window: FacetWindowState
    )
        async -> Bool
    {
        await commit(edit(properties: properties), store: store, window: window)
    }

    func setStatus(_ value: String, store: FacetStore, window: FacetWindowState) async -> Bool {
        var command = edit(properties: [:])
        command["status"] = .string(value)
        return await commit(command, store: store, window: window)
    }
    func setCompletion(store: FacetStore, window: FacetWindowState) async -> Bool {
        guard !isDirty else { return false }
        guard !task.isRecurring || occurrenceDate != nil else {
            error =
                "Choose an occurrence in Today or Upcoming before completing this recurring task."
            return false
        }
        var command: [String: FacetValue] = [
            "kind": .string("set_completion"), "path": .string(task.path),
            "expectedRevision": .string(task.revision), "completed": .bool(!task.completed),
        ]
        if let occurrenceDate { command["occurrenceDate"] = .string(occurrenceDate) }
        return await commit(command, store: store, window: window)
    }

    func revert() {
        guard submission == nil, !isSaving else { return }
        title = task.title
        markdown = task.body
        error = nil
    }

    private func edit(properties: [String: FacetValue]) -> [String: FacetValue] {
        var command: [String: FacetValue] = [
            "kind": .string("edit_task"), "path": .string(task.path),
            "expectedRevision": .string(task.revision), "properties": .object(properties),
        ]
        if let occurrenceDate { command["occurrenceDate"] = .string(occurrenceDate) }
        return command
    }

    private func commit(
        _ command: [String: FacetValue], store: FacetStore, window: FacetWindowState,
        retry: Bool = false
    ) async -> Bool {
        guard !isSaving else { return false }
        guard submission == nil || retry else {
            error = "Resolve the retained change with Retry before submitting another field."
            return false
        }
        isSaving = true
        defer {
            isSaving = false
            let completed = waiters
            waiters = []
            for waiter in completed { waiter.resume() }
        }
        let submitted = submission ?? (id: UUID().uuidString, command: command)
        submission = submitted
        let operation =
            operations
            ?? FacetInspectorOperations(
                execute: { command, id, admission in
                    await store.execute(
                        command, mutationID: id, profileID: self.profileID, admission: admission)
                },
                read: { query in
                    try await store.readWindowSnapshot(profileID: self.profileID, query: query)
                },
                reload: { await window.reload(store: store) })
        if !needsObservation {
            let admission = FacetMutationAdmission()
            guard
                await operation.execute(submitted.command, submitted.id, admission)
            else {
                admittedMutationID = admission.mutationID ?? admittedMutationID
                if admittedMutationID == nil { submission = nil }
                error =
                    store.error
                    ?? "The change could not be saved. Your draft is retained. Retry before leaving this task."
                return false
            }
            admittedMutationID = admission.mutationID
            needsObservation = true
        }
        return await observe(submitted, operation: operation)
    }

    private func observe(
        _ submitted: (id: String, command: [String: FacetValue]),
        operation: FacetInspectorOperations
    ) async -> Bool {
        do {
            var offset = 0
            while true {
                var fields: [String: FacetValue] = [
                    "schemaVersion": .integer(1), "scope": .string("all"),
                    "includeArchived": .bool(true), "offset": .integer(Int64(offset)),
                    "limit": .integer(100),
                ]
                if let occurrenceDate { fields["today"] = .string(occurrenceDate) }
                let query: FacetValue = .object(fields)
                guard
                    let page = try await operation.read(query)
                else {
                    throw FacetContractError.unsupportedResponse
                }
                if let refreshed = page.tasks.first(where: { $0.id == task.id }) {
                    let submittedTitle = submitted.command["properties"]?.object?.fields["title"]?
                        .text
                    let submittedMarkdown = submitted.command["body"]?.text
                    if title == (submittedTitle ?? task.title) { title = refreshed.title }
                    if markdown == (submittedMarkdown ?? task.body) { markdown = refreshed.body }
                    task = refreshed
                    submission = nil
                    needsObservation = false
                    admittedMutationID = nil
                    error = nil
                    await operation.reload()
                    return true
                }
                offset += page.tasks.count
                guard offset < page.totalCount, !page.tasks.isEmpty else {
                    throw FacetContractError.unsupportedResponse
                }
            }
        } catch {
            self.error =
                "The change was saved, but its current revision could not be loaded. "
                + "Retry to confirm the saved result before editing again."
            return false
        }
    }
}
