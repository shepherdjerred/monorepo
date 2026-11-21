import Foundation
import SQLite3

internal struct OrderedEntityWriteSpec<Entity: Encodable> {
    let table: String
    let orderColumn: String
    let items: [Entity]
    let idOf: (Entity) -> String
    let orderOf: (Entity) -> Double
}

extension FacetSQLiteDatabase {
    internal static let schemaDDL = """
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY NOT NULL,
            child_order REAL NOT NULL DEFAULT 0,
            payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY NOT NULL,
            child_order REAL NOT NULL DEFAULT 0,
            payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sections (
            id TEXT PRIMARY KEY NOT NULL,
            section_order REAL NOT NULL DEFAULT 0,
            payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS labels (
            id TEXT PRIMARY KEY NOT NULL,
            item_order REAL NOT NULL DEFAULT 0,
            payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS filters (
            id TEXT PRIMARY KEY NOT NULL,
            item_order REAL NOT NULL DEFAULT 0,
            payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS outbox (
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_meta (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );
        """

    @unsafe
    internal static func openConnection(at path: String, inMemory: Bool) throws -> OpaquePointer {
        var rawHandle: OpaquePointer?
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        let openCode = path.withCString { cPath in
            unsafe sqlite3_open_v2(cPath, &rawHandle, flags, nil)
        }
        guard openCode == SQLITE_OK, let handle = unsafe rawHandle else {
            let detail =
                unsafe rawHandle.map { unsafe errorMessage(from: $0) } ?? "Failed to open SQLite"
            if let existing = unsafe rawHandle {
                _ = unsafe sqlite3_close_v2(existing)
            }
            throw FacetSQLiteError.sqliteFailure(code: openCode, message: detail)
        }

        do {
            _ = unsafe sqlite3_busy_timeout(handle, 5_000)
            if !inMemory {
                try unsafe execute(on: handle, sql: "PRAGMA journal_mode = WAL;")
                try unsafe execute(on: handle, sql: "PRAGMA synchronous = NORMAL;")
            }
            try unsafe execute(on: handle, sql: schemaDDL)
            if try unsafe readMetaValue(from: handle, key: "retired_reminders") == nil {
                try unsafe execute(
                    on: handle,
                    sql: """
                        BEGIN IMMEDIATE;
                        DELETE FROM outbox WHERE CASE WHEN json_valid(payload)
                            THEN json_extract(payload, '$.command.type') END
                            IN ('ReminderAdd', 'ReminderUpdate', 'ReminderDelete');
                        DROP TABLE IF EXISTS reminders;
                        INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('retired_reminders', '1');
                        COMMIT;
                        """)
            }
            return unsafe handle
        } catch {
            _ = unsafe sqlite3_close_v2(handle)
            throw error
        }
    }

    @unsafe
    internal static func writeAllTables(
        on handle: OpaquePointer,
        state: FacetPersistedState,
        encoder: JSONEncoder
    ) throws {
        try unsafe writePrimaryTables(on: handle, state: state, encoder: encoder)
        try unsafe writeSecondaryTables(on: handle, state: state, encoder: encoder)
    }

    @unsafe
    private static func writePrimaryTables(
        on handle: OpaquePointer,
        state: FacetPersistedState,
        encoder: JSONEncoder
    ) throws {
        let tasksSpec = OrderedEntityWriteSpec(
            table: "tasks", orderColumn: "child_order",
            items: state.tasks, idOf: \.id, orderOf: \.child_order
        )
        let projectsSpec = OrderedEntityWriteSpec(
            table: "projects", orderColumn: "child_order",
            items: state.projects, idOf: \.id, orderOf: \.child_order
        )
        let sectionsSpec = OrderedEntityWriteSpec(
            table: "sections", orderColumn: "section_order",
            items: state.sections, idOf: \.id, orderOf: \.section_order
        )
        try unsafe replaceOrderedEntities(on: handle, spec: tasksSpec, encoder: encoder)
        try unsafe replaceOrderedEntities(on: handle, spec: projectsSpec, encoder: encoder)
        try unsafe replaceOrderedEntities(on: handle, spec: sectionsSpec, encoder: encoder)
    }

