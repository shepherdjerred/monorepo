import Foundation

extension Task {
    func remapping(ids mapping: [String: String]) -> Task {
        let mappedId = mapping[id] ?? id
        let mappedProject = mapping[project_id] ?? project_id
        let mappedSection = section_id.flatMap { mapping[$0] ?? $0 }
        let mappedParent = parent_id.flatMap { mapping[$0] ?? $0 }
        let mappedLabels = label_ids.map { mapping[$0] ?? $0 }
        guard
            mappedId != id
                || mappedProject != project_id
                || mappedSection != section_id
                || mappedParent != parent_id
                || mappedLabels != label_ids
        else { return self }
        return Task(
            id: mappedId,
            user_id: user_id,
            project_id: mappedProject,
            section_id: mappedSection,
            parent_id: mappedParent,
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
            label_ids: mappedLabels,
            completed: completed,
            completed_at: completed_at,
            is_deleted: is_deleted,
            created_at: created_at,
            updated_at: updated_at
        )
    }
}

extension Project {
    func remapping(ids mapping: [String: String]) -> Project {
        let mappedId = mapping[id] ?? id
        let mappedParent = parent_id.flatMap { mapping[$0] ?? $0 }
        guard mappedId != id || mappedParent != parent_id else { return self }
        return Project(
            id: mappedId,
            user_id: user_id,
            name: name,
            color: color,
            parent_id: mappedParent,
            child_order: child_order,
            is_inbox: is_inbox,
            is_favorite: is_favorite,
            is_archived: is_archived,
            is_deleted: is_deleted,
            created_at: created_at,
            updated_at: updated_at
        )
    }
}

extension Section {
    func remapping(ids mapping: [String: String]) -> Section {
        let mappedId = mapping[id] ?? id
        let mappedProject = mapping[project_id] ?? project_id
        guard mappedId != id || mappedProject != project_id else { return self }
        return Section(
            id: mappedId,
            project_id: mappedProject,
            user_id: user_id,
            name: name,
            section_order: section_order,
            is_archived: is_archived,
            is_deleted: is_deleted,
            created_at: created_at,
            updated_at: updated_at
        )
    }
}

extension Label {
    func remapping(ids mapping: [String: String]) -> Label {
        guard let mappedId = mapping[id], mappedId != id else { return self }
        return Label(
            id: mappedId,
            user_id: user_id,
            name: name,
            color: color,
            item_order: item_order,
            is_favorite: is_favorite,
            is_deleted: is_deleted
        )
    }
}

extension Reminder {
    func remapping(ids mapping: [String: String]) -> Reminder {
        let mappedId = mapping[id] ?? id
        let mappedTask = mapping[task_id] ?? task_id
        guard mappedId != id || mappedTask != task_id else { return self }
        return Reminder(
            id: mappedId,
            task_id: mappedTask,
            reminder_type: reminder_type,
            minute_offset: minute_offset,
            due_datetime: due_datetime,
            is_notified: is_notified,
            is_deleted: is_deleted,
            updated_at: updated_at
        )
    }
}

extension Filter {
    func remapping(ids mapping: [String: String]) -> Filter {
        guard let mappedId = mapping[id], mappedId != id else { return self }
        return Filter(
            id: mappedId,
            user_id: user_id,
            name: name,
            query: query,
            color: color,
            item_order: item_order,
            is_favorite: is_favorite,
            is_deleted: is_deleted
        )
    }
}

extension QueuedCommand {
    func remapping(ids mapping: [String: String]) -> QueuedCommand {
        let mappedTemp = temp_id.map { mapping[$0] ?? $0 }
        return QueuedCommand(
            uuid: uuid,
            temp_id: mappedTemp,
            command: command.remapping(ids: mapping)
        )
    }
}

extension SyncCommand {
    func remapping(ids mapping: [String: String]) -> SyncCommand {
        if let taskMapped = remapTaskCommand(ids: mapping) {
            return taskMapped
        }
        if let hierarchyMapped = remapProjectOrSectionCommand(ids: mapping) {
            return hierarchyMapped
        }
        return remapSecondaryCommand(ids: mapping)
    }

