public import Foundation
internal import Synchronization
import Testing

@testable import TaskNotesKit

/// Test mock URLProtocol for intercepting URLSession requests.
final class MockURLProtocol: URLProtocol {
    private static let lock = Mutex<
        [String: @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)]
    >([:])

    static func register(
        id: String,
        handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)
    ) {
        lock.withLock { $0[id] = handler }
    }

    private static func handler(for id: String) -> (
        @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)
    )? {
        lock.withLock { $0[id] }
    }

    override static func canInit(with request: URLRequest) -> Bool { true }
    override static func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let sessionId = request.value(forHTTPHeaderField: "X-Mock-Session-ID") ?? ""
        guard let handler = Self.handler(for: sessionId) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

// MARK: - Test Helpers

private func makeHTTPResponse(statusCode: Int = 200, url: URL? = nil) -> HTTPURLResponse {
    HTTPURLResponse(
        url: url ?? URL(string: "https://api.tasknotes.app")!,
        statusCode: statusCode,
        httpVersion: "HTTP/1.1",
        headerFields: ["Content-Type": "application/json"]
    )!
}

private func makeClient(
    token: String? = "secret-token",
    handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)
) -> FacetAPIClient {
    let sessionId = UUID().uuidString
    MockURLProtocol.register(id: sessionId, handler: handler)
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [MockURLProtocol.self]
    config.httpAdditionalHeaders = ["X-Mock-Session-ID": sessionId]
    let session = URLSession(configuration: config)
    return FacetAPIClient(
        baseURL: URL(string: "https://api.tasknotes.app")!, authToken: token, session: session)
}

private func makeTask(
    id: String,
    title: String = "Test Task",
    projectId: String = "proj-1",
    priority: Priority = .p4,
    completed: Bool = false,
    isDeleted: Bool = false
) -> Task {
    Task(
        id: id,
        user_id: "user-1",
        project_id: projectId,
        section_id: nil,
        parent_id: nil,
        title: title,
        description: "",
        priority: priority,
        child_order: 0.0,
        due_date: nil,
        due_datetime: nil,
        due_timezone: nil,
        due_string: nil,
        is_recurring: false,
        recurrence_rule: nil,
        completed: completed,
        completed_at: completed ? "2026-11-15T00:00:00Z" : nil,
        is_deleted: isDeleted,
        created_at: "2026-11-15T00:00:00Z",
        updated_at: "2026-11-15T00:00:00Z"
    )
}

private func makeProject(
    id: String,
    name: String = "Project",
    isDeleted: Bool = false
) -> Project {
    Project(
        id: id,
        user_id: "user-1",
        name: name,
        color: "charcoal",
        parent_id: nil,
        child_order: 0.0,
        is_inbox: false,
        is_favorite: false,
        is_archived: false,
        is_deleted: isDeleted,
        created_at: "2026-11-15T00:00:00Z",
        updated_at: "2026-11-15T00:00:00Z"
    )
}

private func makeDeltaSyncResponse() -> SyncResponse {
    SyncResponse(
        sync_token: "token-v2",
        full_sync: false,
        temp_id_mapping: [:],
        sync_status: [:],
        tasks: [
            makeTask(id: "task-1", title: "Task 1 Updated", priority: .p1, completed: true),
            makeTask(id: "task-2", isDeleted: true),
            makeTask(id: "task-3", title: "Task 3 New", priority: .p2),
        ],
        projects: [makeProject(id: "proj-1", name: "Project Updated")],
        sections: [
            Section(
                id: "s1",
                project_id: "proj-1",
                user_id: "u1",
                name: "Backlog",
                section_order: 1.0,
                is_archived: false,
                is_deleted: false,
                created_at: "",
                updated_at: ""
            )
        ],
        labels: [
            Label(
                id: "l1",
                user_id: "u1",
                name: "bug",
                color: "red",
                item_order: 1.0,
                is_favorite: false,
                is_deleted: false
            )
        ],
        reminders: [],
        filters: []
    )
}

