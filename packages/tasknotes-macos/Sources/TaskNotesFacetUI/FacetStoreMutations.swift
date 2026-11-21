import Foundation
public import TaskNotesKit

private struct CaptureCreationRequest {
    let rawInput: String
    var prepared: FacetParsedCapture?
    let description: String
    let overrideProjectId: String?
    let overrideSectionId: String?
    let overridePriority: Priority?
    let parentId: String?
}

extension FacetStore {
    public func boardColumns(forProject projectId: String) -> [FacetBoardColumn] {
        let groups = projectTaskGroups(projectId: projectId)
        var columns: [FacetBoardColumn] = []
        if !groups.contains(where: { $0.sectionId == nil }) {
            columns.append(
                FacetBoardColumn(
                    id: "board.\(projectId).none",
                    title: "No section",
                    target: .projectNoSection(projectId: projectId),
                    tasks: []
                )
            )
        }
        for group in groups {
            if let secId = group.sectionId {
                columns.append(
                    FacetBoardColumn(
                        id: "board.\(projectId).\(secId)",
                        title: group.title,
                        target: .projectSection(projectId: projectId, sectionId: secId),
                        tasks: group.tasks
                    )
                )
            } else {
                columns.append(
                    FacetBoardColumn(
                        id: "board.\(projectId).none",
                        title: "No section",
                        target: .projectNoSection(projectId: projectId),
                        tasks: group.tasks
                    )
                )
            }
        }
        return columns
    }

    public var priorityBoardColumns: [FacetBoardColumn] {
        let tasks = topLevelOpenTasks.filter(matchesSearch).sorted(by: Self.sortTasks)
        let specs = [
            PriorityBoardSpec(priority: .p1, title: "Priority 1", color: "red"),
            PriorityBoardSpec(priority: .p2, title: "Priority 2", color: "orange"),
            PriorityBoardSpec(priority: .p3, title: "Priority 3", color: "blue"),
            PriorityBoardSpec(priority: .p4, title: "Priority 4", color: "grey"),
        ]
        return specs.map { spec in
            FacetBoardColumn(
                id: "board.priority.\(spec.priority.rawValue)",
                title: spec.title,
                color: spec.color,
                target: .priority(spec.priority),
                tasks: tasks.filter { $0.priority == spec.priority }
            )
        }
    }

    @discardableResult
    public func createQuickTask(
        rawInput: String,
        description: String = "",
        overrideProjectId: String? = nil,
        overrideSectionId: String? = nil,
        overridePriority: Priority? = nil,
        prepared: FacetParsedCapture? = nil
    ) -> Task? {
        createCapturedTask(
            CaptureCreationRequest(
                rawInput: rawInput,
                prepared: prepared,
                description: description,
                overrideProjectId: overrideProjectId,
                overrideSectionId: overrideSectionId,
                overridePriority: overridePriority,
                parentId: nil
            )
        )
    }

    @discardableResult
    public func createSubtask(parentTask: Task, title: String) -> Task? {
        createCapturedTask(
            CaptureCreationRequest(
                rawInput: title,
                description: "",
                overrideProjectId: parentTask.project_id,
                overrideSectionId: parentTask.section_id,
                overridePriority: nil,
                parentId: parentTask.id
            )
        )
    }

    private func createCapturedTask(_ request: CaptureCreationRequest) -> Task? {
        let defaultProjId = request.overrideProjectId ?? defaultProjectIdForCurrentDestination()
        let parsed =
            request.prepared
            ?? FacetQuickCaptureParser.parse(
                request.rawInput,
                projects: activeProjects,
                sections: activeSections,
                labels: activeLabels,
                defaultProjectId: defaultProjId,
                calendar: calendar,
                defaultDueDate: defaultDueDateForCurrentDestination()
            )
        guard !parsed.isEmpty else { return nil }

        var resolvedLabelIds = parsed.labelIds.map(localStore.resolvedID)
        for labelName in parsed.unmatchedLabels {
            let createdLabel = localStore.addLabel(name: labelName)
            resolvedLabelIds.append(createdLabel.id)
        }

        let cleanDesc = request.description.trimmingCharacters(in: .whitespacesAndNewlines)
        let projectId = localStore.resolvedID(request.overrideProjectId ?? parsed.projectId)
        let sectionId = (parsed.sectionId ?? request.overrideSectionId).flatMap { section(for: $0) }
        let draft = FacetTaskDraft(
            title: parsed.title,
            projectId: projectId,
            sectionId: sectionId?.project_id == projectId ? sectionId?.id : nil,
            parentId: request.parentId.map(localStore.resolvedID),
            description: cleanDesc,
            priority: request.overridePriority ?? parsed.priority,
            dueDate: parsed.dueDate,
            dueDatetime: parsed.dueDatetime,
            dueTimezone: parsed.dueTimezone,
            dueString: parsed.dueString,
            recurrenceRule: parsed.recurrenceRule,
            labelIds: resolvedLabelIds
        )
        let task = localStore.addTask(draft)
        feedback.trigger(.created)
        presentUndoToast("Added \"\(task.title)\"")
        scheduleAutoSync()
        return task
    }

    public func toggleTaskCompletion(_ task: Task, animateListRemoval: Bool = false) {
        guard let current = self.task(for: task.id), current.completed == task.completed,
            current.due_date == task.due_date, current.due_datetime == task.due_datetime
        else { return }
        if task.completed {
            localStore.uncompleteTask(id: current.id)
            feedback.trigger(.reopened)
            presentUndoToast("Reopened \"\(task.title)\"")
        } else {
            localStore.completeTask(id: current.id, at: calendar.instant)
            feedback.trigger(.completed)
            presentUndoToast(
                task.is_recurring
                    ? "Completed occurrence of \"\(task.title)\""
                    : "Completed \"\(task.title)\""
            )
        }
        acknowledgeCompletion(of: current, animateRemoval: animateListRemoval)
        scheduleAutoSync()
    }

