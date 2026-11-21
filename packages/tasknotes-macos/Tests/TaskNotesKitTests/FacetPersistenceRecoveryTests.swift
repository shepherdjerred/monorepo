import TaskNotesKit
import Testing

@MainActor
struct FacetPersistenceRecoveryTests {
    @Test(
        "Retrying a failed SQLite write clears the storage error and preserves any sync error",
        arguments: [false, true])
    func retryStorageWrite(withSyncError: Bool) async throws {
        let database = try FacetSQLiteDatabase(inMemoryNamed: ":memory:")
        let store = FacetLocalStore(database: database)
        let task = store.addTask(title: "Pick up prints", projectId: "inbox")
        try await store.flushPersistence()
        if withSyncError { store.lastError = "Server unavailable" }

        store.tasks.append(task)
        await #expect(throws: FacetSQLiteError.self) { try await store.flushPersistence() }
        #expect(store.lastError?.contains("UNIQUE constraint failed") == true)
        store.tasks.removeLast()
        try await store.flushPersistence()

        #expect(store.lastError == (withSyncError ? "Server unavailable" : nil))
        #expect(try await database.loadState().tasks == [task])
    }
}
