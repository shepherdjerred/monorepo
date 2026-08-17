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

    private static let saltDefaultsKey = "observability-fingerprint-salt"
    private static let saltLock = NSLock()
    nonisolated(unsafe) private static var cachedSalt: Data?

    // Domains, senders, and message IDs are guessable, so an unsalted digest is reversible by
    // anyone with log access. The salt is generated once and shared through the App Group so
    // fingerprints stay comparable across the helper, app, and extension.
    private static func salt() -> Data {
        saltLock.lock()
        defer { saltLock.unlock() }
        if let cachedSalt {
            return cachedSalt
        }

        let defaults = UserDefaults(suiteName: CodeFillConfiguration.applicationGroupIdentifier)
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: CodeFillConfiguration.applicationGroupIdentifier
        ) else {
            // Preserve the existing fallback for environments without an App Group, while the
            // normal path below is serialized across all helper/app/extension processes.
            let generated = Data((0 ..< 32).map { _ in UInt8.random(in: UInt8.min ... UInt8.max) })
            defaults?.set(generated, forKey: saltDefaultsKey)
            cachedSalt = generated
            return generated
        }

        let lockURL = containerURL.appendingPathComponent("observability-salt.lock")
        let lockDescriptor = open(lockURL.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard lockDescriptor >= 0 else {
            let generated = Data((0 ..< 32).map { _ in UInt8.random(in: UInt8.min ... UInt8.max) })
            cachedSalt = generated
            return generated
        }
        defer { close(lockDescriptor) }
        guard flock(lockDescriptor, LOCK_EX) == 0 else {
            let generated = Data((0 ..< 32).map { _ in UInt8.random(in: UInt8.min ... UInt8.max) })
            cachedSalt = generated
            return generated
        }
        defer { _ = flock(lockDescriptor, LOCK_UN) }

        if let stored = defaults?.data(forKey: saltDefaultsKey), stored.count == 32 {
            cachedSalt = stored
            return stored
        }
        let generated = Data((0 ..< 32).map { _ in UInt8.random(in: UInt8.min ... UInt8.max) })
        defaults?.set(generated, forKey: saltDefaultsKey)
        _ = defaults?.synchronize()
        cachedSalt = generated
        return generated
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
        String(describing: error)
    }
}
