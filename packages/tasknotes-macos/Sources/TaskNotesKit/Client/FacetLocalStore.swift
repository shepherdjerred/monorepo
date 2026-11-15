internal import Foundation
public import Observation

/// Local observable store for tasks, projects, sections, and labels with offline mutation outbox
/// and server synchronization support.
@Observable
@MainActor
public final class FacetLocalStore {
    public var tasks: [Task] = []
    public var projects: [Project] = []
    public var sections: [Section] = []
    public var labels: [Label] = []
    public var syncToken: String?
    public var outbox: [QueuedCommand] = []
    public var isSyncing: Bool = false
    public var lastError: String?

    public init(
        tasks: [Task] = [],
        projects: [Project] = [],
        sections: [Section] = [],
        labels: [Label] = [],
        syncToken: String? = nil,
        outbox: [QueuedCommand] = []
    ) {
        self.tasks = tasks
        self.projects = projects
        self.sections = sections
        self.labels = labels
        self.syncToken = syncToken
        self.outbox = outbox
    }

    // MARK: - Offline / Optimistic Mutations

    /// Adds a new task with an optimistic local temporary ID and queues a creation command.
    @discardableResult
    public func addTask(
        title: String,
        projectId: String,
        priority: Priority = .p4
    ) -> Task {
        let tempId = "tmp-\(UUID().uuidString)"
        let now = Self.nowTimestamp()
        let task = Task(
            id: tempId,
            user_id: "",
            project_id: projectId,
            section_id: nil,
            parent_id: nil,
            title: title,
            description: "",
            priority: priority,
            child_order: Double(tasks.count),
            due_date: nil,
            due_datetime: nil,
            due_timezone: nil,
            due_string: nil,
            is_recurring: false,
            recurrence_rule: nil,
            completed: false,
            completed_at: nil,
            is_deleted: false,
            created_at: now,
            updated_at: now
        )
        tasks.append(task)

        let args = TaskAddArgs(
            title: title,
            project_id: projectId,
            section_id: nil,
            parent_id: nil,
            description: nil,
            priority: priority,
            child_order: nil,
            due_date: nil,
            due_datetime: nil,
            due_timezone: nil,
            due_string: nil,
            recurrence_rule: nil
        )
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: tempId, command: .taskAdd(args)))
        return task
    }

    /// Optimistically marks a task as completed and queues a completion command.
    public func completeTask(id: String) {
        let now = Self.nowTimestamp()
        if let index = tasks.firstIndex(where: { $0.id == id }) {
            tasks[index] = tasks[index].setting(completed: true, completedAt: now, updatedAt: now)
        }
        let args = TaskCompleteArgs(id: id, completed_at: now)
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: nil, command: .taskComplete(args)))
    }

    /// Optimistically uncompletes a task and queues an uncomplete command.
    public func uncompleteTask(id: String) {
        let now = Self.nowTimestamp()
        if let index = tasks.firstIndex(where: { $0.id == id }) {
            tasks[index] = tasks[index].setting(completed: false, completedAt: nil, updatedAt: now)
        }
        let args = TaskUncompleteArgs(id: id)
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: nil, command: .taskUncomplete(args)))
    }

    /// Optimistically removes a task from local state and queues a delete command.
    public func deleteTask(id: String) {
        tasks.removeAll(where: { $0.id == id })
        let args = TaskDeleteArgs(id: id)
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: nil, command: .taskDelete(args)))
    }

    /// Adds a new project with an optimistic local temporary ID and queues a project add command.
    @discardableResult
    public func addProject(name: String, color: String? = nil) -> Project {
        let tempId = "tmp-\(UUID().uuidString)"
        let now = Self.nowTimestamp()
        let project = Project(
            id: tempId,
            user_id: "",
            name: name,
            color: color ?? "charcoal",
            parent_id: nil,
            child_order: Double(projects.count),
            is_inbox: false,
            is_favorite: false,
            is_archived: false,
            is_deleted: false,
            created_at: now,
            updated_at: now
        )
        projects.append(project)

        let args = ProjectAddArgs(
            name: name, color: color, parent_id: nil, child_order: nil, is_favorite: nil)
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: tempId, command: .projectAdd(args)))
        return project
    }

    // MARK: - Synchronization

    /// Flushes the local outbox and merges server updates from `/api/v1/sync`.
    public func sync(client: FacetAPIClient) async throws {
        guard !isSyncing else { return }
        isSyncing = true
        lastError = nil
        defer { isSyncing = false }

        let inFlightUUIDs = Set(outbox.map(\.uuid))
        do {
            let request = SyncRequest(sync_token: syncToken, resource_types: nil, commands: outbox)
            let response = try await client.sync(request: request)

            if !response.temp_id_mapping.isEmpty {
                applyTempIdMapping(response.temp_id_mapping)
            }
            mergeResources(from: response)
            syncToken = response.sync_token
            outbox.removeAll(where: { inFlightUUIDs.contains($0.uuid) })
        } catch {
            lastError = error.localizedDescription
            throw error
        }
    }

    // MARK: - Private Helpers

    private func applyTempIdMapping(_ mapping: [String: String]) {
        for index in 0..<tasks.count {
            tasks[index] = tasks[index].remapping(ids: mapping)
        }
        for index in 0..<projects.count {
            projects[index] = projects[index].remapping(ids: mapping)
        }
    }

    private func mergeResources(from response: SyncResponse) {
        mergeTasks(response.tasks)
        mergeProjects(response.projects)
        mergeSections(response.sections)
        mergeLabels(response.labels)
    }

    private func mergeTasks(_ serverTasks: [Task]) {
        for item in serverTasks {
            if item.is_deleted {
                tasks.removeAll(where: { $0.id == item.id })
            } else if let index = tasks.firstIndex(where: { $0.id == item.id }) {
                tasks[index] = item
            } else {
                tasks.append(item)
            }
        }
    }

    private func mergeProjects(_ serverProjects: [Project]) {
        for item in serverProjects {
            if item.is_deleted {
                projects.removeAll(where: { $0.id == item.id })
            } else if let index = projects.firstIndex(where: { $0.id == item.id }) {
                projects[index] = item
            } else {
                projects.append(item)
            }
        }
    }

    private func mergeSections(_ serverSections: [Section]) {
        for item in serverSections {
            if item.is_deleted {
                sections.removeAll(where: { $0.id == item.id })
            } else if let index = sections.firstIndex(where: { $0.id == item.id }) {
                sections[index] = item
            } else {
                sections.append(item)
            }
        }
    }

    private func mergeLabels(_ serverLabels: [Label]) {
        for item in serverLabels {
            if item.is_deleted {
                labels.removeAll(where: { $0.id == item.id })
            } else if let index = labels.firstIndex(where: { $0.id == item.id }) {
                labels[index] = item
            } else {
                labels.append(item)
            }
        }
    }

    private static func nowTimestamp() -> String {
        ISO8601DateFormatter().string(from: Date())
    }
}
