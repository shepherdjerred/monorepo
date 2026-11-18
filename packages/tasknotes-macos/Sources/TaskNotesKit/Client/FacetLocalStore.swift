public import Foundation
public import Observation

/// Local observable store for tasks, projects, sections, labels, reminders, and filters
/// backed by `FacetSQLiteDatabase` and `/api/v1/sync`.
@Observable
@MainActor
public final class FacetLocalStore {
    public var tasks: [Task] = []
    public var projects: [Project] = []
    public var sections: [Section] = []
    public var labels: [Label] = []
    public var reminders: [Reminder] = []
    public var filters: [Filter] = []
    public var syncToken: String?
    public var outbox: [QueuedCommand] = []
    public var isSyncing: Bool = false
    public var lastError: String?
    public var lastSyncedAt: Date?
    public var lastTempIdMapping: [String: String] = [:]
    public internal(set) var undoStack: [FacetUndoEntry] = []

    @ObservationIgnored public let database: FacetSQLiteDatabase?
    @ObservationIgnored private var persistenceRevision: UInt64 = 0
    @ObservationIgnored private var pendingPersistenceTask: _Concurrency.Task<Void, Never>?

    public init(
        tasks: [Task] = [],
        projects: [Project] = [],
        sections: [Section] = [],
        labels: [Label] = [],
        reminders: [Reminder] = [],
        filters: [Filter] = [],
        syncToken: String? = nil,
        outbox: [QueuedCommand] = [],
        database: FacetSQLiteDatabase? = nil
    ) {
        self.tasks = tasks
        self.projects = projects
        self.sections = sections
        self.labels = labels
        self.reminders = reminders
        self.filters = filters
        self.syncToken = syncToken
        self.outbox = outbox
        self.database = database
    }

    public var inboxProject: Project? {
        projects.first(where: { !$0.is_deleted && $0.is_inbox })
    }

    public var canUndo: Bool {
        !undoStack.isEmpty
    }

    public var latestUndoEntry: FacetUndoEntry? {
        undoStack.last
    }

    // MARK: - Persistence Lifecycle

    public func load() async throws {
        guard let database else { return }
        let persisted = try await database.loadState()
        tasks = persisted.tasks
        projects = persisted.projects
        sections = persisted.sections
        labels = persisted.labels
        reminders = persisted.reminders
        filters = persisted.filters
        outbox = persisted.outbox
        syncToken = persisted.syncToken
    }

    public func flushPersistence() async throws {
        if let pending = pendingPersistenceTask {
            await pending.value
        }
        guard let database else { return }
        persistenceRevision &+= 1
        let revision = persistenceRevision
        let snapshot = currentPersistedState()
        try await database.saveIfNewest(revision: revision, state: snapshot)
    }

    internal func currentPersistedState() -> FacetPersistedState {
        FacetPersistedState(
            tasks: tasks,
            projects: projects,
            sections: sections,
            labels: labels,
            reminders: reminders,
            filters: filters,
            outbox: outbox,
            syncToken: syncToken
        )
    }

    internal func schedulePersistence() {
        guard let database else { return }
        persistenceRevision &+= 1
        let revision = persistenceRevision
        let snapshot = currentPersistedState()
        let previous = pendingPersistenceTask
        pendingPersistenceTask = _Concurrency.Task { @MainActor [weak self] in
            if let previous {
                await previous.value
            }
            do {
                try await database.saveIfNewest(revision: revision, state: snapshot)
            } catch {
                self?.lastError = error.localizedDescription
            }
        }
    }

    // MARK: - Task Mutations

    @discardableResult
    public func addTask(
        title: String,
        projectId: String,
        priority: Priority = .p4
    ) -> Task {
        addTask(FacetTaskDraft(title: title, projectId: projectId, priority: priority))
    }

