import Foundation

extension FacetLocalStore {
    internal struct CompletionOutcome {
        let updatedTask: Task
        let advanced: Bool
        let ended: Bool
    }

    internal static func buildLocalTask(
        tempId: String,
        projectId: String,
        order: Double,
        draft: FacetTaskDraft,
        now: String
    ) -> Task {
        Task(
            id: tempId,
            user_id: "",
            project_id: projectId,
            section_id: draft.sectionId,
            parent_id: draft.parentId,
            title: draft.title,
            description: draft.description,
            priority: draft.priority,
            child_order: order,
            due_date: draft.dueDate,
            due_datetime: draft.dueDatetime,
            due_timezone: draft.dueTimezone,
            due_string: draft.dueString,
            is_recurring: draft.recurrenceRule.map { !$0.isEmpty } ?? false,
            recurrence_rule: draft.recurrenceRule,
            label_ids: draft.labelIds,
            completed: false,
            completed_at: nil,
            is_deleted: false,
            created_at: now,
            updated_at: now,
            deadline: draft.deadline,
            recurrence_basis: draft.recurrenceBasis
        )
    }

    internal static func buildTaskAddArgs(
        projectId: String,
        order: Double,
        draft: FacetTaskDraft
    ) -> TaskAddArgs {
        TaskAddArgs(
            title: draft.title,
            project_id: projectId,
            section_id: draft.sectionId,
            parent_id: draft.parentId,
            description: draft.description.isEmpty ? nil : draft.description,
            priority: draft.priority,
            child_order: order,
            due_date: draft.dueDate,
            due_datetime: draft.dueDatetime,
            due_timezone: draft.dueTimezone,
            due_string: draft.dueString,
            recurrence_rule: draft.recurrenceRule,
            label_ids: draft.labelIds.isEmpty ? nil : draft.labelIds,
            deadline: draft.deadline,
            recurrence_basis: draft.recurrenceBasis
        )
    }

    internal static func extractCommandFailures(from syncStatus: [String: String]) -> [String] {
        syncStatus.keys.sorted().compactMap { uuid in
            guard let status = syncStatus[uuid], status != "ok" else { return nil }
            return status
        }
    }

    // MARK: - Sync Merge & Outbox Replay

    internal func applyTempIdMapping(_ mapping: [String: String]) {
        tasks = tasks.map { $0.remapping(ids: mapping) }
        projects = projects.map { $0.remapping(ids: mapping) }
        sections = sections.map { $0.remapping(ids: mapping) }
        labels = labels.map { $0.remapping(ids: mapping) }
        filters = filters.map { $0.remapping(ids: mapping) }
        outbox = outbox.map { $0.remapping(ids: mapping) }
        undoStack = undoStack.map { $0.remapping(ids: mapping) }
    }

    internal func applySyncResponseResources(_ response: SyncResponse) {
        if response.full_sync {
            tasks = response.tasks.filter { !$0.is_deleted }
            projects = response.projects.filter { !$0.is_deleted }
            sections = response.sections.filter { !$0.is_deleted }
            labels = response.labels.filter { !$0.is_deleted }
            filters = response.filters.filter { !$0.is_deleted }
            return
        }
        Self.mergeEntities(&tasks, incoming: response.tasks, isDeleted: \.is_deleted)
        Self.mergeEntities(&projects, incoming: response.projects, isDeleted: \.is_deleted)
        Self.mergeEntities(&sections, incoming: response.sections, isDeleted: \.is_deleted)
        Self.mergeEntities(&labels, incoming: response.labels, isDeleted: \.is_deleted)
        Self.mergeEntities(&filters, incoming: response.filters, isDeleted: \.is_deleted)
    }

    internal func replayQueuedOutbox(
        _ queuedCommands: [QueuedCommand], retaining optimistic: [Task] = []
    ) {
        let now = Self.nowTimestamp()
        // Unchanged incremental resources still contain their optimistic edits, including
        // recurrence advancement. Only rebuild tasks replaced by a server baseline.
        let retained = Dictionary(uniqueKeysWithValues: optimistic.map { ($0.id, $0) })
        for entry in queuedCommands {
            if replayTaskMutationCommand(entry, now: now) { continue }
            if replayTaskCompletionCommand(entry, now: now) { continue }
            replaySecondaryCommand(entry, now: now)
        }
        if !retained.isEmpty { tasks = tasks.map { retained[$0.id] ?? $0 } }
    }

