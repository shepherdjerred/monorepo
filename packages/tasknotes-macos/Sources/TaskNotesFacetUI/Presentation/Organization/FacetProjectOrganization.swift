import SwiftUI
import TaskNotesKit

enum FacetProjectSort: String, CaseIterable {
    case manual = "Manual order"
    case title = "Title"
    case priority = "Priority"
}

enum FacetProjectGrouping: String, CaseIterable {
    case section = "Section"
    case priority = "Priority"
}

extension FacetStore {
    public func layout(forProject projectId: String) -> FacetProjectLayout {
        let id = localStore.resolvedID(projectId)
        return projectLayouts[id]
            ?? projectLayouts.first { localStore.resolvedID($0.key) == id }?.value
            ?? .list
    }

    public func setLayout(_ layout: FacetProjectLayout, forProject projectId: String) {
        projectLayouts[localStore.resolvedID(projectId)] = layout
    }

    private func preference(for id: String, values: [String: String]) -> String {
        let resolved = localStore.resolvedID(id)
        return values[resolved] ?? values.first { localStore.resolvedID($0.key) == resolved }?.value
            ?? ""
    }

    func projectSort(_ id: String) -> FacetProjectSort {
        FacetProjectSort(rawValue: preference(for: id, values: projectSorts)) ?? .manual
    }

    func projectGrouping(_ id: String) -> FacetProjectGrouping {
        FacetProjectGrouping(rawValue: preference(for: id, values: projectGroups)) ?? .section
    }

    func displayedProjectGroups(_ id: String, tasks: [Task]) -> [FacetTaskGroup] {
        let groups = projectTaskGroups(projectId: id, from: tasks)
        let grouped: [FacetTaskGroup]
        switch projectGrouping(id) {
        case .section: grouped = groups
        case .priority:
            let all = groups.flatMap(\.tasks)
            grouped = Priority.allCases.compactMap { priority in
                let matches = all.filter { $0.priority == priority }
                guard !matches.isEmpty else { return nil }
                return FacetTaskGroup(
                    id: priority.rawValue, title: FacetNativeStyle.priorityFullTitle(priority),
                    tasks: matches)
            }
        }
        let sort = projectSort(id)
        return grouped.map { group in
            let ordered = group.tasks.sorted { lhs, rhs in
                if sort == .title {
                    let result = lhs.title.localizedStandardCompare(rhs.title)
                    if result != .orderedSame { return result == .orderedAscending }
                }
                if sort == .priority, lhs.priority != rhs.priority {
                    return lhs.priority.rawValue < rhs.priority.rawValue
                }
                return Self.sortTasks(lhs, rhs)
            }
            return FacetTaskGroup(
                id: group.id, title: group.title, sectionId: group.sectionId, tasks: ordered)
        }
    }

    func reorderProjectTasks(
        _ group: [Task], from source: IndexSet, to destination: Int, project: String
    ) {
        var tasks = group
        tasks.move(fromOffsets: source, toOffset: destination)
        let moves = tasks.enumerated().compactMap { index, task -> TaskMoveEntry? in
            let order = Double(index + 1)
            guard order != task.child_order else { return nil }
            return TaskMoveEntry(
                id: task.id, project_id: task.project_id, section_id: task.section_id,
                parent_id: task.parent_id, child_order: order)
        }
        guard !moves.isEmpty else { return }
        localStore.moveTasks(moves)
        projectSorts[localStore.resolvedID(project)] = FacetProjectSort.manual.rawValue
        presentUndoToast("Reordered tasks")
        scheduleAutoSync()
    }

    func moveTaskTrees(_ roots: Set<String>, to project: String, sectionId: String? = nil) {
        let destination = localStore.resolvedID(project)
        let section = sectionId.map(localStore.resolvedID)
        guard self.project(for: destination) != nil, !inactiveProjectIDs.contains(destination),
            section == nil || section.flatMap({ self.section(for: $0)?.project_id }) == destination
        else { return }
        let tasks = localStore.tasks.filter { !$0.is_deleted }
        let children = Dictionary(grouping: tasks, by: \.parent_id)
        var pending = roots.map(localStore.resolvedID)
        var moved = Set<String>()
        while let id = pending.popLast() {
            guard moved.insert(id).inserted else { continue }
            pending.append(contentsOf: children[id, default: []].map(\.id))
        }
        let destinationIDs = Set(tasks.filter { $0.project_id == destination }.map(\.id))
        var order =
            tasks.filter {
                $0.project_id == destination && $0.section_id == section && $0.parent_id == nil
            }.map(\.child_order).max() ?? 0
        let entries = tasks.filter { moved.contains($0.id) }.sorted(by: Self.sortTasks).map {
            task in
            let parent = task.parent_id.flatMap {
                moved.contains($0) || destinationIDs.contains($0) ? $0 : nil
            }
            if parent == nil { order += 1 }
            return TaskMoveEntry(
                id: task.id, project_id: destination, section_id: section,
                parent_id: parent, child_order: parent == nil ? order : task.child_order)
        }
        guard !entries.isEmpty else { return }
        localStore.moveTasks(entries)
        presentUndoToast(entries.count == 1 ? "Moved task" : "Moved \(entries.count) tasks")
        scheduleAutoSync()
    }
}

struct FacetOrganizeTasksSheet: View {
    let project: String
    let store: FacetStore
    @State private var selected = Set<String>()
    @Environment(\.dismiss) private var dismiss

    private func reorder(_ index: Int, in group: FacetTaskGroup, direction: Int) {
        store.reorderProjectTasks(
            group.tasks, from: IndexSet(integer: index),
            to: direction < 0 ? index - 1 : index + 2, project: project)
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(store.projectTaskGroups(projectId: store.localStore.resolvedID(project))) {
                    group in
                    SwiftUI.Section(group.title) {
                        ForEach(group.tasks) { task in
                            Button {
                                if !selected.insert(task.id).inserted { selected.remove(task.id) }
                            } label: {
                                Label(
                                    task.title,
                                    systemImage: selected.contains(task.id)
                                        ? "checkmark.circle.fill" : "circle")
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(selected.contains(task.id) ? [.isSelected] : [])
                            .contextMenu {
                                if let index = group.tasks.firstIndex(where: { $0.id == task.id }) {
                                    Button("Move Up") { reorder(index, in: group, direction: -1) }
                                        .disabled(index == 0)
                                    Button("Move Down") { reorder(index, in: group, direction: 1) }
                                        .disabled(index + 1 == group.tasks.count)
                                }
                            }
                        }
                        .onMove { source, destination in
                            store.reorderProjectTasks(
                                group.tasks, from: source, to: destination, project: project)
                        }
                    }
                }
            }
            .navigationTitle("Organize Tasks")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                #if os(iOS)
                    ToolbarItem { EditButton() }
                #endif
                ToolbarItem {
                    Menu("Move to Project") {
                        ForEach(
                            store.activeProjects.filter {
                                $0.id != store.localStore.resolvedID(project)
                            }
                        ) { target in
                            Button(target.name) {
                                store.moveTaskTrees(selected, to: target.id)
                                dismiss()
                            }
                        }
                    }
                    .disabled(selected.isEmpty)
                }
            }
        }
        #if os(macOS)
            .frame(minWidth: 420, minHeight: 360)
        #endif
    }
}
