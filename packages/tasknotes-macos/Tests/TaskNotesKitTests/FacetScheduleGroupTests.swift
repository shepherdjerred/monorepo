import TaskNotesKit
import TaskNotesTestSupport
import Testing

@Suite("Group rescheduling")
struct FacetScheduleGroupTests {
    @Test("Rejected batch restores authoritative dates even when the server returns no task delta")
    @MainActor
    func rejectedBulkMove() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let client = FacetAPIClient(baseURL: server.baseURL, authToken: server.authToken)
        let store = FacetLocalStore()
        store.addTask(FacetTaskDraft(title: "Keep original day", dueDate: "2026-10-01"))
        try await store.sync(client: client)
        let sent = try #require(store.tasks.first)
        let orphan = FacetLocalStore().addTask(FacetTaskDraft(title: "Orphaned task"))
        store.tasks.append(orphan)
        store.rescheduleTasks(
            [sent, orphan].map { ($0.id, FacetTaskPatch(dueDate: .set("2026-11-21"))) })
        try await store.sync(client: client)
        #expect(store.lastError != nil)
        #expect(store.outbox.isEmpty)
        #expect(store.tasks == [sent])
        if case .restoreSchedules = store.latestUndoEntry?.action {
            Issue.record("Rejected change still offers Undo")
        }
    }

    @Test("Undo a batch of schedules without undoing unrelated edits")
    @MainActor
    func groupScheduleUndo() throws {
        let store = FacetLocalStore()
        let tasks = ["A", "B"].map {
            store.addTask(FacetTaskDraft(title: $0, dueDate: "2026-11-01"))
        }
        store.rescheduleTasks(tasks.map { ($0.id, FacetTaskPatch(dueDate: .set("2026-11-20"))) })
        #expect(store.tasks.map(\.due_date) == ["2026-11-20", "2026-11-20"])
        let batch = try #require(store.outbox.last?.command)
        guard case .taskReschedule(let args) = batch else {
            Issue.record("Expected one reschedule command")
            return
        }
        #expect(args.tasks.map(\.id) == tasks.map(\.id))
        store.updateTask(
            id: tasks[0].id, patch: FacetTaskPatch(title: "Revised"), recordUndo: false)
        store.undoLast()
        #expect(store.tasks.map(\.due_date) == ["2026-11-01", "2026-11-01"])
        #expect(store.tasks.first?.title == "Revised")
    }
}