    private func remapTaskCommand(ids mapping: [String: String]) -> SyncCommand? {
        switch self {
        case .taskAdd(let args):
            return .taskAdd(Self.remapTaskAdd(args, ids: mapping))
        case .taskUpdate(let args):
            return .taskUpdate(Self.remapTaskUpdate(args, ids: mapping))
        case .taskDelete(let args):
            return .taskDelete(TaskDeleteArgs(id: mapping[args.id] ?? args.id))
        case .taskComplete(let args):
            return .taskComplete(
                TaskCompleteArgs(id: mapping[args.id] ?? args.id, completed_at: args.completed_at)
            )
        case .taskUncomplete(let args):
            return .taskUncomplete(TaskUncompleteArgs(id: mapping[args.id] ?? args.id))
        case .taskReorder(let args):
            return .taskReorder(
                TaskReorderArgs(id: mapping[args.id] ?? args.id, child_order: args.child_order)
            )
        case .projectAdd, .projectUpdate, .projectDelete, .sectionAdd, .sectionUpdate,
            .sectionDelete, .labelAdd, .labelUpdate, .labelDelete, .reminderAdd, .reminderUpdate,
            .reminderDelete, .filterAdd, .filterUpdate, .filterDelete:
            return nil
        }
    }

    private func remapProjectOrSectionCommand(ids mapping: [String: String]) -> SyncCommand? {
        switch self {
        case .projectAdd(let args):
            return .projectAdd(
                ProjectAddArgs(
                    name: args.name,
                    color: args.color,
                    parent_id: args.parent_id.map { mapping[$0] ?? $0 },
                    child_order: args.child_order,
                    is_favorite: args.is_favorite
                )
            )
        case .projectUpdate(let args):
            return .projectUpdate(
                ProjectUpdateArgs(
                    id: mapping[args.id] ?? args.id,
                    name: args.name,
                    color: args.color,
                    parent_id: Self.remapNullableId(args.parent_id, ids: mapping),
                    child_order: args.child_order,
                    is_favorite: args.is_favorite,
                    is_archived: args.is_archived
                )
            )
        case .projectDelete(let args):
            return .projectDelete(ProjectDeleteArgs(id: mapping[args.id] ?? args.id))
        case .sectionAdd(let args):
            return .sectionAdd(
                SectionAddArgs(
                    project_id: mapping[args.project_id] ?? args.project_id,
                    name: args.name,
                    section_order: args.section_order
                )
            )
        case .sectionUpdate(let args):
            return .sectionUpdate(
                SectionUpdateArgs(
                    id: mapping[args.id] ?? args.id,
                    name: args.name,
                    section_order: args.section_order,
                    is_archived: args.is_archived
                )
            )
        case .sectionDelete(let args):
            return .sectionDelete(SectionDeleteArgs(id: mapping[args.id] ?? args.id))
        case .taskAdd, .taskUpdate, .taskDelete, .taskComplete, .taskUncomplete, .taskReorder,
            .labelAdd, .labelUpdate, .labelDelete, .reminderAdd, .reminderUpdate, .reminderDelete,
            .filterAdd, .filterUpdate, .filterDelete:
            return nil
        }
    }

    private func remapSecondaryCommand(ids mapping: [String: String]) -> SyncCommand {
        if let labelOrReminder = remapLabelOrReminderCommand(ids: mapping) {
            return labelOrReminder
        }
        switch self {
        case .filterAdd(let args):
            return .filterAdd(args)
        case .filterUpdate(let args):
            return .filterUpdate(
                FilterUpdateArgs(
                    id: mapping[args.id] ?? args.id,
                    name: args.name,
                    query: args.query,
                    color: args.color,
                    item_order: args.item_order,
                    is_favorite: args.is_favorite
                )
            )
        case .filterDelete(let args):
            return .filterDelete(FilterDeleteArgs(id: mapping[args.id] ?? args.id))
        case .taskAdd, .taskUpdate, .taskDelete, .taskComplete, .taskUncomplete, .taskReorder,
            .projectAdd, .projectUpdate, .projectDelete, .sectionAdd, .sectionUpdate,
            .sectionDelete, .labelAdd, .labelUpdate, .labelDelete, .reminderAdd, .reminderUpdate,
            .reminderDelete:
            return self
        }
    }

