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
        if let index = filters.firstIndex(where: { $0.id == id }) {
            let current = filters[index]
            filters[index] = Filter(
                id: current.id,
                user_id: current.user_id,
                name: name ?? current.name,
                query: query ?? current.query,
                color: color ?? current.color,
                item_order: current.item_order,
                is_favorite: wireFavorite ?? current.is_favorite,
                is_deleted: current.is_deleted
            )
        }
        let args = FilterUpdateArgs(
            id: id,
            name: name,
            query: query,
            color: color,
            item_order: nil,
            is_favorite: wireFavorite
        )
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
            recurrenceRule: previous.recurrence_rule.map(FacetFieldPatch.set) ?? .clear,
            labelIds: .set(previous.label_ids)
        )
        updateTask(id: previous.id, patch: patch, recordUndo: false)
    }

    private func recreateDeletedSnapshot(_ snapshot: Task) {
        let created = addTask(
            FacetTaskDraft(
                title: snapshot.title,
                projectId: snapshot.project_id,
                sectionId: snapshot.section_id,
                parentId: snapshot.parent_id,
                description: snapshot.description,
                priority: snapshot.priority,
                childOrder: snapshot.child_order,
                dueDate: snapshot.due_date,
                dueDatetime: snapshot.due_datetime,
                dueTimezone: snapshot.due_timezone,
                dueString: snapshot.due_string,
                recurrenceRule: snapshot.recurrence_rule,
                labelIds: snapshot.label_ids
            ),
            recordUndo: false
        )
        if snapshot.completed {
            completeTask(id: created.id, recordUndo: false)
        }
    }
}
