import Foundation
import GRDB
import OSLog

// MARK: - SnapshotStore

/// Persistent storage for historical service snapshots using GRDB/SQLite.
actor SnapshotStore {
    // MARK: Lifecycle

    /// Create a store backed by a file at the given path.
    /// Creates intermediate directories if needed.
    init(path: String) throws {
        let url = URL(fileURLWithPath: path)
        let directory = url.deletingLastPathComponent().path
        try FileManager.default.createDirectory(
            atPath: directory,
            withIntermediateDirectories: true,
        )
        let pool = try DatabasePool(path: path)
        try Self.migrate(pool)
        self.dbWriter = pool
        self.databasePath = path
    }

    /// Create an in-memory store for testing.
    init(inMemory: Bool = true) throws {
        precondition(inMemory, "Use init(path:) for on-disk databases")
        let queue = try DatabaseQueue()
        try Self.migrate(queue)
        self.dbWriter = queue
        self.databasePath = nil
    }

    // MARK: Internal

    /// Batch-insert an array of service snapshots.
    func save(_ snapshots: [ServiceSnapshot]) throws {
        try self.dbWriter.write { database in
            for snapshot in snapshots {
                let persisted = PersistedSnapshot(from: snapshot)
                try persisted.insert(database)
            }
        }
        GlanceLogger.persistence.debug("Saved \(snapshots.count) snapshots")
    }

    /// Query snapshot history for a provider within a time window.
    func history(
        for providerId: String,
        last duration: TimeInterval,
    ) throws -> [PersistedSnapshot] {
        let cutoff = Date.now.timeIntervalSince1970 - duration
        return try self.dbWriter.read { database in
            try PersistedSnapshot
                .filter(Column("providerId") == providerId)
                .filter(Column("timestamp") >= cutoff)
                .order(Column("timestamp").asc)
                .fetchAll(database)
        }
    }

    /// Return the most recent snapshot for each provider.
    func latestPerProvider() throws -> [PersistedSnapshot] {
        try self.dbWriter.read { database in
            let sql = """
            SELECT s.*
            FROM snapshots s
            INNER JOIN (
                SELECT providerId, MAX(timestamp) AS maxTimestamp
                FROM snapshots
                GROUP BY providerId
            ) latest ON s.providerId = latest.providerId
                AND s.timestamp = latest.maxTimestamp
            """
            return try PersistedSnapshot.fetchAll(database, sql: sql)
        }
    }

    /// Delete snapshots older than the given age in seconds.
    func prune(olderThan age: TimeInterval) throws {
        let cutoff = Date.now.timeIntervalSince1970 - age
        try self.dbWriter.write { database in
            try database.execute(
                sql: "DELETE FROM snapshots WHERE timestamp < ?",
                arguments: [cutoff],
            )
        }
        GlanceLogger.persistence.debug("Pruned snapshots older than \(age)s")
    }

    /// Return the on-disk database file size in bytes, or 0 for in-memory databases.
    func databaseSize() -> Int64 {
        guard let path = self.databasePath else {
            return 0
        }
        let attributes = try? FileManager.default.attributesOfItem(atPath: path)
        return attributes?[.size] as? Int64 ?? 0
    }

    // MARK: Private

    private let dbWriter: any DatabaseWriter
    private let databasePath: String?

    private static func migrate(_ writer: any DatabaseWriter) throws {
        var migrator = DatabaseMigrator()
        migrator.registerMigration("v1") { database in
            try database.create(table: "snapshots") { table in
                table.autoIncrementedPrimaryKey("id")
                table.column("providerId", .text).notNull()
                table.column("status", .integer).notNull()
                table.column("summary", .text).notNull()
                table.column("error", .text)
                table.column("timestamp", .double).notNull()
            }
            try database.create(
                index: "idx_snapshots_provider_time",
                on: "snapshots",
                columns: ["providerId", "timestamp"],
            )
        }
        try migrator.migrate(writer)
    }
}
