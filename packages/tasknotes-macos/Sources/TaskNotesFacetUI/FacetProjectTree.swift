import Foundation
public import TaskNotesKit

extension FacetStore {
    internal var inactiveProjectIDs: Set<String> {
        let projects = localStore.projects
        var inactive = Set(projects.filter { $0.is_archived || $0.is_deleted }.map(\.id))
        let children = Dictionary(grouping: projects, by: \.parent_id)
        var pending = Array(inactive)
        while let id = pending.popLast() {
            for child in children[id, default: []] where inactive.insert(child.id).inserted {
                pending.append(child.id)
            }
        }
        return inactive
    }

    public var activeProjects: [Project] {
        let inactive = inactiveProjectIDs
        return localStore.projects
            .filter { !inactive.contains($0.id) }
            .sorted { lhs, rhs in
                if lhs.is_inbox != rhs.is_inbox { return lhs.is_inbox }
                if lhs.child_order != rhs.child_order { return lhs.child_order < rhs.child_order }
                return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
            }
    }

    public var userProjects: [Project] {
        let visible = activeProjects.filter { !$0.is_inbox }
        let rank = Dictionary(
            uniqueKeysWithValues: visible.enumerated().map { ($0.element.id, $0.offset) })
        let paths = visible.map { project in (project, projectPath(project).compactMap { rank[$0] })
        }
        return paths.sorted { $0.1.lexicographicallyPrecedes($1.1) }.map(\.0)
    }

    internal func projectPath(_ project: Project) -> [String] {
        var path = [project.id]
        var parent = project.parent_id
        while let id = parent, !path.contains(id), let ancestor = self.project(for: id) {
            path.append(id)
            parent = ancestor.parent_id
        }
        return path.reversed()
    }

    internal func resolveProjectPreferences() {
        let aliases = Set(projectLayouts.keys).union(projectSorts.keys).union(projectGroups.keys)
        for alias in aliases {
            let id = localStore.resolvedID(alias)
            guard id != alias else { continue }
            if let layout = projectLayouts.removeValue(forKey: alias), projectLayouts[id] == nil {
                projectLayouts[id] = layout
            }
            if let sort = projectSorts.removeValue(forKey: alias), projectSorts[id] == nil {
                projectSorts[id] = sort
            }
            if let group = projectGroups.removeValue(forKey: alias), projectGroups[id] == nil {
                projectGroups[id] = group
            }
        }
    }

    internal var archivedProjects: [Project] {
        let inactive = inactiveProjectIDs
        return localStore.projects.filter {
            $0.is_archived && !$0.is_deleted && !$0.is_inbox
                && $0.parent_id.map(inactive.contains) != true
        }
    }

    internal func archive(_ project: Project, archived: Bool) {
        localStore.updateProject(id: localStore.resolvedID(project.id), isArchived: .set(archived))
        if archived, case .project(let id) = destination,
            inactiveProjectIDs.contains(localStore.resolvedID(id))
        {
            destination = .section(.today)
        }
        scheduleAutoSync()
    }
}
