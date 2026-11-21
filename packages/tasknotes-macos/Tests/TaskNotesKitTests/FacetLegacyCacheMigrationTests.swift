import Foundation
import SQLite3
import TaskNotesKit
import TaskNotesTestSupport
import Testing

@Suite("Facet legacy cache migrations")
struct FacetLegacyCacheMigrationTests {
    @Test("Opening a legacy cache retires reminder writes and preserves the cursor and FIFO queue")
    func upgradesLegacyOutbox() async throws {
        let scratch = try TemporaryDirectory()
        let dbURL = scratch.url.appending(path: "upgrade.sqlite3")
        var raw: OpaquePointer?
        let openResult = unsafe sqlite3_open(dbURL.path, &raw)
        try #require(openResult == SQLITE_OK)
        guard let handle = unsafe raw else {
            Issue.record("Opening the legacy fixture returned no SQLite connection")
            return
        }
        defer { _ = unsafe sqlite3_close_v2(handle) }
        let fixture = """
            CREATE TABLE reminders (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
            INSERT INTO reminders VALUES ('obsolete', '{}');
            CREATE TABLE outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL);
            CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT INTO sync_meta VALUES ('sync_token','seq:42');
            INSERT INTO outbox (payload) VALUES
                ('{"uuid":"r1","command":{"type":"ReminderAdd","args":{}}}'),
                ('{"uuid":"task-1","command":{"type":"TaskDelete","args":{"id":"t1"}}}'),
                ('{"uuid":"r2","command":{"type":"ReminderUpdate","args":{}}}'),
                ('{"uuid":"task-2","command":{"type":"TaskUncomplete","args":{"id":"t2"}}}'),
                ('{"uuid":"r3","command":{"type":"ReminderDelete","args":{}}}');
            """
        let setup = unsafe sqlite3_exec(handle, fixture, nil, nil, nil)
        try #require(setup == SQLITE_OK)

        for _ in 0..<2 {
            let database = try FacetSQLiteDatabase(fileURL: dbURL)
            let state = try await database.loadState()
            #expect(state.syncToken == "seq:42")
            #expect(state.outbox.map(\.uuid) == ["task-1", "task-2"])
            await database.close()
        }
        // Recreating the legacy table succeeds only if the migration removed it.
        let recreate = unsafe sqlite3_exec(
            handle, "CREATE TABLE reminders (id TEXT);", nil, nil, nil)
        #expect(recreate == SQLITE_OK)
    }
}
