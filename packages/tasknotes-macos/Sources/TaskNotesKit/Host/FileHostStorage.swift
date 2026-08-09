public import TaskNotesUniFFI

public import struct Foundation.CharacterSet
public import struct Foundation.Data
public import class Foundation.FileManager
public import class Foundation.JSONSerialization
public import struct Foundation.URL

/// Every durable store the core needs, as files in one directory.
///
/// One object implements all three storage traits because the core's own
/// `MigrationStorage` and `QueueStorage` deliberately overlap: the migration
/// writes the very queue the queue layer then reads, and splitting them across
/// two objects would put that handoff behind two independent notions of where
/// the bytes live.
///
/// ## Where it stores things, and why that is not a choice
///
/// The app is sandboxed from commit one — `app-sandbox`,
/// `files.user-selected.read-write`, `network.client` — and there is
/// deliberately no broad filesystem entitlement. So client state goes in the
/// app container, which the sandbox grants unconditionally:
///
/// ```text
/// ~/Library/Containers/red.sjer.tasknotes.mac/Data/Library/Application Support/TaskNotes/
/// ```
///
/// ``containerDefault()`` resolves that through `FileManager`, which returns the
/// **redirected** container path inside a sandboxed process and the real one
/// outside it — so the same call is correct in the app and in a test bundle.
///
/// Note what does *not* live here: the vault. A vault is user-chosen data
/// outside the container, and reaching it needs a system open panel plus a
/// security-scoped bookmark. That is a separate capability, not a storage
/// directory, and it is not this type's business.
///
/// ## Durability
///
/// Every write is atomic (`Data.WritingOptions.atomic` — write to a temporary
/// file, then rename), because the crash window this storage exists to survive
/// is precisely the one a partial write would open: a half-written queue is
/// worse than no queue, since it parses as neither.
public final class FileHostStorage: QueueStorage, TaskCacheStorage, MigrationStorage {
    /// The files this storage owns, and nothing else in the directory.
    private enum Slot: String {
        case queue = "queue.json"
        case deadLetter = "dead-letter.json"
        case tasks = "tasks.json"
        case idAliases = "id-aliases.json"
        case lastSyncTime = "last-sync-time.json"
        case schemaVersion = "schema-version.json"
        case legacyQueue = "legacy-queue.json"
    }

    private let directory: URL

    /// Storage rooted at `directory`, creating it when absent.
    public init(directory: URL) throws(CoreError) {
        self.directory = directory
        try CoreErrors.storing("could not create \(directory.path)") {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
        }
    }

    /// Storage in the app container's Application Support directory.
    public static func containerDefault(
        folder: String = "TaskNotes"
    ) throws(CoreError) -> FileHostStorage {
        let support = try CoreErrors.storing("could not resolve Application Support") {
            try FileManager.default.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
        }
        return try FileHostStorage(directory: support.appending(path: folder))
    }

    /// Where this storage keeps its files.
    public var root: URL { directory }

    // ── QueueStorage ───────────────────────────────────────────────────────

    public func readQueue() throws(CoreError) -> String? {
        try readText(.queue)
    }

    public func writeQueue(data: String) throws(CoreError) {
        try writeText(data, to: .queue)
    }

    public func readDeadLetter() throws(CoreError) -> String? {
        try readText(.deadLetter)
    }

    public func writeDeadLetter(data: String) throws(CoreError) {
        try writeText(data, to: .deadLetter)
    }

    // ── TaskCacheStorage ───────────────────────────────────────────────────

