public import Foundation
import SQLite3

/// Errors raised by `FacetSQLiteDatabase`.
public enum FacetSQLiteError: Error, LocalizedError, Sendable, Equatable {
    case appGroupForbidden(String)
    case sqliteFailure(code: Int32, message: String)
    case corruptedPayload(table: String)

    public var errorDescription: String? {
        switch self {
        case .appGroupForbidden(let path):
            "SQLite databases cannot reside inside the iOS App Group container (\(path))."
        case .sqliteFailure(let code, let message):
            "SQLite error \(code): \(message)"
        case .corruptedPayload(let table):
            "Corrupted JSON row encountered in local SQLite table '\(table)'."
        }
    }
}

/// Complete durable snapshot persisted inside `FacetSQLiteDatabase`.
public struct FacetPersistedState: Sendable, Equatable {
    public var tasks: [Task]
    public var projects: [Project]
    public var sections: [Section]
    public var labels: [Label]
    public var reminders: [Reminder]
    public var filters: [Filter]
    public var outbox: [QueuedCommand]
    public var syncToken: String?

    public init(
        tasks: [Task] = [],
        projects: [Project] = [],
        sections: [Section] = [],
        labels: [Label] = [],
        reminders: [Reminder] = [],
        filters: [Filter] = [],
        outbox: [QueuedCommand] = [],
        syncToken: String? = nil
    ) {
        self.tasks = tasks
        self.projects = projects
        self.sections = sections
        self.labels = labels
        self.reminders = reminders
        self.filters = filters
        self.outbox = outbox
        self.syncToken = syncToken
    }
}

/// App-private SQLite3 persistence actor for all Facet resources, offline outbox, and sync token.
@safe
public actor FacetSQLiteDatabase {
    internal static let syncTokenMetaKey = "sync_token"

    public nonisolated let databasePath: String
    private var dbAddress: Int
    private var newestRevision: UInt64 = 0

    public init(fileURL: URL) throws {
        let standardized = fileURL.standardizedFileURL.resolvingSymlinksInPath().path
        if standardized.contains("group.com.tasksforobsidian") {
            throw FacetSQLiteError.appGroupForbidden(standardized)
        }
        let parent = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        self.databasePath = fileURL.path
        let handle = try unsafe Self.openConnection(at: fileURL.path, inMemory: false)
        self.dbAddress = Int(bitPattern: handle)
    }

    public init(inMemoryNamed _: String = ":memory:") throws {
        self.databasePath = ":memory:"
        let handle = try unsafe Self.openConnection(at: ":memory:", inMemory: true)
        self.dbAddress = Int(bitPattern: handle)
    }

    deinit {
        if dbAddress != 0, let pointer = unsafe OpaquePointer(bitPattern: dbAddress) {
            _ = unsafe sqlite3_close_v2(pointer)
        }
    }

    public func close() {
        if dbAddress != 0, let pointer = unsafe OpaquePointer(bitPattern: dbAddress) {
            dbAddress = 0
            _ = unsafe sqlite3_close_v2(pointer)
        }
    }

    public static func defaultDatabaseURL(folderName: String = "Facet") throws -> URL {
        let appSupport = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = appSupport.appendingPathComponent(folderName, isDirectory: true)
        if directory.standardizedFileURL.path.contains("group.com.tasksforobsidian") {
            throw FacetSQLiteError.appGroupForbidden(directory.path)
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("facet-sync.sqlite3")
    }

    public func loadState() throws -> FacetPersistedState {
        let handle = try unsafe requireHandle()
        let decoder = JSONDecoder()
        return try unsafe FacetPersistedState(
            tasks: Self.readEntities(
                from: handle,
                sql: "SELECT payload FROM tasks ORDER BY child_order ASC, id ASC;",
                table: "tasks",
                decoder: decoder
            ),
            projects: Self.readEntities(
                from: handle,
                sql: "SELECT payload FROM projects ORDER BY child_order ASC, id ASC;",
                table: "projects",
                decoder: decoder
            ),
            sections: Self.readEntities(
                from: handle,
                sql: "SELECT payload FROM sections ORDER BY section_order ASC, id ASC;",
                table: "sections",
                decoder: decoder
            ),
            labels: Self.readEntities(
                from: handle,
                sql: "SELECT payload FROM labels ORDER BY item_order ASC, id ASC;",
                table: "labels",
                decoder: decoder
            ),
            reminders: Self.readEntities(
                from: handle,
                sql: "SELECT payload FROM reminders ORDER BY id ASC;",
                table: "reminders",
                decoder: decoder
            ),
            filters: Self.readEntities(
                from: handle,
                sql: "SELECT payload FROM filters ORDER BY item_order ASC, id ASC;",
                table: "filters",
                decoder: decoder
            ),
            outbox: Self.readEntities(
                from: handle,
                sql: "SELECT payload FROM outbox ORDER BY seq ASC;",
                table: "outbox",
                decoder: decoder
            ),
            syncToken: Self.readMetaValue(from: handle, key: Self.syncTokenMetaKey)
        )
    }

    public func saveIfNewest(revision: UInt64, state: FacetPersistedState) throws {
        guard revision >= newestRevision else { return }
        try saveState(state)
        newestRevision = revision
    }

    public func saveState(_ state: FacetPersistedState) throws {
        let handle = try unsafe requireHandle()
        let encoder = JSONEncoder()
        try unsafe Self.execute(on: handle, sql: "BEGIN IMMEDIATE TRANSACTION;")
        do {
            try unsafe Self.writeAllTables(on: handle, state: state, encoder: encoder)
            try unsafe Self.execute(on: handle, sql: "COMMIT TRANSACTION;")
        } catch {
            _ = Result { try unsafe Self.execute(on: handle, sql: "ROLLBACK TRANSACTION;") }
            throw error
        }
    }

    @unsafe
    private func requireHandle() throws -> OpaquePointer {
        guard dbAddress != 0, let handle = unsafe OpaquePointer(bitPattern: dbAddress) else {
            throw FacetSQLiteError.sqliteFailure(code: SQLITE_MISUSE, message: "Database closed")
        }
        return unsafe handle
    }
}