    private func remapLabelOrReminderCommand(ids mapping: [String: String]) -> SyncCommand? {
        switch self {
        case .labelAdd(let args):
            return .labelAdd(args)
        case .labelUpdate(let args):
            return .labelUpdate(
                LabelUpdateArgs(
                    id: mapping[args.id] ?? args.id,
                    name: args.name,
                    color: args.color,
                    item_order: args.item_order,
                    is_favorite: args.is_favorite
                )
            )
        case .labelDelete(let args):
            return .labelDelete(LabelDeleteArgs(id: mapping[args.id] ?? args.id))
        case .reminderAdd(let args):
            return .reminderAdd(
                ReminderAddArgs(
                    task_id: mapping[args.task_id] ?? args.task_id,
                    reminder_type: args.reminder_type,
                    minute_offset: args.minute_offset,
                    due_datetime: args.due_datetime
                )
            )
        case .reminderUpdate(let args):
            return .reminderUpdate(
                ReminderUpdateArgs(
                    id: mapping[args.id] ?? args.id,
                    reminder_type: args.reminder_type,
                    minute_offset: args.minute_offset,
                    due_datetime: args.due_datetime,
                    is_notified: args.is_notified
                )
            )
        case .reminderDelete(let args):
            return .reminderDelete(ReminderDeleteArgs(id: mapping[args.id] ?? args.id))
        case .taskAdd, .taskUpdate, .taskDelete, .taskComplete, .taskUncomplete, .taskReorder,
            .projectAdd, .projectUpdate, .projectDelete, .sectionAdd, .sectionUpdate,
            .sectionDelete, .filterAdd, .filterUpdate, .filterDelete:
            return nil
        }
    }

    private static func remapNullableId(_ raw: String?, ids mapping: [String: String]) -> String? {
        guard let raw else { return nil }
        if raw.isEmpty { return "" }
        return mapping[raw] ?? raw
    }

    private static func remapTaskAdd(
        _ args: TaskAddArgs,
        ids mapping: [String: String]
    ) -> TaskAddArgs {
        TaskAddArgs(
            title: args.title,
            project_id: args.project_id.isEmpty
                ? "" : (mapping[args.project_id] ?? args.project_id),
            section_id: Self.remapNullableId(args.section_id, ids: mapping),
            parent_id: Self.remapNullableId(args.parent_id, ids: mapping),
            description: args.description,
            priority: args.priority,
            child_order: args.child_order,
            due_date: args.due_date,
            due_datetime: args.due_datetime,
            due_timezone: args.due_timezone,
            due_string: args.due_string,
            recurrence_rule: args.recurrence_rule,
            label_ids: args.label_ids?.map { mapping[$0] ?? $0 }
        )
    }

    private static func remapTaskUpdate(
        _ args: TaskUpdateArgs,
        ids mapping: [String: String]
    ) -> TaskUpdateArgs {
        TaskUpdateArgs(
            id: mapping[args.id] ?? args.id,
            title: args.title,
            description: args.description,
            priority: args.priority,
            project_id: Self.remapNullableId(args.project_id, ids: mapping),
            section_id: Self.remapNullableId(args.section_id, ids: mapping),
            parent_id: Self.remapNullableId(args.parent_id, ids: mapping),
            child_order: args.child_order,
            due_date: args.due_date,
            due_datetime: args.due_datetime,
            due_timezone: args.due_timezone,
            due_string: args.due_string,
            recurrence_rule: args.recurrence_rule,
            label_ids: args.label_ids?.map { mapping[$0] ?? $0 }
        )
    }
}