    private func replayTaskMutationCommand(_ queued: QueuedCommand, now: String) -> Bool {
        switch queued.command {
        case .taskAdd(let args):
            appendReplayedTask(queued: queued, args: args, now: now)
            return true
        case .taskUpdate(let args):
            if let index = tasks.firstIndex(where: { $0.id == args.id }) {
                tasks[index] = Self.applyWireTaskUpdate(args, to: tasks[index], now: now)
            }
            return true
        case .taskMove(let args):
            replayMove(args.tasks, now: now)
            return true
        case .taskReschedule(let args):
            replaySchedules(args.tasks, now: now)
            return true
        case .taskDelete(let args):
            tasks.removeAll(where: { $0.id == args.id })
            return true
        case .taskReorder(let args):
            if let index = tasks.firstIndex(where: { $0.id == args.id }) {
                tasks[index] = tasks[index].applying(
                    patch: FacetTaskPatch(childOrder: args.child_order),
                    updatedAt: now
                )
            }
            return true
        case .taskComplete, .taskUncomplete, .projectAdd, .projectUpdate, .projectDelete,
            .sectionAdd, .sectionUpdate, .sectionDelete, .labelAdd, .labelUpdate, .labelDelete,
            .filterAdd, .filterUpdate, .filterDelete, .reminderAdd, .reminderUpdate,
            .reminderDelete:
            return false
        }
    }

    private func replayTaskCompletionCommand(_ queued: QueuedCommand, now: String) -> Bool {
        switch queued.command {
        case .taskComplete(let args):
            if let index = tasks.firstIndex(where: { $0.id == args.id }) {
                let timestamp = args.completed_at ?? now
                guard let instant = ViewerCalendar.parseISO8601(timestamp) else { return true }
                tasks[index] =
                    Self.completedState(for: tasks[index], at: instant, nowISO: timestamp)
                    .updatedTask
            }
            return true
        case .taskUncomplete(let args):
            if let index = tasks.firstIndex(where: { $0.id == args.id }) {
                tasks[index] = tasks[index].setting(
                    completed: false,
                    completedAt: nil,
                    updatedAt: now
                )
            }
            return true
        case .taskAdd, .taskUpdate, .taskDelete, .taskReorder, .taskReschedule, .taskMove,
            .projectAdd,
            .projectUpdate,
            .projectDelete, .sectionAdd, .sectionUpdate, .sectionDelete, .labelAdd, .labelUpdate,
            .labelDelete, .filterAdd, .filterUpdate, .filterDelete, .reminderAdd, .reminderUpdate,
            .reminderDelete:
            return false
        }
    }

    private func appendReplayedTask(queued: QueuedCommand, args: TaskAddArgs, now: String) {
        let newId = queued.temp_id ?? "tmp-\(queued.uuid)"
        guard !tasks.contains(where: { $0.id == newId }) else { return }
        let resolvedProject =
            args.project_id.isEmpty ? (inboxProject?.id ?? "") : args.project_id
        tasks.append(
            Task(
                id: newId,
                user_id: "",
                project_id: resolvedProject,
                section_id: args.section_id,
                parent_id: args.parent_id,
                title: args.title,
                description: args.description ?? "",
                priority: args.priority ?? .p4,
                child_order: args.child_order ?? Double(tasks.count),
                due_date: args.due_date,
                due_datetime: args.due_datetime,
                due_timezone: args.due_timezone,
                due_string: args.due_string,
                is_recurring: args.recurrence_rule.map { !$0.isEmpty } ?? false,
                recurrence_rule: args.recurrence_rule,
                label_ids: args.label_ids ?? [],
                completed: false,
                completed_at: nil,
                is_deleted: false,
                created_at: now,
                updated_at: now,
                deadline: args.deadline,
                recurrence_basis: args.recurrence_basis
            )
        )
    }

