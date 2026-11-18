import Foundation
import Synchronization
import TaskNotesKit
import TaskNotesTestSupport
import Testing

@Suite("FacetSQLiteDatabase and FacetLocalStore")
struct FacetSQLiteAndSyncTests {
    @Test("Persists all entity tables, outbox FIFO order, and sync_token across WAL relaunches")
    @MainActor
    func sqlitePersistenceRoundTrip() async throws {
        let scratch = try TemporaryDirectory()
        let dbURL = scratch.url.appending(path: "Facet/facet-sync.sqlite3")
        let database = try FacetSQLiteDatabase(fileURL: dbURL)

        let store = FacetLocalStore(database: database)
        let project = store.addProject(name: "Engineering", color: "blue", isFavorite: true)
        let section = store.addSection(projectId: project.id, name: "In Progress")
        let label = store.addLabel(name: "urgent", color: "red")
        let task = store.addTask(
            FacetTaskDraft(
                title: "Ship SQLite sync",
                projectId: project.id,
                sectionId: section.id,
                description: "## Checklist\n- Test WAL",
                priority: .p1,
                dueDate: "2026-11-20",
                recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,FR",
                labelIds: [label.id]
            )
        )
        let reminder = store.addReminder(
            taskId: task.id,
            reminderType: "absolute",
            dueDatetime: "2026-11-20T17:00:00Z"
        )
        let filter = store.addFilter(
            name: "Urgent Work",
            query: "p1 & #Engineering",
            isFavorite: true
        )
        store.syncToken = "seq:42"
        try await store.flushPersistence()
        await database.close()

        let relaunchedDB = try FacetSQLiteDatabase(fileURL: dbURL)
        let relaunchedStore = FacetLocalStore(database: relaunchedDB)
        try await relaunchedStore.load()

        #expect(relaunchedStore.projects == [project])
        #expect(relaunchedStore.sections == [section])
        #expect(relaunchedStore.labels == [label])
        #expect(relaunchedStore.tasks == [task])
        #expect(relaunchedStore.reminders == [reminder])
        #expect(relaunchedStore.filters == [filter])
        #expect(relaunchedStore.syncToken == "seq:42")
        #expect(relaunchedStore.outbox.count == 6)
        await relaunchedDB.close()
    }