    public func patchTask(id: String, patch: FacetTaskPatch) {
        localStore.updateTask(id: localStore.resolvedID(id), patch: patch)
        scheduleAutoSync()
    }

    public func moveTaskOnBoard(taskId: String, to target: FacetBoardColumn.Target) {
        guard let existing = task(for: taskId) else { return }
        switch target {
        case .projectNoSection(let projectId):
            let maxOrder =
                topLevelOpenTasks
                .filter { $0.project_id == projectId && ($0.section_id ?? "").isEmpty }
                .map(\.child_order).max() ?? 0
            localStore.updateTask(
                id: existing.id,
                patch: FacetTaskPatch(projectId: projectId, sectionId: .clear)
            )
            localStore.reorderTask(id: existing.id, childOrder: maxOrder + 1)
        case .projectSection(let projectId, let sectionId):
            let maxOrder =
                topLevelOpenTasks
                .filter { $0.project_id == projectId && $0.section_id == sectionId }
                .map(\.child_order).max() ?? 0
            localStore.updateTask(
                id: existing.id,
                patch: FacetTaskPatch(projectId: projectId, sectionId: .set(sectionId))
            )
            localStore.reorderTask(id: existing.id, childOrder: maxOrder + 1)
        case .priority(let newPriority):
            let maxOrder =
                topLevelOpenTasks
                .filter { $0.priority == newPriority }
                .map(\.child_order).max() ?? 0
            localStore.updateTask(
                id: existing.id,
                patch: FacetTaskPatch(priority: newPriority)
            )
            localStore.reorderTask(id: existing.id, childOrder: maxOrder + 1)
        }
        scheduleAutoSync()
    }

    public func deleteTask(_ task: Task) {
        guard let current = self.task(for: task.id) else { return }
        if selectedTaskId == current.id {
            selectedTaskId = nil
            showsInspector = false
        }
        localStore.deleteTask(id: current.id)
        feedback.trigger(.deleted)
        presentUndoToast("Deleted \"\(task.title)\"")
        scheduleAutoSync()
    }

    @discardableResult
    public func createProject(name: String, color: String, isFavorite: Bool) -> Project {
        let project = localStore.addProject(name: name, color: color, isFavorite: isFavorite)
        scheduleAutoSync()
        return project
    }

    public func updateProject(id: String, name: String, color: String, isFavorite: Bool) {
        localStore.updateProject(
            id: localStore.resolvedID(id),
            name: name,
            color: color,
            isFavorite: .set(isFavorite)
        )
        scheduleAutoSync()
    }

    public func toggleProjectFavorite(_ project: Project) {
        localStore.updateProject(
            id: localStore.resolvedID(project.id),
            isFavorite: .set(!project.is_favorite)
        )
        scheduleAutoSync()
    }

    public func deleteProject(id: String) {
        let resolved = localStore.resolvedID(id)
        if destination == .project(id: resolved) {
            destination = .section(.today)
        }
        localStore.deleteProject(id: resolved)
        scheduleAutoSync()
    }

    @discardableResult
    public func createSection(projectId: String, name: String) -> TaskNotesKit.Section {
        let section = localStore.addSection(projectId: localStore.resolvedID(projectId), name: name)
        scheduleAutoSync()
        return section
    }

    public func renameSection(id: String, name: String) {
        localStore.updateSection(id: localStore.resolvedID(id), name: name)
        scheduleAutoSync()
    }

    public func deleteSection(id: String) {
        localStore.deleteSection(id: localStore.resolvedID(id))
        scheduleAutoSync()
    }

    @discardableResult
    public func createLabel(name: String, color: String, isFavorite: Bool) -> TaskNotesKit.Label {
        let label = localStore.addLabel(name: name, color: color, isFavorite: isFavorite)
        scheduleAutoSync()
        return label
    }

    public func deleteLabel(id: String) {
        let resolved = localStore.resolvedID(id)
        if destination == .label(id: resolved) {
            destination = .section(.today)
        }
        localStore.deleteLabel(id: resolved)
        scheduleAutoSync()
    }

    @discardableResult
    public func createFilter(name: String, query: String, color: String, isFavorite: Bool) -> Filter
    {
        let filter = localStore.addFilter(
            name: name,
            query: query,
            color: color,
            isFavorite: isFavorite
        )
        scheduleAutoSync()
        return filter
    }

    public func deleteFilter(id: String) {
        let resolved = localStore.resolvedID(id)
        if destination == .filter(id: resolved) {
            destination = .section(.today)
        }
        localStore.deleteFilter(id: resolved)
        scheduleAutoSync()
    }

    public func defaultProjectIdForCurrentDestination(_ target: FacetDestination? = nil) -> String {
        if case .project(let projectId) = resolvedDestination(target ?? destination) {
            return projectId
        }
        return inboxProject?.id ?? ""
    }

    internal func defaultDueDateForCurrentDestination(_ target: FacetDestination? = nil) -> String?
    {
        if case .section(.upcoming) = target ?? destination {
            return upcomingSelectedDate ?? calendar.today
        }
        if case .section(.today) = target ?? destination {
            return calendar.today
        }
        return nil
    }
}