    private func replaySecondaryCommand(_ queued: QueuedCommand, now: String) {
        let newId = queued.temp_id ?? "tmp-\(queued.uuid)"
        switch queued.command {
        case .projectAdd(let args) where !projects.contains(where: { $0.id == newId }):
            projects.append(
                Project(
                    id: newId,
                    user_id: "",
                    name: args.name,
                    color: args.color ?? "charcoal",
                    parent_id: args.parent_id,
                    child_order: args.child_order ?? Double(projects.count),
                    is_inbox: false,
                    is_favorite: args.is_favorite ?? false,
                    is_archived: false,
                    is_deleted: false,
                    created_at: now,
                    updated_at: now
                )
            )
        case .projectDelete(let args):
            projects.removeAll(where: { $0.id == args.id })
        case .sectionAdd(let args) where !sections.contains(where: { $0.id == newId }):
            sections.append(
                Section(
                    id: newId,
                    project_id: args.project_id,
                    user_id: "",
                    name: args.name,
                    section_order: args.section_order ?? Double(sections.count),
                    is_archived: false,
                    is_deleted: false,
                    created_at: now,
                    updated_at: now
                )
            )
        case .sectionDelete(let args):
            sections.removeAll(where: { $0.id == args.id })
        case .projectUpdate(let args): applyProjectUpdate(args, now: now)
        case .labelAdd, .filterAdd, .labelUpdate, .filterUpdate, .labelDelete, .filterDelete:
            replayMetadata(queued.command, id: newId)
        case .taskAdd, .taskUpdate, .taskDelete, .taskComplete, .taskUncomplete, .taskReorder,
            .taskReschedule, .taskMove,
            .projectAdd, .sectionAdd, .sectionUpdate, .reminderAdd, .reminderUpdate,
            .reminderDelete:
            break
        }
    }

    private func replayMetadata(_ command: SyncCommand, id newId: String) {
        switch command {
        case .labelUpdate(let args): applyLabelUpdate(args)
        case .filterUpdate(let args): applyFilterUpdate(args)
        case .labelAdd(let args) where !labels.contains(where: { $0.id == newId }):
            labels.append(
                Label(
                    id: newId, user_id: "", name: args.name, color: args.color ?? "charcoal",
                    item_order: args.item_order ?? Double(labels.count),
                    is_favorite: args.is_favorite ?? false, is_deleted: false))
        case .filterAdd(let args) where !filters.contains(where: { $0.id == newId }):
            filters.append(
                Filter(
                    id: newId, user_id: "", name: args.name, query: args.query,
                    color: args.color ?? "charcoal",
                    item_order: args.item_order ?? Double(filters.count),
                    is_favorite: args.is_favorite ?? false, is_deleted: false))
        case .labelDelete(let args): labels.removeAll { $0.id == args.id }
        case .filterDelete(let args): filters.removeAll { $0.id == args.id }
        case .taskAdd, .taskUpdate, .taskDelete, .taskComplete, .taskUncomplete, .taskReorder,
            .taskReschedule, .taskMove, .projectAdd, .projectDelete, .projectUpdate, .sectionAdd,
            .sectionDelete,
            .sectionUpdate, .labelAdd, .filterAdd, .reminderAdd, .reminderUpdate, .reminderDelete:
            break
        }
    }

    private static func applyWireTaskUpdate(
        _ args: TaskUpdateArgs,
        to current: Task,
        now: String
    ) -> Task {
        var patch = FacetTaskPatch(
            title: args.title,
            description: args.description,
            priority: args.priority,
            projectId: args.project_id,
            sectionId: wirePatch(from: args.section_id),
            parentId: wirePatch(from: args.parent_id),
            childOrder: args.child_order,
            dueDate: wirePatch(from: args.due_date),
            dueDatetime: wirePatch(from: args.due_datetime),
            dueTimezone: wirePatch(from: args.due_timezone),
            dueString: wirePatch(from: args.due_string),
            deadline: wirePatch(from: args.deadline),
            recurrenceBasis: args.recurrence_basis,
            recurrenceRule: wirePatch(from: args.recurrence_rule),
            labelIds: args.label_ids.map(FacetFieldPatch.set) ?? .unchanged
        )
        patch.appendComment = args.append_comment
        patch.removeCommentID = args.remove_comment_id
        patch.removeAttachmentID = args.remove_attachment_id
        return current.applying(patch: patch, updatedAt: now)
    }

    internal static func wirePatch(from raw: String?) -> FacetFieldPatch<String> {
        guard let raw else { return .unchanged }
        return raw.isEmpty ? .clear : .set(raw)
    }

    private static func mergeEntities<Entity: Identifiable>(
        _ target: inout [Entity],
        incoming: [Entity],
        isDeleted: (Entity) -> Bool
    ) where Entity.ID == String {
        for item in incoming {
            if isDeleted(item) {
                target.removeAll(where: { $0.id == item.id })
            } else if let index = target.firstIndex(where: { $0.id == item.id }) {
                target[index] = item
            } else {
                target.append(item)
            }
        }
    }
}