    /// Read the cached base snapshot.
    ///
    /// Parsing stays in the core: the file holds a JSON array, this splits it
    /// into elements and hands each one to `taskFromJson`. **Order is preserved
    /// exactly** — it is the user's list order, which the core carries in an
    /// `IndexMap` and which crosses the FFI as an ordered `Vec`. Nothing here
    /// sorts, dedupes, or reorders.
    public func readTasks() throws(CoreError) -> [CoreTask] {
        guard let text = try readText(.tasks) else { return [] }
        let parsed = try CoreErrors.validating("the cached task list is not JSON") {
            try JSONSerialization.jsonObject(with: Data(text.utf8))
        }
        guard let elements = parsed as? [Any] else {
            throw CoreError.Validation(message: "the cached task list is not a JSON array")
        }

        var tasks: [CoreTask] = []
        tasks.reserveCapacity(elements.count)
        for element in elements {
            let encoded = try CoreErrors.validating("a cached task could not be re-encoded") {
                try JSONSerialization.data(withJSONObject: element)
            }
            tasks.append(
                try CoreErrors.rethrowingCore("could not parse a cached task") {
                    try taskFromJson(json: encoded.decodedAsUtf8(describing: "a cached task"))
                }
            )
        }
        return tasks
    }

    public func writeTasks(tasks: [CoreTask]) throws(CoreError) {
        var encoded: [String] = []
        encoded.reserveCapacity(tasks.count)
        for task in tasks {
            encoded.append(
                try CoreErrors.rethrowingCore("could not render a cached task") {
                    try taskToJson(task: task)
                }
            )
        }
        try writeText("[\(encoded.joined(separator: ","))]", to: .tasks)
    }

    public func readIdAliases() throws(CoreError) -> String? {
        try readText(.idAliases)
    }

    public func writeIdAliases(data: String) throws(CoreError) {
        try writeText(data, to: .idAliases)
    }

    public func readLastSyncTime() throws(CoreError) -> Int64? {
        guard let text = try readText(.lastSyncTime) else { return nil }
        guard let millis = Int64(text.trimmed) else {
            throw CoreError.Validation(
                message: "the stored last-sync time is not an integer: \(text)"
            )
        }
        return millis
    }

    public func writeLastSyncTime(millis: Int64) throws(CoreError) {
        try writeText(String(millis), to: .lastSyncTime)
    }

    // ── MigrationStorage ───────────────────────────────────────────────────

    /// The stored schema version; `0` when absent.
    ///
    /// Absent means "a client that predates versioning wrote this", which is
    /// exactly version 0 — so the default is the migration's entry point rather
    /// than a fallback hiding a read failure. A file that exists but does not
    /// parse still fails loudly.
    public func readSchemaVersion() throws(CoreError) -> UInt32 {
        guard let text = try readText(.schemaVersion) else { return 0 }
        guard let version = UInt32(text.trimmed) else {
            throw CoreError.Validation(
                message: "the stored schema version is not an integer: \(text)"
            )
        }
        return version
    }

    public func writeSchemaVersion(version: UInt32) throws(CoreError) {
        try writeText(String(version), to: .schemaVersion)
    }

    public func readLegacyQueue() throws(CoreError) -> String? {
        try readText(.legacyQueue)
    }

    public func removeLegacyQueue() throws(CoreError) {
        let url = self.url(for: .legacyQueue)
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        try CoreErrors.storing("could not remove \(Slot.legacyQueue.rawValue)") {
            try FileManager.default.removeItem(at: url)
        }
    }

    // ── Files ──────────────────────────────────────────────────────────────

    private func url(for slot: Slot) -> URL {
        directory.appending(path: slot.rawValue)
    }

    private func readText(_ slot: Slot) throws(CoreError) -> String? {
        let url = self.url(for: slot)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let data = try CoreErrors.storing("could not read \(slot.rawValue)") {
            try Data(contentsOf: url)
        }
        return try data.decodedAsUtf8(describing: slot.rawValue)
    }

    private func writeText(_ text: String, to slot: Slot) throws(CoreError) {
        try CoreErrors.storing("could not write \(slot.rawValue)") {
            try Data(text.utf8).write(to: url(for: slot), options: [.atomic])
        }
    }
}

extension String {
    /// The string without leading or trailing whitespace or newlines.
    ///
    /// A stored integer is written without decoration, but a file edited by
    /// hand or copied by a tool picks up a trailing newline, and rejecting that
    /// as "not an integer" would be a diagnostic nobody could act on.
    fileprivate var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
