import Foundation
import Testing
@testable import MailMateCodeFillShared

@Test("parses a contextual numeric code")
func parsesNumericCode() {
    let metadata = MessageMetadata(sender: "Acme <security@acme.example>", subject: "Your verification code", date: nil, messageID: "message-1")
    let record = OTPParser().parse(body: "Use verification code 482913 to finish signing in.", metadata: metadata, detectedAt: Date(timeIntervalSince1970: 100))

    #expect(record?.code == "482913")
    #expect(record?.service == "acme.example")
    #expect(record?.sender == "Acme")
    #expect(record?.expiresAt == Date(timeIntervalSince1970: 280))
}

@Test("normalizes spaced, dashed, and multilingual codes")
func normalizesCodeVariants() {
    let metadata = MessageMetadata(sender: "seguridad@example.test", subject: "Código de verificación", date: nil, messageID: "message-2")
    let spaced = OTPParser().parse(body: "Código de verificación: 12 34 56", metadata: metadata)
    let dashed = OTPParser().parse(body: "Your Sicherheitscode is 98-76-54", metadata: metadata)
    let alphaNumeric = OTPParser().parse(body: "Your OTP is A7B9C2", metadata: metadata)

    #expect(spaced?.code == "123456")
    #expect(dashed?.code == "987654")
    #expect(alphaNumeric?.code == "A7B9C2")
}

@Test("rejects ordinary dates, phone numbers, URLs, and unrelated IDs")
func rejectsFalsePositives() {
    let metadata = MessageMetadata(sender: "Billing <billing@example.test>", subject: "Receipt", date: nil, messageID: "message-3")
    let body = "Call 4155550123. Invoice 20260418. Reference 1234567. Visit https://example.test/482913."

    #expect(OTPParser().parse(body: body, metadata: metadata) == nil)
}

@Test("requires contextual evidence")
func requiresContext() {
    let metadata = MessageMetadata(sender: "news@example.test", subject: "Daily update", date: nil, messageID: "message-4")

    #expect(OTPParser().parse(body: "A random identifier is 482913.", metadata: metadata) == nil)
}

@Test("parses a canonical MailMate body fixture")
func parsesCanonicalFixture() throws {
    guard let url = Bundle.module.url(forResource: "verification-code", withExtension: "txt", subdirectory: "Fixtures") else {
        throw FixtureError.missing
    }
    let body = try String(contentsOf: url, encoding: .utf8)
    let metadata = MessageMetadata(sender: "Acme <security@acme.example>", subject: "Sign in", date: nil, messageID: "fixture-message")

    #expect(OTPParser().parse(body: body, metadata: metadata)?.code == "731904")
}

private enum FixtureError: Error {
    case missing
}
