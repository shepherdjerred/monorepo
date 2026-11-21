public import Foundation

extension Priority: CaseIterable {
    public static let allCases: [Priority] = [.p1, .p2, .p3, .p4]
}

/// Explicit three-state patch avoiding ambiguous double-optionals or optional collections.
public enum FacetFieldPatch<Value: Sendable & Equatable>: Sendable, Equatable {
    case unchanged
    case set(Value)
    case clear
}

/// Complete draft for creating a task locally and queueing `SyncCommand.taskAdd`.
public struct FacetTaskDraft: Sendable, Equatable {
    public var title: String
    public var projectId: String
    public var sectionId: String?
    public var parentId: String?
    public var description: String
    public var priority: Priority
    public var childOrder: Double?
    public var dueDate: String?
    public var dueDatetime: String?
    public var dueTimezone: String?
    public var dueString: String?
    public var deadline: String?
    public var recurrenceBasis: RecurrenceBasis?
    public var recurrenceRule: String?
    public var labelIds: [String]

    public init(
        title: String,
        projectId: String = "",
        sectionId: String? = nil,
        parentId: String? = nil,
        description: String = "",
        priority: Priority = .p4,
        childOrder: Double? = nil,
        dueDate: String? = nil,
        dueDatetime: String? = nil,
        dueTimezone: String? = nil,
        dueString: String? = nil,
        deadline: String? = nil,
        recurrenceBasis: RecurrenceBasis? = nil,
        recurrenceRule: String? = nil,
        labelIds: [String] = []
    ) {
        self.title = title
        self.projectId = projectId
        self.sectionId = sectionId
        self.parentId = parentId
        self.description = description
        self.priority = priority
        self.childOrder = childOrder
        self.dueDate = dueDate
        self.dueDatetime = dueDatetime
        self.dueTimezone = dueTimezone
        self.dueString = dueString
        self.deadline = deadline
        self.recurrenceBasis = recurrenceBasis
        self.recurrenceRule = recurrenceRule
        self.labelIds = labelIds
    }
}

/// Patch descriptor for `FacetLocalStore.updateTask`, encoding `.clear` as `""` on wire nullable fields.
public struct FacetTaskPatch: Sendable, Equatable {
    internal var restoreDeleted = false
    public var appendComment: CommentUpload?
    public var removeCommentID: String?
    public var removeAttachmentID: String?
    public var title: String?
    public var description: String?
    public var priority: Priority?
    public var projectId: String?
    public var sectionId: FacetFieldPatch<String>
    public var parentId: FacetFieldPatch<String>
    public var childOrder: Double?
    public var dueDate: FacetFieldPatch<String>
    public var dueDatetime: FacetFieldPatch<String>
    public var dueTimezone: FacetFieldPatch<String>
    public var dueString: FacetFieldPatch<String>
    public var deadline: FacetFieldPatch<String>
    public var recurrenceBasis: RecurrenceBasis?
    public var recurrenceRule: FacetFieldPatch<String>
    public var labelIds: FacetFieldPatch<[String]>

    public init(
        title: String? = nil,
        description: String? = nil,
        priority: Priority? = nil,
        projectId: String? = nil,
        sectionId: FacetFieldPatch<String> = .unchanged,
        parentId: FacetFieldPatch<String> = .unchanged,
        childOrder: Double? = nil,
        dueDate: FacetFieldPatch<String> = .unchanged,
        dueDatetime: FacetFieldPatch<String> = .unchanged,
        dueTimezone: FacetFieldPatch<String> = .unchanged,
        dueString: FacetFieldPatch<String> = .unchanged,
        deadline: FacetFieldPatch<String> = .unchanged,
        recurrenceBasis: RecurrenceBasis? = nil,
        recurrenceRule: FacetFieldPatch<String> = .unchanged,
        labelIds: FacetFieldPatch<[String]> = .unchanged
    ) {
        self.title = title
        self.description = description
        self.priority = priority
        self.projectId = projectId
        self.sectionId = sectionId
        self.parentId = parentId
        self.childOrder = childOrder
        self.dueDate = dueDate
        self.dueDatetime = dueDatetime
        self.dueTimezone = dueTimezone
        self.dueString = dueString
        self.deadline = deadline
        self.recurrenceBasis = recurrenceBasis
        self.recurrenceRule = recurrenceRule
        self.labelIds = labelIds
    }

    internal func makeWireArgs(id: String) -> TaskUpdateArgs {
        TaskUpdateArgs(
            id: id,
            title: title,
            description: description,
            priority: priority,
            project_id: projectId,
            section_id: Self.wireNullable(sectionId),
            parent_id: Self.wireNullable(parentId),
            child_order: childOrder,
            due_date: Self.wireNullable(dueDate),
            due_datetime: Self.wireNullable(dueDatetime),
            due_timezone: Self.wireNullable(dueTimezone),
            due_string: Self.wireNullable(dueString),
            recurrence_rule: Self.wireNullable(recurrenceRule),
            label_ids: {
                switch labelIds {
                case .unchanged: nil
                case .set(let values): values
                case .clear: []
                }
            }(),
            append_comment: appendComment,
            remove_comment_id: removeCommentID,
            remove_attachment_id: removeAttachmentID,
            deadline: Self.wireNullable(deadline),
            recurrence_basis: recurrenceBasis,
            restore_deleted: restoreDeleted ? true : nil
        )
    }