// MARK: - Test Suites

@Suite("Facet Sync and Store Tests", .serialized)
@MainActor
struct FacetSyncTests {
    @Test("Offline task creation assigns temporary ID and queues outbox command")
    func offlineTaskCreationAndOutbox() {
        let store = FacetLocalStore()
        let task = store.addTask(title: "Buy groceries", projectId: "proj-inbox", priority: .p2)

        #expect(task.title == "Buy groceries")
        #expect(task.project_id == "proj-inbox")
        #expect(task.priority == .p2)
        #expect(task.id.hasPrefix("tmp-"))
        #expect(!task.completed)
        #expect(store.tasks.count == 1)
        #expect(store.outbox.count == 1)

        let queued = store.outbox[0]
        #expect(queued.temp_id == task.id)
        if case .taskAdd(let args) = queued.command {
            #expect(args.title == "Buy groceries")
            #expect(args.project_id == "proj-inbox")
            #expect(args.priority == .p2)
        } else {
            Issue.record("Expected .taskAdd command in outbox")
        }
    }

    @Test("Offline mutations queue completion, uncompletion, deletion, and projects")
    func offlineMutations() {
        let store = FacetLocalStore()
        let task = store.addTask(title: "Finish report", projectId: "proj-1")

        store.completeTask(id: task.id)
        #expect(store.tasks.first?.completed == true)
        if case .taskComplete(let args) = store.outbox[1].command {
            #expect(args.id == task.id)
        } else {
            Issue.record("Expected .taskComplete command in outbox")
        }

        store.uncompleteTask(id: task.id)
        #expect(store.tasks.first?.completed == false)
        if case .taskUncomplete(let args) = store.outbox[2].command {
            #expect(args.id == task.id)
        } else {
            Issue.record("Expected .taskUncomplete command in outbox")
        }

        store.deleteTask(id: task.id)
        #expect(store.tasks.isEmpty)
        if case .taskDelete(let args) = store.outbox[3].command {
            #expect(args.id == task.id)
        } else {
            Issue.record("Expected .taskDelete command in outbox")
        }

        let project = store.addProject(name: "Work", color: "blue")
        #expect(project.name == "Work")
        #expect(store.projects.count == 1)
        if case .projectAdd(let args) = store.outbox[4].command {
            #expect(args.name == "Work")
            #expect(args.color == "blue")
        } else {
            Issue.record("Expected .projectAdd command in outbox")
        }
    }

    @Test("Sync reconciliation replaces temporary IDs with server UUIDs and drains outbox")
    func syncResponseReconciliationWithTempIdMapping() async throws {
        let store = FacetLocalStore()
        let localTask = store.addTask(
            title: "Implement sync", projectId: "tmp-proj-1", priority: .p1)
        let localProject = store.addProject(name: "Client Roadmap")

        let localTaskId = localTask.id
        let localProjectId = localProject.id

        let serverTaskId = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
        let serverProjectId = "c3a9f0e1-4c2a-41f2-953b-e0fa95861111"

        let client = makeClient { request in
            #expect(request.url?.path == "/api/v1/sync")
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret-token")

            let responsePayload = SyncResponse(
                sync_token: "token-v2",
                full_sync: false,
                temp_id_mapping: [
                    localTaskId: serverTaskId,
                    localProjectId: serverProjectId,
                    "tmp-proj-1": serverProjectId,
                ],
                sync_status: [:],
                tasks: [
                    makeTask(
                        id: serverTaskId, title: "Implement sync", projectId: serverProjectId,
                        priority: .p1)
                ],
                projects: [makeProject(id: serverProjectId, name: "Client Roadmap")],
                sections: [],
                labels: [],
                reminders: [],
                filters: []
            )
            let data = try JSONEncoder().encode(responsePayload)
            return (makeHTTPResponse(url: request.url), data)
        }

        try await store.sync(client: client)

        #expect(store.tasks.count == 1)
        #expect(store.tasks[0].id == serverTaskId)
        #expect(store.tasks[0].project_id == serverProjectId)
        #expect(store.projects.count == 1)
        #expect(store.projects[0].id == serverProjectId)
        #expect(store.outbox.isEmpty)
        #expect(store.syncToken == "token-v2")
    }

