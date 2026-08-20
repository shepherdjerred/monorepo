import Darwin
import Foundation

public enum CodeStoreError: Error, Equatable {
    case applicationGroupUnavailable(String)
    case invalidRecord
    case lockUnavailable(Int32)
}

public struct CodeStore {
    public static let fileName = "pending-one-time-codes.json"
    public static let lockFileName = ".pending-one-time-codes.lock"
    public static let defaultLockTimeout: TimeInterval = 5
    public static let corruptFileRetention: TimeInterval = 180

    private let directory: URL
    private let fileManager: FileManager
    private let lockTimeout: TimeInterval
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(
        directory: URL,
        fileManager: FileManager = .default,
        lockTimeout: TimeInterval = CodeStore.defaultLockTimeout
    ) throws {
        self.directory = directory
        self.fileManager = fileManager
        self.lockTimeout = lockTimeout
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        CodeFillObservability.storeLogger.debug("event=store_ready directory_type=app_group")
    }

    public init(
        applicationGroupIdentifier: String,
        fileManager: FileManager = .default,
        lockTimeout: TimeInterval = CodeStore.defaultLockTimeout
    ) throws {
        guard let directory = fileManager.containerURL(forSecurityApplicationGroupIdentifier: applicationGroupIdentifier) else {
            CodeFillObservability.storeLogger.error("event=store_unavailable group_hash=\(CodeFillObservability.fingerprint(applicationGroupIdentifier), privacy: .public)")
            throw CodeStoreError.applicationGroupUnavailable(applicationGroupIdentifier)
        }
        try self.init(directory: directory, fileManager: fileManager, lockTimeout: lockTimeout)
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
        _ = try consumeAndReadRemaining(messageID: messageID, now: now)
    }

    public func consumeAndReadRemaining(messageID: String, now: Date = Date()) throws -> [OTPRecord] {
        let startedAt = Date()
        do {
            let result = try withLock {
                let records = try readUnlocked(now: now)
                let remaining = records.filter { $0.messageID != messageID }
                try writeUnlocked(remaining)
                return (records.count != remaining.count, remaining)
            }
            CodeFillObservability.storeLogger.info("event=store_consume outcome=success record_found=\(result.0, privacy: .public) record_count=\(result.1.count, privacy: .public) message_id_hash=\(CodeFillObservability.fingerprint(messageID), privacy: .public) duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
            return result.1
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
        try removeExpiredCorruptFiles(now: now)
        let url = directory.appendingPathComponent(Self.fileName)
        guard fileManager.fileExists(atPath: url.path) else { return [] }
        let data = try Data(contentsOf: url)
        let records: [OTPRecord]
        do {
            records = try decoder.decode([OTPRecord].self, from: data)
        } catch {
            let quarantineURL = directory.appendingPathComponent(".\(Self.fileName).corrupt-\(UUID().uuidString)")
            do {
                try fileManager.moveItem(at: url, to: quarantineURL)
                CodeFillObservability.storeLogger.error("event=store_corrupt_quarantined quarantine_name=\(quarantineURL.lastPathComponent, privacy: .public)")
                return []
            } catch {
                CodeFillObservability.storeLogger.error("event=store_corrupt_quarantine_error error=\(CodeFillObservability.errorSummary(error), privacy: .public)")
                throw error
            }
        }
        let valid = records.filter { !$0.isExpired(at: now) }
        if valid.count != records.count {
            try writeUnlocked(valid)
            CodeFillObservability.storeLogger.info("event=store_expired_removed record_count=\(records.count - valid.count, privacy: .public)")
        }
        return valid.sorted { $0.detectedAt > $1.detectedAt }
    }

    private func removeExpiredCorruptFiles(now: Date) throws {
        let prefix = ".\(Self.fileName).corrupt-"
        let urls = try fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: []
        ).filter { $0.lastPathComponent.hasPrefix(prefix) }

        for url in urls {
            let values = try url.resourceValues(forKeys: [.contentModificationDateKey])
            guard let modifiedAt = values.contentModificationDate else {
                try fileManager.removeItem(at: url)
                CodeFillObservability.storeLogger.info("event=store_corrupt_cleanup outcome=removed_missing_date")
                continue
            }
            guard modifiedAt.addingTimeInterval(Self.corruptFileRetention) <= now else { continue }
            try fileManager.removeItem(at: url)
            CodeFillObservability.storeLogger.info("event=store_corrupt_cleanup outcome=removed_expired")
        }
    }

    private func writeUnlocked(_ records: [OTPRecord]) throws {
        let url = directory.appendingPathComponent(Self.fileName)
        let temporaryURL = directory.appendingPathComponent(".\(Self.fileName).\(UUID().uuidString).tmp")
        defer {
            if fileManager.fileExists(atPath: temporaryURL.path) {
                do {
                    try fileManager.removeItem(at: temporaryURL)
                } catch {
                    CodeFillObservability.storeLogger.error("event=store_temporary_cleanup outcome=error error=\(CodeFillObservability.errorSummary(error), privacy: .public)")
                }
            }
        }
        let data = try encoder.encode(records)
        try data.write(to: temporaryURL, options: .atomic)
        if fileManager.fileExists(atPath: url.path) {
            _ = try fileManager.replaceItemAt(url, withItemAt: temporaryURL)
        } else {
            try fileManager.moveItem(at: temporaryURL, to: url)
        }
        CodeFillObservability.storeLogger.debug("event=store_write outcome=success record_count=\(records.count, privacy: .public) atomic=true")
    }

    // The helper, setup app, and provider extension are separate processes sharing one App Group
    // file, so the read-modify-write sequences must be serialized with an interprocess lock.
    private func withLock<T>(_ operation: () throws -> T) throws -> T {
        let lockURL = directory.appendingPathComponent(Self.lockFileName)
        var descriptor = Int32(-1)
        while descriptor < 0 {
            descriptor = open(lockURL.path, O_CREAT | O_RDWR | O_CLOEXEC, 0o600)
            if descriptor < 0 && errno != EINTR {
                throw CodeStoreError.lockUnavailable(errno)
            }
        }
        defer { close(descriptor) }
        try acquireLock(descriptor)
        defer { flock(descriptor, LOCK_UN) }
        return try operation()
    }

    // A blocking flock would hang the caller for as long as a stalled or suspended process holds
    // the file, which in the extension means a wedged AutoFill request. Wait a bounded time and
    // then fail deterministically so callers can report an error instead.
    private func acquireLock(_ descriptor: Int32) throws {
        let deadline = Date().addingTimeInterval(lockTimeout)
        var backoffMicroseconds: useconds_t = 1_000
        while true {
            if flock(descriptor, LOCK_EX | LOCK_NB) == 0 {
                return
            }
            let failure = errno
            guard failure == EWOULDBLOCK || failure == EINTR else {
                throw CodeStoreError.lockUnavailable(failure)
            }
            guard Date() < deadline else {
                throw CodeStoreError.lockUnavailable(ETIMEDOUT)
            }
            usleep(backoffMicroseconds)
            backoffMicroseconds = min(backoffMicroseconds * 2, 25_000)
        }
    }

    private func elapsedMilliseconds(since start: Date) -> Int {
        Int(Date().timeIntervalSince(start) * 1_000)
    }
}
