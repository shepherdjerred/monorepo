import Foundation

extension FacetLocalStore {
    // MARK: - Filters / Saved Views

    @discardableResult
    public func addFilter(
        name: String,
        query: String,
        color: String? = nil,
        isFavorite: Bool = false
    ) -> Filter {
        let tempId = "tmp-\(UUID().uuidString.lowercased())"
        let order = (filters.map(\.item_order).max() ?? 0) + 1
        let filter = Filter(
            id: tempId,
            user_id: "",
            name: name,
            query: query,
            color: color ?? "charcoal",
            item_order: order,
            is_favorite: isFavorite,
            is_deleted: false
        )
        filters.append(filter)
        let args = FilterAddArgs(
            name: name,
            query: query,
            color: color,
            item_order: order,
            is_favorite: isFavorite
        )
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: tempId, command: .filterAdd(args))
        )
        schedulePersistence()
        return filter
    }

    public func updateFilter(
        id: String,
        name: String? = nil,
        query: String? = nil,
        color: String? = nil,
        isFavorite: FacetFieldPatch<Bool> = .unchanged
    ) {
        let wireFavorite =
            isFavorite == .set(true) ? true : (isFavorite == .set(false) ? false : nil)
        let args = FilterUpdateArgs(
            id: id,
            name: name,
            query: query,
            color: color,
            item_order: nil,
            is_favorite: wireFavorite
        )
        applyFilterUpdate(args)
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: nil, command: .filterUpdate(args))
        )
        schedulePersistence()
    }

    public func deleteFilter(id: String) {
        filters.removeAll(where: { $0.id == id })
        outbox.append(
            QueuedCommand(
                uuid: UUID().uuidString,
                temp_id: nil,
                command: .filterDelete(FilterDeleteArgs(id: id))
            )
        )
        schedulePersistence()
    }

    // MARK: - Undo

    internal func replaySchedules(_ entries: [TaskScheduleEntry], now: String) {
        for entry in entries {
            if let index = tasks.firstIndex(where: { $0.id == entry.id }) {
                let patch = FacetTaskPatch(
                    dueDate: Self.wirePatch(from: entry.due_date),
                    dueDatetime: Self.wirePatch(from: entry.due_datetime),
                    dueTimezone: Self.wirePatch(from: entry.due_timezone),
                    dueString: Self.wirePatch(from: entry.due_string))
                tasks[index] = tasks[index].applying(patch: patch, updatedAt: now)
            }
        }
    }

    /// A group move creates one undo receipt. Its inverse only touches scheduling fields.
    public func rescheduleTasks(_ changes: [(id: String, patch: FacetTaskPatch)]) {
        var previous: [Task] = []
        var entries: [TaskScheduleEntry] = []
        for change in changes {
            guard
                let task = tasks.first(where: {
                    $0.id == change.id && !$0.is_deleted && !$0.completed
                })
            else { continue }
            previous.append(task)
            let fields = change.patch.makeWireArgs(id: task.id)
            entries.append(
                TaskScheduleEntry(
                    id: task.id, due_date: fields.due_date,
                    due_datetime: fields.due_datetime, due_timezone: fields.due_timezone,
                    due_string: fields.due_string))
        }
        if let receipt = applySchedules(entries) {
            pushUndo(
                FacetUndoEntry(
                    id: receipt, summary: "Rescheduled tasks",
                    action: .restoreSchedules(previous: previous)))
        }
    }

    @discardableResult
    private func applySchedules(_ entries: [TaskScheduleEntry]) -> String? {
        guard !entries.isEmpty else { return nil }
        let command = QueuedCommand(
            uuid: UUID().uuidString, temp_id: nil,
            command: .taskReschedule(TaskRescheduleArgs(tasks: entries)))
        replayQueuedOutbox([command])
        outbox.append(command)
        schedulePersistence()
        return command.uuid
    }

    @discardableResult
    public func undoLast() -> FacetUndoEntry? {
        guard let entry = undoStack.popLast() else { return nil }
        switch entry.action {
        case .deleteCreatedTask(let taskId):
            deleteTask(id: taskId, recordUndo: false)
        case .uncompleteTask(let taskId):
            uncompleteTask(id: taskId, recordUndo: false)
        case .completeTask(let taskId):
            completeTask(id: taskId, recordUndo: false)
        case .restoreTaskSnapshot(let previous, let wasEndedRecurring):
            restoreSnapshot(previous, wasEndedRecurring: wasEndedRecurring)
        case .recreateDeletedTask(let snapshot):
            recreateDeletedSnapshot(snapshot)
        case .moveTasks(let previous):
            moveTasks(previous, recordUndo: false)
        case .restoreSchedules(let previous):
            applySchedules(
                previous.compactMap { task in
                    guard tasks.contains(where: { $0.id == task.id && !$0.is_deleted }) else {
                        return nil
                    }
                    return TaskScheduleEntry(
                        id: task.id, due_date: task.due_date ?? "",
                        due_datetime: task.due_datetime ?? "",
                        due_timezone: task.due_timezone ?? "", due_string: task.due_string ?? "")
                })
        }
        return entry
    }

    private func restoreSnapshot(_ previous: Task, wasEndedRecurring: Bool) {
        if wasEndedRecurring {
            uncompleteTask(id: previous.id, recordUndo: false)
        }
        let patch = FacetTaskPatch(
            title: previous.title,
            description: previous.description,
            priority: previous.priority,
            projectId: previous.project_id,
            sectionId: previous.section_id.map(FacetFieldPatch.set) ?? .clear,
            parentId: previous.parent_id.map(FacetFieldPatch.set) ?? .clear,
            childOrder: previous.child_order,
            dueDate: previous.due_date.map(FacetFieldPatch.set) ?? .clear,
            dueDatetime: previous.due_datetime.map(FacetFieldPatch.set) ?? .clear,
            dueTimezone: previous.due_timezone.map(FacetFieldPatch.set) ?? .clear,
            dueString: previous.due_string.map(FacetFieldPatch.set) ?? .clear,
            deadline: previous.deadline.map(FacetFieldPatch.set) ?? .clear,
            recurrenceBasis: previous.recurrence_basis ?? .scheduled,
            recurrenceRule: previous.recurrence_rule.map(FacetFieldPatch.set) ?? .clear,
            labelIds: .set(previous.label_ids)
        )
        updateTask(id: previous.id, patch: patch, recordUndo: false)
    }

    private func recreateDeletedSnapshot(_ snapshot: Task) {
        if !tasks.contains(where: { $0.id == snapshot.id }) {
            tasks.append(snapshot)
        }
        var restore = FacetTaskPatch()
        restore.restoreDeleted = true
        updateTask(id: snapshot.id, patch: restore, recordUndo: false)
    }
}
