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
            updated_at: now
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
            label_ids: draft.labelIds.isEmpty ? nil : draft.labelIds
        )
    }

    internal static func completedState(
        for task: Task,
        at completionDate: Date,
        nowISO: String
    ) -> CompletionOutcome {
        guard task.is_recurring, let rule = task.recurrence_rule, !rule.isEmpty else {
            return CompletionOutcome(
                updatedTask: task.setting(completed: true, completedAt: nowISO, updatedAt: nowISO),
                advanced: false,
                ended: false
            )
        }
        let next = FacetRecurrenceCodec.nextOccurrence(
            rule: rule,
            dueDate: task.due_date,
            dueDatetime: task.due_datetime,
            referenceDate: completionDate
        )
        switch next {
        case .ended:
            return CompletionOutcome(
                updatedTask: task.setting(completed: true, completedAt: nowISO, updatedAt: nowISO),
                advanced: false,
                ended: true
            )
        case .advanced(let nextDate, let updatedRule):
            let advancedTask = buildAdvancedRecurringTask(
                from: task,
                nextDate: nextDate,
                updatedRule: updatedRule,
                nowISO: nowISO
            )
            return CompletionOutcome(updatedTask: advancedTask, advanced: true, ended: false)
        }
    }

    private static func buildAdvancedRecurringTask(
        from task: Task,
        nextDate: Date,
        updatedRule: String,
        nowISO: String
    ) -> Task {
        let nextCivil = ViewerCalendar.civilDateString(for: nextDate, timeZone: .gmt)
        let hasDatetime = task.due_datetime.map { !$0.isEmpty } ?? false
        let hasDate = task.due_date.map { !$0.isEmpty } ?? false
        let nextDueDatetime = hasDatetime ? ISO8601DateFormatter().string(from: nextDate) : nil
        let nextDueDate = (!hasDatetime || hasDate) ? nextCivil : nil
        return Task(
            id: task.id,
            user_id: task.user_id,
            project_id: task.project_id,
            section_id: task.section_id,
            parent_id: task.parent_id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            child_order: task.child_order,
            due_date: nextDueDate,
            due_datetime: nextDueDatetime,
            due_timezone: task.due_timezone,
            due_string: task.due_string,
            is_recurring: true,
            recurrence_rule: updatedRule,
            label_ids: task.label_ids,
            completed: false,
            completed_at: nil,
            is_deleted: task.is_deleted,
            created_at: task.created_at,
            updated_at: nowISO
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

    internal func replayQueuedOutbox(_ queuedCommands: [QueuedCommand]) {
        let now = Self.nowTimestamp()
        for entry in queuedCommands {
            if replayTaskMutationCommand(entry, now: now) { continue }
            if replayTaskCompletionCommand(entry, now: now) { continue }
            replaySecondaryCommand(entry, now: now)
        }
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
                tasks[index] = tasks[index].setting(
                    completed: true,
                    completedAt: args.completed_at ?? now,
                    updatedAt: now
                )
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
        case .taskAdd, .taskUpdate, .taskDelete, .taskReorder, .projectAdd, .projectUpdate,
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
                updated_at: now
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
        case .labelDelete, .filterDelete:
            replayMetadataDeletes(queued.command)
        case .taskAdd, .taskUpdate, .taskDelete, .taskComplete, .taskUncomplete, .taskReorder,
            .projectAdd, .projectUpdate, .sectionAdd, .sectionUpdate, .labelAdd, .labelUpdate,
            .filterAdd, .filterUpdate, .reminderAdd, .reminderUpdate, .reminderDelete:
            break
        }
    }

    private func replayMetadataDeletes(_ command: SyncCommand) {
        if case .labelDelete(let args) = command {
            labels.removeAll(where: { $0.id == args.id })
        } else if case .filterDelete(let args) = command {
            filters.removeAll(where: { $0.id == args.id })
        }
    }

    private static func applyWireTaskUpdate(
        _ args: TaskUpdateArgs,
        to current: Task,
        now: String
    ) -> Task {
        let patch = FacetTaskPatch(
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
            recurrenceRule: wirePatch(from: args.recurrence_rule),
            labelIds: args.label_ids.map(FacetFieldPatch.set) ?? .unchanged
        )
        return current.applying(patch: patch, updatedAt: now)
    }

    private static func wirePatch(from raw: String?) -> FacetFieldPatch<String> {
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