    @unsafe
    private static func writeSecondaryTables(
        on handle: OpaquePointer,
        state: FacetPersistedState,
        encoder: JSONEncoder
    ) throws {
        let labelsSpec = OrderedEntityWriteSpec(
            table: "labels", orderColumn: "item_order",
            items: state.labels, idOf: \.id, orderOf: \.item_order
        )
        let filtersSpec = OrderedEntityWriteSpec(
            table: "filters", orderColumn: "item_order",
            items: state.filters, idOf: \.id, orderOf: \.item_order
        )
        try unsafe replaceOrderedEntities(on: handle, spec: labelsSpec, encoder: encoder)
        try unsafe replaceOrderedEntities(on: handle, spec: filtersSpec, encoder: encoder)
        try unsafe replaceOutbox(on: handle, outbox: state.outbox, encoder: encoder)
        try unsafe writeSyncToken(on: handle, syncToken: state.syncToken)
    }

    @unsafe
    internal static func execute(on handle: OpaquePointer, sql: String) throws {
        let code = sql.withCString { cSQL in
            unsafe sqlite3_exec(handle, cSQL, nil, nil, nil)
        }
        guard code == SQLITE_OK else {
            throw FacetSQLiteError.sqliteFailure(
                code: code,
                message: unsafe errorMessage(from: handle)
            )
        }
    }

    @unsafe
    internal static func prepare(on handle: OpaquePointer, sql: String) throws -> OpaquePointer {
        var rawStmt: OpaquePointer?
        let code = sql.withCString { cSQL in
            unsafe sqlite3_prepare_v2(handle, cSQL, -1, &rawStmt, nil)
        }
        guard code == SQLITE_OK, let stmt = unsafe rawStmt else {
            if let existing = unsafe rawStmt {
                _ = unsafe sqlite3_finalize(existing)
            }
            throw FacetSQLiteError.sqliteFailure(
                code: code,
                message: unsafe errorMessage(from: handle)
            )
        }
        return unsafe stmt
    }

    @unsafe
    internal static func readEntities<Entity: Decodable>(
        from handle: OpaquePointer,
        sql: String,
        table: String,
        decoder: JSONDecoder
    ) throws -> [Entity] {
        let stmt = try unsafe prepare(on: handle, sql: sql)
        defer { _ = unsafe sqlite3_finalize(stmt) }

        var rows: [Entity] = []
        while true {
            let stepCode = unsafe sqlite3_step(stmt)
            if stepCode == SQLITE_DONE { break }
            guard stepCode == SQLITE_ROW else {
                throw FacetSQLiteError.sqliteFailure(
                    code: stepCode,
                    message: unsafe errorMessage(from: handle)
                )
            }
            guard let textPtr = unsafe sqlite3_column_text(stmt, 0) else {
                throw FacetSQLiteError.corruptedPayload(table: table)
            }
            let byteCount = Int(unsafe sqlite3_column_bytes(stmt, 0))
            let bytes = unsafe Data(bytes: textPtr, count: byteCount)
            do {
                rows.append(try decoder.decode(Entity.self, from: bytes))
            } catch {
                throw FacetSQLiteError.corruptedPayload(table: table)
            }
        }
        return rows
    }

    @unsafe
    internal static func readMetaValue(
        from handle: OpaquePointer,
        key: String
    ) throws -> String? {
        let stmt = try unsafe prepare(
            on: handle,
            sql: "SELECT value FROM sync_meta WHERE key = ?1 LIMIT 1;"
        )
        defer { _ = unsafe sqlite3_finalize(stmt) }

        return try key.withCString { keyPtr in
            let bindCode = unsafe sqlite3_bind_text(stmt, 1, keyPtr, -1, nil)
            guard bindCode == SQLITE_OK else {
                throw FacetSQLiteError.sqliteFailure(
                    code: bindCode,
                    message: unsafe errorMessage(from: handle)
                )
            }
            let stepCode = unsafe sqlite3_step(stmt)
            if stepCode == SQLITE_DONE { return nil }
            guard stepCode == SQLITE_ROW else {
                throw FacetSQLiteError.sqliteFailure(
                    code: stepCode,
                    message: unsafe errorMessage(from: handle)
                )
            }
            guard let textPtr = unsafe sqlite3_column_text(stmt, 0) else { return nil }
            let byteCount = Int(unsafe sqlite3_column_bytes(stmt, 0))
            let bytes = unsafe Data(bytes: textPtr, count: byteCount)
            return String(data: bytes, encoding: .utf8)
        }
    }

