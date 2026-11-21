import Foundation
import TaskNotesKit
import Testing

@testable import TaskNotesFacetUI

@MainActor
struct FacetProjectOrganizationTests {
    @Test("Moving a selection includes descendants and preserves their hierarchy")
    func moveTaskTrees() throws {
        let local = FacetLocalStore(database: try FacetSQLiteDatabase(inMemoryNamed: ":memory:"))
        let store = FacetStore(localStore: local)
        let source = local.addProject(name: "Studio")
        let destination = local.addProject(name: "Home")
        let parent = local.addTask(FacetTaskDraft(title: "Frame print", projectId: source.id))
        let child = local.addTask(
            FacetTaskDraft(title: "Cut mat", projectId: source.id, parentId: parent.id))
        let other = local.addTask(FacetTaskDraft(title: "Order ink", projectId: source.id))
        let before = local.outbox.count
        store.moveTaskTrees([parent.id, other.id], to: destination.id)
        #expect(local.outbox.count == before + 1)
        #expect(store.task(for: parent.id)?.project_id == destination.id)
        #expect(store.task(for: child.id)?.project_id == destination.id)
        #expect(store.task(for: child.id)?.parent_id == parent.id)
        #expect(store.task(for: other.id)?.project_id == destination.id)
        local.updateTask(
            id: child.id, patch: FacetTaskPatch(title: "Updated mat"), recordUndo: false)
        local.undoLast()
        #expect(store.task(for: child.id)?.title == "Updated mat")
        #expect(local.tasks.allSatisfy { $0.project_id == source.id })
        store.moveTaskTrees([child.id], to: destination.id)
        #expect(store.task(for: child.id)?.parent_id == nil)
        #expect(store.task(for: parent.id)?.project_id == source.id)
    }

    @Test("Archiving a parent hides nested projects and their daily tasks until restored")
    func archiveTree() throws {
        let local = FacetLocalStore(database: try FacetSQLiteDatabase(inMemoryNamed: ":memory:"))
        let store = FacetStore(localStore: local)
        let parent = local.addProject(name: "Studio")
        let child = local.addProject(name: "Prints", parentId: parent.id)
        let task = local.addTask(
            FacetTaskDraft(title: "Proof", projectId: child.id, dueDate: store.calendar.today))
        store.destination = .project(id: child.id)
        store.updateProject(
            id: parent.id, name: parent.name, color: parent.color, isFavorite: false,
            parentId: .set(child.id))
        #expect(store.project(for: parent.id)?.parent_id == nil)
        store.archive(parent, archived: true)
        #expect(store.destination == .section(.today))
        #expect(store.workspaceTasks(matching: "Proof", includeCompleted: true).isEmpty)
        #expect(!store.userProjects.contains { $0.id == child.id })
        #expect(!store.openListPresentationTasks.contains { $0.id == task.id })
        store.archive(parent, archived: false)
        #expect(store.userProjects.map(\.id).contains(child.id))
        #expect(store.todayGroups.flatMap(\.tasks).contains { $0.id == task.id })
        local.updateProject(id: child.id, parentId: .clear)
        #expect(store.project(for: child.id)?.parent_id == nil)
    }
    @Test("Reopening retains layout, grouping and sorting for each project")
    func reopenPreferences() throws {
        let suite = UUID().uuidString
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let local = FacetLocalStore(database: try FacetSQLiteDatabase(inMemoryNamed: ":memory:"))
        let project = local.addProject(name: "Studio")
        let other = local.addProject(name: "Home")
        let store = FacetStore(localStore: local, defaults: defaults)
        store.setLayout(.board, forProject: project.id)
        store.projectGroups[project.id] = FacetProjectGrouping.priority.rawValue
        store.projectSorts[project.id] = FacetProjectSort.title.rawValue
        let tasks = ["Zulu", "Alpha"].map {
            local.addTask(FacetTaskDraft(title: $0, projectId: project.id, priority: .p1))
        }
        let reopened = FacetStore(
            localStore: local, defaults: try #require(UserDefaults(suiteName: suite)))
        #expect(reopened.layout(forProject: project.id) == .board)
        #expect(reopened.projectGrouping(project.id) == .priority)
        #expect(reopened.projectSort(project.id) == .title)
        #expect(
            reopened.displayedProjectGroups(project.id, tasks: tasks).flatMap(\.tasks).map(\.title)
                == ["Alpha", "Zulu"])
        let columns = reopened.boardColumns(forProject: project.id)
        let first = try #require(columns.first { $0.target == .priority(.p1) })
        #expect(first.tasks.map(\.title) == ["Alpha", "Zulu"])
        #expect(columns.count == Priority.allCases.count)
        let before = local.outbox.count
        reopened.reorderProjectTasks(tasks, from: IndexSet(integer: 1), to: 0, project: project.id)
        #expect(local.outbox.count == before + 1)
        #expect(reopened.projectSort(project.id) == .manual)
        #expect(
            reopened.boardColumns(forProject: project.id).flatMap(\.tasks).map(\.title) == [
                "Alpha", "Zulu",
            ])
        local.undoLast()
        #expect(
            reopened.boardColumns(forProject: project.id).flatMap(\.tasks).map(\.title) == [
                "Zulu", "Alpha",
            ])
        #expect(reopened.layout(forProject: other.id) == .list)
        #expect(reopened.projectSort(other.id) == .manual)
    }
}
