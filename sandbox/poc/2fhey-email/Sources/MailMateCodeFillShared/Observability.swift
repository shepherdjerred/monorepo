import CryptoKit
import Foundation
import os

public enum CodeFillObservability {
    public static let subsystem = "com.sjerred.MailMateCodeFill"

    public static let appLogger = Logger(subsystem: subsystem, category: "app")
    public static let bundleLogger = Logger(subsystem: subsystem, category: "bundle")
    public static let helperLogger = Logger(subsystem: subsystem, category: "helper")
    public static let parserLogger = Logger(subsystem: subsystem, category: "parser")
    public static let storeLogger = Logger(subsystem: subsystem, category: "store")
    public static let providerLogger = Logger(subsystem: subsystem, category: "provider")

    public static func fingerprint(_ value: String) -> String {
        let digest = SHA256.hash(data: Data(value.utf8))
        return digest.prefix(8).map { String(format: "%02x", $0) }.joined()
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