    @Test("Refuses opening SQLite inside iOS App Group container")
    func rejectsAppGroupPath() {
        let groupLikeURL = URL(
            fileURLWithPath: "/tmp/group.com.tasksforobsidian/Facet/facet-sync.sqlite3"
        )
        #expect(throws: FacetSQLiteError.self) {
            _ = try FacetSQLiteDatabase(fileURL: groupLikeURL)
        }
    }

    @Test("Clearing nullable task fields emits empty-string sentinels per server contract")
    @MainActor
    func clearingNullableFieldsEmitsEmptyStringOnWire() throws {
        let store = FacetLocalStore()
        let created = store.addTask(
            FacetTaskDraft(
                title: "Prepare roadmap",
                projectId: "proj-1",
                sectionId: "sec-1",
                parentId: "parent-1",
                priority: .p2,
                dueDate: "2026-12-01",
                dueDatetime: "2026-12-01T15:00:00Z",
                recurrenceRule: "FREQ=DAILY"
            )
        )
        #expect(created.is_recurring == true)

        store.updateTask(
            id: created.id,
            patch: FacetTaskPatch(
                sectionId: .clear,
                parentId: .clear,
                dueDate: .clear,
                dueDatetime: .clear,
                recurrenceRule: .clear
            )
        )

        let updated = try #require(store.tasks.first)
        #expect(updated.section_id == nil)
        #expect(updated.parent_id == nil)
        #expect(updated.due_date == nil)
        #expect(updated.due_datetime == nil)
        #expect(updated.recurrence_rule == nil)
        #expect(updated.is_recurring == false)

        let queued = try #require(store.outbox.last)
        if case .taskUpdate(let wireArgs) = queued.command {
            #expect(wireArgs.section_id == "")
            #expect(wireArgs.parent_id == "")
            #expect(wireArgs.due_date == "")
            #expect(wireArgs.due_datetime == "")
            #expect(wireArgs.recurrence_rule == "")
        } else {
            Issue.record("Expected task_update command in outbox")
        }
    }

    @Test("Completing a recurring task advances due_date optimistically and supports Undo")
    @MainActor
    func recurringTaskCompletionAndUndo() throws {
        let store = FacetLocalStore()
        let completionTime = try #require(ViewerCalendar.parseISO8601("2026-06-01T10:00:00Z"))
        let recurring = store.addTask(
            FacetTaskDraft(
                title: "Weekly review",
                projectId: "proj-1",
                dueDate: "2026-06-01",
                recurrenceRule: "FREQ=WEEKLY;INTERVAL=1"
            )
        )

        store.completeTask(id: recurring.id, at: completionTime)
        let advanced = try #require(store.tasks.first)
        #expect(advanced.completed == false)
        #expect(advanced.due_date == "2026-06-08")
        #expect(advanced.is_recurring == true)

        _ = store.undoLast()
        let restored = try #require(store.tasks.first)
        #expect(restored.due_date == "2026-06-01")
        #expect(restored.completed == false)
    }

    @Test("Undo stack reverses creation, completion, edit, and deletion")
    @MainActor
    func undoStackOperations() {
        let store = FacetLocalStore()
        let task = store.addTask(title: "Write release notes", projectId: "proj-1", priority: .p3)
        #expect(store.tasks.count == 1)

        store.updateTask(id: task.id, patch: FacetTaskPatch(title: "Write v2 release notes"))
        #expect(store.tasks.first?.title == "Write v2 release notes")

        _ = store.undoLast()
        #expect(store.tasks.first?.title == "Write release notes")

        store.completeTask(id: task.id)
        #expect(store.tasks.first?.completed == true)

        _ = store.undoLast()
        #expect(store.tasks.first?.completed == false)

        store.deleteTask(id: task.id)
        #expect(store.tasks.isEmpty)

        _ = store.undoLast()
        #expect(store.tasks.count == 1)
        #expect(store.tasks.first?.title == "Write release notes")
    }

    @Test("full_sync replaces baseline, rewrites concurrent outbox tmp-* IDs, and surfaces errors")
    @MainActor
    func fullSyncConcurrentOutboxAndCommandErrorSurfacing() async throws {
        let store = FacetLocalStore()
        let tempProject = store.addProject(name: "Draft Project")
        let tempTask = store.addTask(title: "Initial task", projectId: tempProject.id)

        StubSyncURLProtocol.setHandler { [weak store] request in
            let mutated = DispatchSemaphore(value: 0)
            _Concurrency.Task { @MainActor in
                store?.updateTask(
                    id: tempTask.id,
                    patch: FacetTaskPatch(title: "Edited while syncing", projectId: tempProject.id)
                )
                mutated.signal()
            }
            _ = mutated.wait(timeout: .now() + 5)
            let response = Self.makeStubSyncResponse(
                tempProjectId: tempProject.id,
                tempTaskId: tempTask.id
            )
            let data = try JSONEncoder().encode(response)
            let http = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (http, data)
        }

        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.protocolClasses = [StubSyncURLProtocol.self]
        let client = FacetAPIClient(
            baseURL: URL(string: "https://facet.test")!,
            authToken: "tok",
            session: URLSession(configuration: sessionConfig)
        )

        try await store.sync(client: client)

        #expect(store.outbox.count == 1)
        if case .taskUpdate(let rewrittenArgs) = store.outbox.first?.command {
            #expect(rewrittenArgs.id == "srv-task-1")
            #expect(rewrittenArgs.project_id == "srv-proj-1")
        } else {
            Issue.record("Expected rewritten task_update command in outbox")
        }
        #expect(store.tasks.first?.id == "srv-task-1")
        #expect(store.tasks.first?.title == "Edited while syncing")
        #expect(store.lastError?.contains("invalid section reference") == true)
    }

    private static func makeStubSyncResponse(
        tempProjectId: String,
        tempTaskId: String
    ) -> SyncResponse {
        SyncResponse(
            sync_token: "seq:99",
            full_sync: true,
            temp_id_mapping: [tempProjectId: "srv-proj-1", tempTaskId: "srv-task-1"],
            sync_status: ["bad-cmd": "error: invalid section reference"],
            tasks: [makeStubServerTask()],
            projects: [
                Project(
                    id: "srv-proj-1",
                    user_id: "u1",
                    name: "Draft Project",
                    color: "blue",
                    parent_id: nil,
                    child_order: 1,
                    is_inbox: false,
                    is_favorite: false,
                    is_archived: false,
                    is_deleted: false,
                    created_at: "2026-06-15T00:00:00Z",
                    updated_at: "2026-06-15T00:00:00Z"
                )
            ],
            sections: [],
            labels: [],
            reminders: [],
            filters: []
        )
    }

    private static func makeStubServerTask() -> Task {
        Task(
            id: "srv-task-1",
            user_id: "u1",
            project_id: "srv-proj-1",
            section_id: nil,
            parent_id: nil,
            title: "Initial task",
            description: "",
            priority: .p4,
            child_order: 1,
            due_date: nil,
            due_datetime: nil,
            due_timezone: nil,
            due_string: nil,
            is_recurring: false,
            recurrence_rule: nil,
            label_ids: [],
            completed: false,
            completed_at: nil,
            is_deleted: false,
            created_at: "2026-06-15T00:00:00Z",
            updated_at: "2026-06-15T00:00:00Z"
        )
    }
}

private final class StubSyncURLProtocol: URLProtocol {
    typealias Handler = @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)
    private static let storage = Mutex<Handler?>(nil)

    static func setHandler(_ handler: @escaping Handler) {
        storage.withLock { $0 = handler }
    }

    override static func canInit(with request: URLRequest) -> Bool { true }
    override static func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let activeHandler = Self.storage.withLock { $0 }
        guard let activeHandler else {
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        do {
            let (response, data) = try activeHandler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
