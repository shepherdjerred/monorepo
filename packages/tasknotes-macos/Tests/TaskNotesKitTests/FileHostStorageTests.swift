import Foundation
import TaskNotesTestSupport
import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

@Suite("File-backed host storage")
struct FileHostStorageTests {
    private func makeStorage() throws -> (FileHostStorage, TemporaryDirectory) {
        let directory = try TemporaryDirectory()
        return (try FileHostStorage(directory: directory.url), directory)
    }

    @Test("an unwritten slot reads as absent, not as an empty string")
    func absentSlotsReadAsNil() throws {
        let (storage, directory) = try makeStorage()
        defer { _ = directory }

        #expect(try storage.readQueue() == nil)
        #expect(try storage.readDeadLetter() == nil)
        #expect(try storage.readIdAliases() == nil)
        #expect(try storage.readLegacyQueue() == nil)
        #expect(try storage.readLastSyncTime() == nil)
        #expect(try storage.readTasks().isEmpty)
    }

    @Test("the queue and dead-letter halves are independent")
    func queueAndDeadLetterAreIndependent() throws {
        let (storage, directory) = try makeStorage()
        defer { _ = directory }

        try storage.writeQueue(data: #"[{"id":"c1"}]"#)
        try storage.writeDeadLetter(data: #"[{"id":"c2"}]"#)

        #expect(try storage.readQueue() == #"[{"id":"c1"}]"#)
        #expect(try storage.readDeadLetter() == #"[{"id":"c2"}]"#)
    }

    @Test("a rewrite replaces rather than appends")
    func aRewriteReplaces() throws {
        let (storage, directory) = try makeStorage()
        defer { _ = directory }

        try storage.writeQueue(data: "[1,2,3]")
        try storage.writeQueue(data: "[]")
        #expect(try storage.readQueue() == "[]")
    }

    @Test("the task cache round-trips through the core's own parser")
    func taskCacheRoundTrips() throws {
        let (storage, directory) = try makeStorage()
        defer { _ = directory }

        let first = try taskFromJson(json: #"{"id":"Tasks/a.md","title":"Alpha"}"#)
        let second = try taskFromJson(
            json: #"{"id":"Tasks/b.md","title":"Beta","status":"done"}"#
        )

        try storage.writeTasks(tasks: [first, second])
        #expect(try storage.readTasks() == [first, second])
    }

    @Test("the task cache preserves list order exactly")
    func taskCachePreservesOrder() throws {
        let (storage, directory) = try makeStorage()
        defer { _ = directory }

        // The order is the user's — the core carries it in an `IndexMap` and it
        // crosses the FFI as an ordered `Vec`. A cache that quietly sorted by
        // id or title would look correct in every other assertion and silently
        // rewrite the user's list on the first relaunch.
        let titles = ["zulu", "alpha", "mike", "bravo"]
        let tasks = try titles.map { title in
            try taskFromJson(json: #"{"id":"Tasks/\#(title).md","title":"\#(title)"}"#)
        }

        try storage.writeTasks(tasks: tasks)
        #expect(try storage.readTasks().map(\.title) == titles)
    }

    @Test("a corrupt task cache fails loudly rather than reading as empty")
    func aCorruptTaskCacheFailsLoudly() throws {
        let (storage, directory) = try makeStorage()
        defer { _ = directory }

        try Data("not json".utf8).write(to: storage.root.appending(path: "tasks.json"))
        #expect(throws: CoreError.self) {
            try storage.readTasks()
        }

        try Data(#"{"not":"an array"}"#.utf8)
            .write(to: storage.root.appending(path: "tasks.json"))
        #expect(throws: CoreError.self) {
            try storage.readTasks()
        }
    }

    @Test("the last sync time survives a round trip, including pre-1970")
    func lastSyncTimeRoundTrips() throws {
        let (storage, directory) = try makeStorage()
        defer { _ = directory }

        try storage.writeLastSyncTime(millis: 1_786_147_200_000)
        #expect(try storage.readLastSyncTime() == 1_786_147_200_000)

        // Signed, matching `Date.now()`: a pre-1970 instant is representable
        // rather than wrapping.
        try storage.writeLastSyncTime(millis: -1)
        #expect(try storage.readLastSyncTime() == -1)
    }

    @Test("a non-integer timestamp is rejected rather than defaulted")
    func aCorruptTimestampIsRejected() throws {
        let (storage, directory) = try makeStorage()
        defer { _ = directory }

        try Data("tomorrow".utf8).write(to: storage.root.appending(path: "last-sync-time.json"))
        #expect(throws: CoreError.self) {
            try storage.readLastSyncTime()
        }
    }

    @Test("a stored integer tolerates a trailing newline")
    func aStoredIntegerToleratesTrailingWhitespace() throws {
        let (storage, directory) = try makeStorage()
        defer { _ = directory }

        // Not defensiveness about bad data: this is a file a developer may open
        // and re-save, and an editor that adds a final newline should not
        // corrupt the client's state.
        try Data("2\n".utf8).write(to: storage.root.appending(path: "schema-version.json"))
        #expect(try storage.readSchemaVersion() == 2)
    }

    @Test("an absent schema version is version 0, which is the migration entry point")
    func anAbsentSchemaVersionIsZero() throws {
        let (storage, directory) = try makeStorage()
        defer { _ = directory }

        #expect(try storage.readSchemaVersion() == 0)
        try storage.writeSchemaVersion(version: migrationCurrentSchemaVersion())
        #expect(try storage.readSchemaVersion() == migrationCurrentSchemaVersion())
    }

    @Test("removing an absent legacy queue is a no-op")
    func removingAnAbsentLegacyQueueIsANoOp() throws {
        let (storage, directory) = try makeStorage()
        defer { _ = directory }

        // The migration calls this unconditionally on every upgrade path,
        // including the one where no v1 client ever ran.
        try storage.removeLegacyQueue()
        try storage.removeLegacyQueue()
        #expect(try storage.readLegacyQueue() == nil)
    }

    @Test("the v0 to v2 migration runs end to end through this storage")
    func theMigrationRunsThroughThisStorage() throws {
        let (storage, directory) = try makeStorage()
        defer { _ = directory }

        let clock = SystemClock(instant: { Date(timeIntervalSince1970: 1_786_147_200) })
        let randomness = try #require(FixedRandomness(ppm: UnitPpm.half))

        try runMigrations(storage: storage, clock: clock, random: randomness)
        #expect(try storage.readSchemaVersion() == migrationCurrentSchemaVersion())

        // Idempotent: the core returns immediately once the stored version is
        // current, which is what makes it safe on every launch.
        try runMigrations(storage: storage, clock: clock, random: randomness)
        #expect(try storage.readSchemaVersion() == migrationCurrentSchemaVersion())
    }

    @Test("two storages over the same directory see each other's writes")
    func storageIsBackedByTheDirectoryNotTheInstance() throws {
        let directory = try TemporaryDirectory()
        let first = try FileHostStorage(directory: directory.url)
        try first.writeIdAliases(data: #"{"temp:1":"Tasks/a.md"}"#)

        // The relaunch case: a fresh process, the same container.
        let second = try FileHostStorage(directory: directory.url)
        #expect(try second.readIdAliases() == #"{"temp:1":"Tasks/a.md"}"#)
    }

    @Test("the container default resolves and is writable")
    func theContainerDefaultIsUsable() throws {
        // Outside the app this is the real `~/Library/Application Support`;
        // inside the sandbox `FileManager` redirects it into the container. The
        // same call is correct in both, which is the reason it is a call rather
        // than a constructed path.
        let storage = try FileHostStorage.containerDefault(folder: "TaskNotesTests")
        try storage.writeQueue(data: "[]")
        #expect(try storage.readQueue() == "[]")
        try FileManager.default.removeItem(at: storage.root)
    }
}
