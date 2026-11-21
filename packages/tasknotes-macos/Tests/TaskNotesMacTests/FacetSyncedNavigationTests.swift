import TaskNotesKit
import TaskNotesTestSupport
import Testing

@testable import TaskNotesFacetUI

@MainActor
struct FacetSyncedNavigationTests {
    @Test("Open tasks, collections and search return survive successive sync batches")
    func preservesNavigation() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let api = FacetAPIClient(baseURL: server.baseURL, authToken: server.authToken)
        let local = FacetLocalStore()
        let store = FacetStore(localStore: local)
        let project = local.addProject(name: "Studio")
        let section = local.addSection(projectId: project.id, name: "Design")
        let label = local.addLabel(name: "next")
        let filter = local.addFilter(name: "Important", query: "p1")
        let task = local.addTask(FacetTaskDraft(title: "Review", projectId: project.id))
        let search = FacetWorkspaceSearchState()
        store.destination = .project(id: project.id)
        store.setLayout(.board, forProject: project.id)
        store.selectedTaskId = task.id
        store.showsInspector = true
        search.openedCollection = store.destination
        search.origin = .label(id: label.id)
        search.selectedResult = "task." + task.id

        try await local.sync(client: api)
        _ = local.addProject(name: "Second batch")
        try await local.sync(client: api)

        let projectID = try #require(store.project(for: project.id)?.id)
        let serverTask = try #require(store.task(for: task.id))
        #expect(projectID != project.id && serverTask.id != task.id)
        #expect(store.destination == .project(id: projectID))
        #expect(store.layout(forProject: projectID) == .board)
        #expect(store.selectedTaskId == serverTask.id && store.showsInspector)
        #expect(search.isShowingCollection(in: store))
        #expect(search.selectedResultID(in: store) == "task." + serverTask.id)
        #expect(store.section(for: section.id)?.project_id == projectID)

        store.toggleTaskCompletion(task)
        #expect(store.task(for: task.id)?.completed == true)
        store.destination = try #require(search.origin)
        #expect(store.destinationTitle == "@next")
        store.destination = .filter(id: filter.id)
        search.selectedResult = FacetDestination.filter(id: filter.id).id
        #expect(store.destinationTitle == "Important")
        #expect(search.selectedResultID(in: store) == store.destination.id)
    }
}
