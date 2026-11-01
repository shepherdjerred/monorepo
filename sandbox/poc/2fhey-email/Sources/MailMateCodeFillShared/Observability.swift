import CryptoKit
import Foundation
import os
#if canImport(Darwin)
import Darwin
#endif

public enum CodeFillObservability {
    public static let subsystem = "com.sjerred.MailMateCodeFill"

    public static let appLogger = Logger(subsystem: subsystem, category: "app")
    public static let bundleLogger = Logger(subsystem: subsystem, category: "bundle")
    public static let helperLogger = Logger(subsystem: subsystem, category: "helper")
    public static let parserLogger = Logger(subsystem: subsystem, category: "parser")
    public static let storeLogger = Logger(subsystem: subsystem, category: "store")
    public static let providerLogger = Logger(subsystem: subsystem, category: "provider")

    private static let saltLock = NSLock()
    nonisolated(unsafe) private static var cachedSalt: Data?
    nonisolated(unsafe) private static var cachedSaltIsFallback = false
    private static let saltFileName = "observability-fingerprint-salt.bin"

    // Domains, senders, and message IDs are guessable, so an unsalted digest is reversible by
    // anyone with log access. The salt is generated once and shared through the App Group so
    // fingerprints stay comparable across the helper, app, and extension.
    private static func salt() -> Data {
        saltLock.lock()
        let fallbackSalt = cachedSalt
        if let cachedSalt, !cachedSaltIsFallback {
            saltLock.unlock()
            return cachedSalt
        }
        saltLock.unlock()

        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: CodeFillConfiguration.applicationGroupIdentifier
        ) else {
            // Unit tests and command-line invocations do not have the production App Group. Keep
            // those environments usable without pretending their process-local salt is shared.
            let generated = Data((0 ..< 32).map { _ in UInt8.random(in: UInt8.min ... UInt8.max) })
            return fallbackSalt ?? cacheSalt(generated, isFallback: true)
        }

        let saltURL = containerURL.appendingPathComponent(saltFileName)
        if let stored = readSalt(at: saltURL) {
            return cacheSalt(stored, isFallback: false)
        }

        // The App Group is shared by several processes. A local NSLock cannot protect the
        // invalid-salt recovery path: another process can install a replacement between this
        // read and the quarantine move. Serialize the read/quarantine/create sequence with a
        // filesystem lock, then re-read while holding it.
        if let repaired = withSaltRepairLock(at: containerURL, operation: { () -> Data? in
            if let stored = readSalt(at: saltURL) {
                return stored
            }
            if FileManager.default.fileExists(atPath: saltURL.path) {
                quarantineInvalidSalt(at: saltURL)
                if let stored = readSalt(at: saltURL) {
                    return stored
                }
            }

            let generated = Data((0 ..< 32).map { _ in UInt8.random(in: UInt8.min ... UInt8.max) })
            let temporaryURL = containerURL.appendingPathComponent(".\(saltFileName).\(UUID().uuidString).tmp")
            do {
                try generated.write(to: temporaryURL, options: .atomic)
                if link(temporaryURL.path, saltURL.path) == 0 {
                    unlink(temporaryURL.path)
                    return generated
                }
                let failure = errno
                unlink(temporaryURL.path)
                if failure == EEXIST, let stored = readSalt(at: saltURL) {
                    return stored
                }
            } catch {
                unlink(temporaryURL.path)
            }
            return nil
        }) {
            return cacheSalt(repaired, isFallback: false)
        }

        // A failed read/create is exceptional, but observability must not stall OTP handling. A
        // bounded retry lets a concurrently-created canonical file win before using a local salt.
        let deadline = Date().addingTimeInterval(0.25)
        while Date() < deadline {
            if let stored = readSalt(at: saltURL) {
                return cacheSalt(stored, isFallback: false)
            }
            usleep(10_000)
        }
        let generated = Data((0 ..< 32).map { _ in UInt8.random(in: UInt8.min ... UInt8.max) })
        return fallbackSalt ?? cacheSalt(generated, isFallback: true)
    }

    private static func withSaltRepairLock(at containerURL: URL, operation: () -> Data?) -> Data? {
        let lockURL = containerURL.appendingPathComponent(".\(saltFileName).lock")
        let descriptor = open(lockURL.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else {
            storeLogger.error("event=observability_salt outcome=lock_open_error errno=\(errno, privacy: .public)")
            return nil
        }
        let deadline = Date().addingTimeInterval(0.25)
        while flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
            let failure = errno
            guard failure == EAGAIN || failure == EWOULDBLOCK else {
                close(descriptor)
                storeLogger.error("event=observability_salt outcome=lock_acquire_error errno=\(failure, privacy: .public)")
                return nil
            }
            guard Date() < deadline else {
                close(descriptor)
                storeLogger.error("event=observability_salt outcome=lock_timeout")
                return nil
            }
            usleep(10_000)
        }
        defer {
            _ = flock(descriptor, LOCK_UN)
            close(descriptor)
        }
        return operation()
    }

    private static func readSalt(at url: URL) -> Data? {
        guard let data = try? Data(contentsOf: url), data.count == 32 else { return nil }
        return data
    }

    private static func quarantineInvalidSalt(at url: URL) {
        let quarantineURL = url.deletingLastPathComponent().appendingPathComponent(".\(saltFileName).corrupt-\(UUID().uuidString)")
        do {
            try FileManager.default.moveItem(at: url, to: quarantineURL)
            storeLogger.error("event=observability_salt outcome=invalid_quarantined quarantine_name=\(quarantineURL.lastPathComponent, privacy: .public)")
        } catch CocoaError.fileNoSuchFile { return }
        catch {
            storeLogger.error("event=observability_salt outcome=quarantine_error error=\(errorSummary(error), privacy: .public)")
        }
    }

    private static func cacheSalt(_ salt: Data, isFallback: Bool) -> Data {
        saltLock.lock()
        defer { saltLock.unlock() }
        if let cachedSalt, (!cachedSaltIsFallback || isFallback) { return cachedSalt }
        cachedSalt = salt
        cachedSaltIsFallback = isFallback
        return salt
    }

    public static func fingerprint(_ value: String) -> String {
        var salted = salt()
        salted.append(Data(value.utf8))
        return SHA256.hash(data: salted).prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    public static func metadataSummary(_ metadata: MessageMetadata) -> String {
        let sender = metadata.sender.isEmpty ? "empty" : fingerprint(metadata.sender)
        let messageID = metadata.messageID.isEmpty ? "empty" : fingerprint(metadata.messageID)
        return "sender_hash=\(sender) subject_length=\(metadata.subject.count) message_id_hash=\(messageID) date_present=\(metadata.date != nil)"
    }

    public static func recordSummary(_ record: OTPRecord) -> String {
        let service = record.service.map(fingerprint) ?? "none"
        return "service_hash=\(service) sender_hash=\(fingerprint(record.sender)) message_id_hash=\(fingerprint(record.messageID)) code_length=\(record.code.count)"
    }

    public static func errorSummary(_ error: Error) -> String {
        "type=\(String(reflecting: type(of: error)))"
    }
}
