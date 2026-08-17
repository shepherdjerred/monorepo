import Foundation

public struct MessageMetadata: Equatable, Sendable {
    public let sender: String
    public let subject: String
    public let date: Date?
    public let messageID: String

    public init(sender: String, subject: String, date: Date?, messageID: String) {
        self.sender = sender
        self.subject = subject
        self.date = date
        self.messageID = messageID
    }
}

public struct OTPRecord: Codable, Equatable, Sendable {
    public let code: String
    public let service: String?
    public let sender: String
    public let messageID: String
    public let detectedAt: Date
    public let expiresAt: Date

    public init(
        code: String,
        service: String?,
        sender: String,
        messageID: String,
        detectedAt: Date,
        expiresAt: Date
    ) {
        self.code = code
        self.service = service
        self.sender = sender
        self.messageID = messageID
        self.detectedAt = detectedAt
        self.expiresAt = expiresAt
    }

    public func isExpired(at date: Date) -> Bool {
        expiresAt <= date
    }
}

public enum ServiceIdentity {
    // OTPParser falls back to the message subject when the sender carries no domain, so a stored
    // service string is not necessarily usable as an AutoFill domain identifier.
    public static func isDomain(_ value: String) -> Bool {
        guard value.count <= 253 else { return false }
        let labels = value.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2 else { return false }
        guard let topLevel = labels.last, topLevel.count >= 2, topLevel.allSatisfy({ $0.isASCII && $0.isLetter }) else {
            return false
        }
        return labels.allSatisfy { label in
            !label.isEmpty && label.count <= 63 &&
                !label.hasPrefix("-") && !label.hasSuffix("-") &&
                label.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
        }
    }
}
