import Foundation

extension TaskMoveEntry {
    internal func remapped(using mapping: [String: String]) -> Self {
        Self(
            id: mapping[id] ?? id, project_id: mapping[project_id] ?? project_id,
            section_id: section_id.map { mapping[$0] ?? $0 },
            parent_id: parent_id.map { mapping[$0] ?? $0 }, child_order: child_order)
    }
}

extension FacetLocalStore {
    /// Queue the entire move as a single transaction and retain only placement fields for Undo.
    public func moveTasks(_ entries: [TaskMoveEntry], recordUndo: Bool = true) {
        let byID = Dictionary(
            uniqueKeysWithValues: tasks.filter { !$0.is_deleted }.map { ($0.id, $0) })
        let present = entries.filter { byID[$0.id] != nil }
        guard !present.isEmpty else { return }
        let command = QueuedCommand(
            uuid: UUID().uuidString, temp_id: nil, command: .taskMove(TaskMoveArgs(tasks: present)))
        if recordUndo {
            let previous = present.compactMap { entry -> TaskMoveEntry? in
                guard let task = byID[entry.id] else { return nil }
                return TaskMoveEntry(
                    id: task.id, project_id: task.project_id, section_id: task.section_id,
                    parent_id: task.parent_id, child_order: task.child_order)
            }
            pushUndo(
                FacetUndoEntry(
                    id: command.uuid, summary: "Moved tasks", action: .moveTasks(previous: previous)
                ))
        }
        replayMove(present, now: Self.nowTimestamp())
        outbox.append(command)
        schedulePersistence()
    }

    internal func replayMove(_ entries: [TaskMoveEntry], now: String) {
        let indices = Dictionary(uniqueKeysWithValues: tasks.indices.map { (tasks[$0].id, $0) })
        for entry in entries {
            guard let index = indices[entry.id] else { continue }
            let patch = FacetTaskPatch(
                projectId: entry.project_id,
                sectionId: entry.section_id.map(FacetFieldPatch.set) ?? .clear,
                parentId: entry.parent_id.map(FacetFieldPatch.set) ?? .clear,
                childOrder: entry.child_order)
            tasks[index] = tasks[index].applying(patch: patch, updatedAt: now)
        }
    }
}