    @discardableResult
    public func addTask(_ draft: FacetTaskDraft, recordUndo: Bool = true) -> Task {
        let tempId = "tmp-\(UUID().uuidString.lowercased())"
        let now = Self.nowTimestamp()
        let resolvedProjectId =
            draft.projectId.isEmpty ? (inboxProject?.id ?? "") : draft.projectId
        let order = draft.childOrder ?? nextTaskOrder(projectId: resolvedProjectId)
        let created = Self.buildLocalTask(
            tempId: tempId,
            projectId: resolvedProjectId,
            order: order,
            draft: draft,
            now: now
        )
        tasks.append(created)
        let wireArgs = Self.buildTaskAddArgs(
            projectId: resolvedProjectId,
            order: order,
            draft: draft
        )
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: tempId, command: .taskAdd(wireArgs))
        )
        if recordUndo {
            pushUndo(
                FacetUndoEntry(
                    summary: "Added \"\(draft.title)\"",
                    action: .deleteCreatedTask(taskId: tempId)
                )
            )
        }
        schedulePersistence()
        return created
    }

    public func updateTask(id: String, patch: FacetTaskPatch, recordUndo: Bool = true) {
        let now = Self.nowTimestamp()
        if let index = tasks.firstIndex(where: { $0.id == id }) {
            let previous = tasks[index]
            let updated = previous.applying(patch: patch, updatedAt: now)
            tasks[index] = updated
            if recordUndo {
                pushUndo(
                    FacetUndoEntry(
                        summary: "Updated \"\(updated.title)\"",
                        action: .restoreTaskSnapshot(previous: previous, wasEndedRecurring: false)
                    )
                )
            }
        }
        let args = patch.makeWireArgs(id: id)
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: nil, command: .taskUpdate(args))
        )
        schedulePersistence()
    }

    public func completeTask(id: String, at completionDate: Date = .now, recordUndo: Bool = true) {
        let now = ISO8601DateFormatter().string(from: completionDate)
        if let index = tasks.firstIndex(where: { $0.id == id }) {
            let existing = tasks[index]
            let outcome = Self.completedState(for: existing, at: completionDate, nowISO: now)
            tasks[index] = outcome.updatedTask
            if recordUndo {
                let undoAction: FacetUndoEntry.Action =
                    existing.is_recurring
                    ? .restoreTaskSnapshot(previous: existing, wasEndedRecurring: outcome.ended)
                    : .uncompleteTask(taskId: id)
                pushUndo(
                    FacetUndoEntry(
                        summary: outcome.advanced
                            ? "Scheduled next occurrence of \"\(existing.title)\""
                            : "Completed \"\(existing.title)\"",
                        action: undoAction
                    )
                )
            }
        }
        let args = TaskCompleteArgs(id: id, completed_at: now)
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: nil, command: .taskComplete(args))
        )
        schedulePersistence()
    }

    public func uncompleteTask(id: String, recordUndo: Bool = true) {
        let now = Self.nowTimestamp()
        if let index = tasks.firstIndex(where: { $0.id == id }) {
            let title = tasks[index].title
            tasks[index] = tasks[index].setting(completed: false, completedAt: nil, updatedAt: now)
            if recordUndo {
                pushUndo(
                    FacetUndoEntry(
                        summary: "Reopened \"\(title)\"",
                        action: .completeTask(taskId: id)
                    )
                )
            }
        }
        let args = TaskUncompleteArgs(id: id)
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: nil, command: .taskUncomplete(args))
        )
        schedulePersistence()
    }

    // MARK: - Internal Helpers

    internal func pushUndo(_ entry: FacetUndoEntry) {
        undoStack.append(entry)
        if undoStack.count > 25 {
            undoStack.removeFirst(undoStack.count - 25)
        }
    }

    private func nextTaskOrder(projectId: String) -> Double {
        let maxOrder =
            tasks
            .filter { !$0.is_deleted && $0.project_id == projectId }
            .map(\.child_order)
            .max() ?? 0
        return maxOrder + 1
    }

    internal static func nowTimestamp() -> String {
        ISO8601DateFormatter().string(from: Date())
    }
}

extension FacetLocalStore {
    public func reorderTask(id: String, childOrder: Double) {
        let now = Self.nowTimestamp()
        if let index = tasks.firstIndex(where: { $0.id == id }) {
            tasks[index] = tasks[index].applying(
                patch: FacetTaskPatch(childOrder: childOrder),
                updatedAt: now
            )
        }
        let args = TaskReorderArgs(id: id, child_order: childOrder)
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: nil, command: .taskReorder(args))
        )
        schedulePersistence()
    }

    public func deleteTask(id: String, recordUndo: Bool = true) {
        if let existing = tasks.first(where: { $0.id == id }), recordUndo {
            pushUndo(
                FacetUndoEntry(
                    summary: "Deleted \"\(existing.title)\"",
                    action: .recreateDeletedTask(snapshot: existing)
                )
            )
        }
        tasks.removeAll(where: { $0.id == id || $0.parent_id == id })
        reminders.removeAll(where: { $0.task_id == id })
        let args = TaskDeleteArgs(id: id)
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: nil, command: .taskDelete(args))
        )
        schedulePersistence()
    }

    // MARK: - Synchronization

    public func sync(client: FacetAPIClient) async throws {
        guard !isSyncing else { return }
        isSyncing = true
        lastError = nil
        defer { isSyncing = false }

        try await flushPersistence()
        let sentCommands = outbox
        let sentUUIDs = Set(sentCommands.map(\.uuid))

        do {
            let request = SyncRequest(
                sync_token: syncToken,
                resource_types: nil,
                commands: sentCommands
            )
            let response = try await client.sync(request: request)

            outbox.removeAll(where: { sentUUIDs.contains($0.uuid) })
            if !response.temp_id_mapping.isEmpty {
                lastTempIdMapping = response.temp_id_mapping
                applyTempIdMapping(response.temp_id_mapping)
            }
            applySyncResponseResources(response)
            if !outbox.isEmpty {
                replayQueuedOutbox(outbox)
            }

            let failedMessages = Self.extractCommandFailures(from: response.sync_status)
            if !failedMessages.isEmpty {
                lastError = failedMessages.joined(separator: "; ")
            }
            syncToken = response.sync_token
            lastSyncedAt = Date()
            try await flushPersistence()
        } catch {
            lastError = error.localizedDescription
            throw error
        }
    }
}
