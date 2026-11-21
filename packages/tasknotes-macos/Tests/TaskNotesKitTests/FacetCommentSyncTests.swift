import Foundation
import TaskNotesKit
import TaskNotesTestSupport
import Testing

@Suite
struct FacetCommentSyncTests {
    @Test(
        "Offline file comments survive relaunch, a lost acknowledgement and a second client's edit")
    @MainActor
    func offlineCommentRoundTrip() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let api = FacetAPIClient(baseURL: server.baseURL, authToken: server.authToken)
        let scratch = try TemporaryDirectory()
        let db = try FacetSQLiteDatabase(fileURL: scratch.url.appending(path: "facet.sqlite3"))
        let bytes = Data([0, 13, 254])
        let note = try await seedOffline(db: db, bytes: bytes)
        let restored = FacetLocalStore(database: db)
        try await restored.load()
        #expect(restored.tasks.first?.chronologicalComments == [note])

        // The server committed, but the sender never received its acknowledgement.
        _ = try await api.sync(
            request: SyncRequest(
                sync_token: nil, resource_types: ["tasks"], commands: restored.outbox))
        try await restored.sync(client: api)
        #expect(restored.outbox.isEmpty)
        let second = FacetLocalStore()
        try await second.sync(client: api)
        let synced = try #require(second.tasks.first)
        #expect(synced.chronologicalComments.map(\.id) == [note.id])
        second.deleteTask(id: synced.id)
        try await second.sync(client: api)
        await #expect(throws: FacetAPIError.self) {
            try await api.attachment(taskID: synced.id, commentID: note.id)
        }
        _ = second.undoLast()
        try await second.sync(client: api)
        #expect(second.tasks.first?.chronologicalComments.map(\.id) == [note.id])
        let downloaded = try await api.attachment(taskID: synced.id, commentID: note.id)
        #expect(downloaded == bytes)
        let wrongAuth = FacetAPIClient(baseURL: server.baseURL, authToken: "incorrect")
        await #expect(throws: FacetAPIError.self) {
            try await wrongAuth.attachment(taskID: synced.id, commentID: note.id)
        }
        second.updateTask(id: synced.id, patch: FacetTaskPatch(title: "Updated title"))
        try await second.sync(client: api)
        var detach = FacetTaskPatch()
        detach.removeAttachmentID = note.id
        restored.updateTask(id: synced.id, patch: detach, recordUndo: false)
        try await restored.sync(client: api)
        try await second.sync(client: api)
        #expect(second.tasks.first?.title == "Updated title")
        #expect(second.tasks.first?.chronologicalComments.first?.body == note.body)
        #expect(second.tasks.first?.chronologicalComments.first?.file_name == nil)
        await #expect(throws: FacetAPIError.self) {
            try await api.attachment(taskID: synced.id, commentID: note.id)
        }
        await db.close()
    }

    @MainActor
    private func seedOffline(db: FacetSQLiteDatabase, bytes: Data) async throws -> TaskComment {
        let source = FacetLocalStore(database: db)
        let task = source.addTask(FacetTaskDraft(title: "Renew pass"))
        let note = TaskComment(
            id: UUID().uuidString, body: "Bring the receipt",
            created_at: "2026-11-21T12:00:00Z", file_name: "Receipt.pdf")
        var update = FacetTaskPatch()
        update.appendComment = CommentUpload(
            comment: note, attachment_base64: bytes.base64EncodedString())
        source.updateTask(id: task.id, patch: update, recordUndo: false)
        source.deleteTask(id: task.id)
        _ = source.undoLast()
        #expect(source.tasks.first?.id == task.id)
        #expect(source.tasks.first?.chronologicalComments == [note])
        try await source.flushPersistence()
        return note
    }
}