    @Test("Delta merging handles additions, field updates, and deletions for all entities")
    func deltaMergingAndDeletionHandling() async throws {
        let store = FacetLocalStore(
            tasks: [
                makeTask(id: "task-1", title: "Task 1"),
                makeTask(id: "task-2", title: "Task 2"),
            ],
            projects: [makeProject(id: "proj-1", name: "Initial Project")],
            syncToken: "token-v1"
        )

        let client = makeClient { request in
            let responsePayload = makeDeltaSyncResponse()
            let data = try JSONEncoder().encode(responsePayload)
            return (makeHTTPResponse(url: request.url), data)
        }

        try await store.sync(client: client)

        #expect(store.tasks.count == 2)
        #expect(store.tasks.first(where: { $0.id == "task-1" })?.title == "Task 1 Updated")
        #expect(store.tasks.first(where: { $0.id == "task-1" })?.completed == true)
        #expect(store.tasks.first(where: { $0.id == "task-2" }) == nil)
        #expect(store.tasks.first(where: { $0.id == "task-3" })?.title == "Task 3 New")
        #expect(store.projects.first?.name == "Project Updated")
        #expect(store.sections.count == 1)
        #expect(store.labels.count == 1)
        #expect(store.syncToken == "token-v2")
    }
}

@Suite("Facet API Client Direct Tests", .serialized)
struct FacetAPIClientDirectTests {
    @Test("FacetAPIClient fetchTasks sends GET /api/v1/tasks and decodes task array")
    func apiClientFetchTasks() async throws {
        let client = makeClient { request in
            #expect(request.url?.path == "/api/v1/tasks")
            #expect(request.httpMethod == "GET")
            let data = try JSONEncoder().encode([makeTask(id: "task-abc", title: "Test Task")])
            return (makeHTTPResponse(url: request.url), data)
        }

        let tasks = try await client.fetchTasks()
        #expect(tasks.count == 1)
        #expect(tasks[0].id == "task-abc")
    }

    @Test("FacetAPIClient createTask sends POST /api/v1/tasks and decodes created Task")
    func apiClientCreateTask() async throws {
        let client = makeClient { request in
            #expect(request.url?.path == "/api/v1/tasks")
            #expect(request.httpMethod == "POST")
            let data = try JSONEncoder().encode(makeTask(id: "server-id", title: "Server Task"))
            return (makeHTTPResponse(url: request.url), data)
        }

        let args = TaskAddArgs(
            title: "Server Task",
            project_id: "p1",
            section_id: nil,
            parent_id: nil,
            description: nil,
            priority: .p4,
            child_order: nil,
            due_date: nil,
            due_datetime: nil,
            due_timezone: nil,
            due_string: nil,
            recurrence_rule: nil
        )
        let task = try await client.createTask(args: args)
        #expect(task.id == "server-id")
    }

    @Test("FacetAPIClient throws badServerResponse error on 401 Unauthorized")
    func apiClientErrorHandling() async {
        let client = makeClient(token: nil) { request in
            let errorJson = Data(#"{"error":"Missing Authorization header"}"#.utf8)
            return (makeHTTPResponse(statusCode: 401, url: request.url), errorJson)
        }

        do {
            _ = try await client.fetchTasks()
            Issue.record("Expected error to be thrown")
        } catch let error as FacetAPIError {
            if case .badServerResponse(let code, let body) = error {
                #expect(code == 401)
                #expect(body.contains("Missing Authorization header"))
            } else {
                Issue.record("Expected .badServerResponse, got \(error)")
            }
        } catch {
            Issue.record("Unexpected error type: \(error)")
        }
    }
}
