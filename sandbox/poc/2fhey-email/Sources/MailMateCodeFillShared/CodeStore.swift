import Foundation

public enum CodeStoreError: Error, Equatable {
    case applicationGroupUnavailable(String)
    case invalidRecord
}

public struct CodeStore {
    public static let fileName = "pending-one-time-codes.json"
    private static let processLock = NSLock()

    private let directory: URL
    private let fileManager: FileManager
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(directory: URL, fileManager: FileManager = .default) throws {
        self.directory = directory
        self.fileManager = fileManager
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        CodeFillObservability.storeLogger.debug("event=store_ready directory_type=app_group")
    }

    public init(applicationGroupIdentifier: String, fileManager: FileManager = .default) throws {
        guard let directory = fileManager.containerURL(forSecurityApplicationGroupIdentifier: applicationGroupIdentifier) else {
            CodeFillObservability.storeLogger.error("event=store_unavailable group_hash=\(CodeFillObservability.fingerprint(applicationGroupIdentifier), privacy: .public)")
            throw CodeStoreError.applicationGroupUnavailable(applicationGroupIdentifier)
        }
        try self.init(directory: directory, fileManager: fileManager)
    }

    public func append(_ record: OTPRecord, now: Date = Date()) throws {
        let startedAt = Date()
        do {
            let count = try withLock {
                let records = try readUnlocked(now: now).filter { $0.messageID != record.messageID }
                try writeUnlocked(records + [record])
                return records.count + 1
            }
            CodeFillObservability.storeLogger.info("event=store_append outcome=success record_count=\(count, privacy: .public) \(CodeFillObservability.recordSummary(record), privacy: .public) duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
        } catch {
            CodeFillObservability.storeLogger.error("event=store_append outcome=error error=\(CodeFillObservability.errorSummary(error), privacy: .public) duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
            throw error
        }
    }

    public func read(now: Date = Date()) throws -> [OTPRecord] {
        let startedAt = Date()
        do {
            let records = try withLock {
            try readUnlocked(now: now)
            }
            CodeFillObservability.storeLogger.info("event=store_read outcome=success record_count=\(records.count, privacy: .public) duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
            return records
        } catch {
            CodeFillObservability.storeLogger.error("event=store_read outcome=error error=\(CodeFillObservability.errorSummary(error), privacy: .public) duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
            throw error
        }
    }

    public func consume(messageID: String, now: Date = Date()) throws {
        let startedAt = Date()
        do {
            let result = try withLock {
                let records = try readUnlocked(now: now)
                let remaining = records.filter { $0.messageID != messageID }
                try writeUnlocked(remaining)
                return (records.count != remaining.count, remaining.count)
            }
            CodeFillObservability.storeLogger.info("event=store_consume outcome=success record_found=\(result.0, privacy: .public) record_count=\(result.1, privacy: .public) message_id_hash=\(CodeFillObservability.fingerprint(messageID), privacy: .public) duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
        } catch {
            CodeFillObservability.storeLogger.error("event=store_consume outcome=error error=\(CodeFillObservability.errorSummary(error), privacy: .public) duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
            throw error
        }
    }

    public func removeExpired(now: Date = Date()) throws {
        let startedAt = Date()
        do {
            try withLock {
                _ = try readUnlocked(now: now)
            }
            CodeFillObservability.storeLogger.info("event=store_remove_expired outcome=success duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
        } catch {
            CodeFillObservability.storeLogger.error("event=store_remove_expired outcome=error error=\(CodeFillObservability.errorSummary(error), privacy: .public) duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
            throw error
        }
    }

    private func readUnlocked(now: Date) throws -> [OTPRecord] {
        let url = directory.appendingPathComponent(Self.fileName)
        guard fileManager.fileExists(atPath: url.path) else { return [] }
        let data = try Data(contentsOf: url)
        let records = try decoder.decode([OTPRecord].self, from: data)
        let valid = records.filter { !$0.isExpired(at: now) }
        if valid.count != records.count {
            try writeUnlocked(valid)
            CodeFillObservability.storeLogger.info("event=store_expired_removed record_count=\(records.count - valid.count, privacy: .public)")
        }
        return valid.sorted { $0.detectedAt > $1.detectedAt }
    }

    private func writeUnlocked(_ records: [OTPRecord]) throws {
        let url = directory.appendingPathComponent(Self.fileName)
        let temporaryURL = directory.appendingPathComponent(".\(Self.fileName).\(UUID().uuidString).tmp")
        let data = try encoder.encode(records)
        try data.write(to: temporaryURL, options: .atomic)
        if fileManager.fileExists(atPath: url.path) {
            _ = try fileManager.replaceItemAt(url, withItemAt: temporaryURL)
        } else {
            try fileManager.moveItem(at: temporaryURL, to: url)
        }
        CodeFillObservability.storeLogger.debug("event=store_write outcome=success record_count=\(records.count, privacy: .public) atomic=true")
    }

    private func withLock<T>(_ operation: () throws -> T) throws -> T {
        Self.processLock.lock()
        defer { Self.processLock.unlock() }
        return try operation()
    }

    private func elapsedMilliseconds(since start: Date) -> Int {
        Int(Date().timeIntervalSince(start) * 1_000)
    }
}