    @unsafe
    internal static func replaceOrderedEntities<Entity: Encodable>(
        on handle: OpaquePointer,
        spec: OrderedEntityWriteSpec<Entity>,
        encoder: JSONEncoder
    ) throws {
        try unsafe execute(on: handle, sql: "DELETE FROM \(spec.table);")
        guard !spec.items.isEmpty else { return }
        let sql =
            "INSERT INTO \(spec.table) (id, \(spec.orderColumn), payload) VALUES (?1, ?2, ?3);"
        let stmt = try unsafe prepare(on: handle, sql: sql)
        defer { _ = unsafe sqlite3_finalize(stmt) }

        for item in spec.items {
            let idValue = spec.idOf(item)
            let orderValue = spec.orderOf(item)
            guard let payload = String(data: try encoder.encode(item), encoding: .utf8) else {
                throw FacetSQLiteError.corruptedPayload(table: spec.table)
            }
            try unsafe stepOrderedInsert(
                stmt: stmt,
                handle: handle,
                idValue: idValue,
                orderValue: orderValue,
                payload: payload
            )
        }
    }

    @unsafe
    private static func stepOrderedInsert(
        stmt: OpaquePointer,
        handle: OpaquePointer,
        idValue: String,
        orderValue: Double,
        payload: String
    ) throws {
        try idValue.withCString { idPtr in
            try payload.withCString { payloadPtr in
                _ = unsafe sqlite3_reset(stmt)
                _ = unsafe sqlite3_clear_bindings(stmt)
                guard unsafe sqlite3_bind_text(stmt, 1, idPtr, -1, nil) == SQLITE_OK,
                    unsafe sqlite3_bind_double(stmt, 2, orderValue) == SQLITE_OK,
                    unsafe sqlite3_bind_text(stmt, 3, payloadPtr, -1, nil) == SQLITE_OK,
                    unsafe sqlite3_step(stmt) == SQLITE_DONE
                else {
                    throw FacetSQLiteError.sqliteFailure(
                        code: SQLITE_ERROR,
                        message: unsafe errorMessage(from: handle)
                    )
                }
            }
        }
    }

    @unsafe
    internal static func replaceOutbox(
        on handle: OpaquePointer,
        outbox: [QueuedCommand],
        encoder: JSONEncoder
    ) throws {
        try unsafe execute(on: handle, sql: "DELETE FROM outbox;")
        guard !outbox.isEmpty else { return }
        let stmt = try unsafe prepare(on: handle, sql: "INSERT INTO outbox (payload) VALUES (?1);")
        defer { _ = unsafe sqlite3_finalize(stmt) }

        for command in outbox {
            guard let payload = String(data: try encoder.encode(command), encoding: .utf8) else {
                throw FacetSQLiteError.corruptedPayload(table: "outbox")
            }
            try payload.withCString { payloadPtr in
                _ = unsafe sqlite3_reset(stmt)
                _ = unsafe sqlite3_clear_bindings(stmt)
                guard unsafe sqlite3_bind_text(stmt, 1, payloadPtr, -1, nil) == SQLITE_OK else {
                    throw FacetSQLiteError.sqliteFailure(
                        code: SQLITE_ERROR,
                        message: unsafe errorMessage(from: handle)
                    )
                }
                let stepCode = unsafe sqlite3_step(stmt)
                guard stepCode == SQLITE_DONE else {
                    throw FacetSQLiteError.sqliteFailure(
                        code: stepCode,
                        message: unsafe errorMessage(from: handle)
                    )
                }
            }
        }
    }

    @unsafe
    internal static func writeSyncToken(
        on handle: OpaquePointer,
        syncToken: String?
    ) throws {
        guard let syncToken, !syncToken.isEmpty else {
            try unsafe execute(on: handle, sql: "DELETE FROM sync_meta WHERE key = 'sync_token';")
            return
        }
        let stmt = try unsafe prepare(
            on: handle,
            sql: "INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?1, ?2);"
        )
        defer { _ = unsafe sqlite3_finalize(stmt) }

        try syncTokenMetaKey.withCString { keyPtr in
            try syncToken.withCString { valPtr in
                guard unsafe sqlite3_bind_text(stmt, 1, keyPtr, -1, nil) == SQLITE_OK,
                    unsafe sqlite3_bind_text(stmt, 2, valPtr, -1, nil) == SQLITE_OK
                else {
                    throw FacetSQLiteError.sqliteFailure(
                        code: SQLITE_ERROR,
                        message: unsafe errorMessage(from: handle)
                    )
                }
                let stepCode = unsafe sqlite3_step(stmt)
                guard stepCode == SQLITE_DONE else {
                    throw FacetSQLiteError.sqliteFailure(
                        code: stepCode,
                        message: unsafe errorMessage(from: handle)
                    )
                }
            }
        }
    }

    @unsafe
    internal static func errorMessage(from handle: OpaquePointer) -> String {
        guard let cString = unsafe sqlite3_errmsg(handle) else {
            return "Unknown SQLite error"
        }
        return unsafe String(cString: cString)
    }
}
