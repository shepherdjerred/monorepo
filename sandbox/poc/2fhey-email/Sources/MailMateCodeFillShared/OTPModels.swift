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