    private static func wireNullable(_ patch: FacetFieldPatch<String>) -> String? {
        switch patch {
        case .unchanged: nil
        case .set(let value): value
        case .clear: ""
        }
    }
}

/// Undoable action entry for reversible user task mutations.
public struct FacetUndoEntry: Sendable, Equatable, Identifiable {
    public enum Action: Sendable, Equatable {
        case deleteCreatedTask(taskId: String)
        case uncompleteTask(taskId: String)
        case completeTask(taskId: String)
        case restoreTaskSnapshot(previous: Task, wasEndedRecurring: Bool)
        case recreateDeletedTask(snapshot: Task)
        case restoreSchedules(previous: [Task])
        case moveTasks(previous: [TaskMoveEntry])
    }

    public let id: String
    public let summary: String
    public let createdAt: Date
    public let action: Action

    public init(
        id: String = UUID().uuidString,
        summary: String,
        createdAt: Date = .now,
        action: Action
    ) {
        self.id = id
        self.summary = summary
        self.createdAt = createdAt
        self.action = action
    }

    internal func remapping(ids mapping: [String: String]) -> FacetUndoEntry {
        let mappedAction: Action
        switch action {
        case .deleteCreatedTask(let taskId):
            mappedAction = .deleteCreatedTask(taskId: mapping[taskId] ?? taskId)
        case .uncompleteTask(let taskId):
            mappedAction = .uncompleteTask(taskId: mapping[taskId] ?? taskId)
        case .completeTask(let taskId):
            mappedAction = .completeTask(taskId: mapping[taskId] ?? taskId)
        case .restoreTaskSnapshot(let previous, let wasEndedRecurring):
            mappedAction = .restoreTaskSnapshot(
                previous: previous.remapping(ids: mapping),
                wasEndedRecurring: wasEndedRecurring
            )
        case .recreateDeletedTask(let snapshot):
            mappedAction = .recreateDeletedTask(snapshot: snapshot.remapping(ids: mapping))
        case .moveTasks(let previous):
            mappedAction = .moveTasks(previous: previous.map { $0.remapped(using: mapping) })
        case .restoreSchedules(let previous):
            mappedAction = .restoreSchedules(previous: previous.map { $0.remapping(ids: mapping) })
        }
        return FacetUndoEntry(id: id, summary: summary, createdAt: createdAt, action: mappedAction)
    }
}

extension Task {
    func setting(completed: Bool, completedAt: String?, updatedAt: String) -> Task {
        Task(
            id: id,
            user_id: user_id,
            project_id: project_id,
            section_id: section_id,
            parent_id: parent_id,
            title: title,
            description: description,
            priority: priority,
            child_order: child_order,
            due_date: due_date,
            due_datetime: due_datetime,
            due_timezone: due_timezone,
            due_string: due_string,
            is_recurring: is_recurring,
            recurrence_rule: recurrence_rule,
            label_ids: label_ids,
            completed: completed,
            completed_at: completedAt,
            is_deleted: is_deleted,
            created_at: created_at,
            updated_at: updatedAt,
            comments: comments,
            deadline: deadline,
            recurrence_basis: recurrence_basis
        )
    }

    func applying(patch: FacetTaskPatch, updatedAt: String) -> Task {
        let nextRule = Self.applyNullable(patch.recurrenceRule, current: recurrence_rule)
        let nextRecurring = Self.resolveRecurring(
            patch: patch.recurrenceRule, current: is_recurring)
        let nextLabels = Self.resolveLabels(patch: patch.labelIds, current: label_ids)

        return Task(
            id: id,
            user_id: user_id,
            project_id: patch.projectId ?? project_id,
            section_id: Self.applyNullable(patch.sectionId, current: section_id),
            parent_id: Self.applyNullable(patch.parentId, current: parent_id),
            title: patch.title ?? title,
            description: patch.description ?? description,
            priority: patch.priority ?? priority,
            child_order: patch.childOrder ?? child_order,
            due_date: Self.applyNullable(patch.dueDate, current: due_date),
            due_datetime: Self.applyNullable(patch.dueDatetime, current: due_datetime),
            due_timezone: Self.applyNullable(patch.dueTimezone, current: due_timezone),
            due_string: Self.applyNullable(patch.dueString, current: due_string),
            is_recurring: nextRecurring,
            recurrence_rule: nextRule,
            label_ids: nextLabels,
            completed: completed,
            completed_at: completed_at,
            is_deleted: is_deleted,
            created_at: created_at,
            updated_at: updatedAt,
            comments: patch.changesComments
                ? patch.applyingCommentChanges(to: comments ?? []) : comments,
            deadline: Self.applyNullable(patch.deadline, current: deadline),
            recurrence_basis: patch.recurrenceBasis ?? recurrence_basis
        )
    }

    private static func applyNullable(
        _ patch: FacetFieldPatch<String>,
        current: String?
    ) -> String? {
        switch patch {
        case .unchanged: current
        case .set(let value): value.isEmpty ? nil : value
        case .clear: nil
        }
    }

    private static func resolveRecurring(
        patch: FacetFieldPatch<String>,
        current: Bool
    ) -> Bool {
        switch patch {
        case .unchanged: current
        case .set(let rule): !rule.isEmpty
        case .clear: false
        }
    }

    private static func resolveLabels(
        patch: FacetFieldPatch<[String]>,
        current: [String]
    ) -> [String] {
        switch patch {
        case .unchanged: current
        case .set(let values): values
        case .clear: []
        }
    }
}
