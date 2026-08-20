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

@Test("keeps a long code when an unrelated address appears in the body")
func keepsLongCodeAlongsideUnrelatedAddress() {
    let metadata = MessageMetadata(sender: "Acme <security@acme.example>", subject: "Sign in", date: nil, messageID: "message-5")
    let body = "Your verification code is 7319042. Contact support@acme.example if this was not you."

    #expect(OTPParser().parse(body: body, metadata: metadata)?.code == "7319042")
}

@Test("keeps alphanumeric codes that begin with lowercase letters")
func keepsLowercaseLedCodes() {
    let metadata = MessageMetadata(sender: "Acme <security@acme.example>", subject: "Sign in", date: nil, messageID: "message-7")

    #expect(OTPParser().parse(body: "Your verification code is abcd1234.", metadata: metadata)?.code == "abcd1234")
    #expect(OTPParser().parse(body: "Your OTP is a7b9c2.", metadata: metadata)?.code == "a7b9c2")
}

@Test("keeps alphanumeric codes that begin with digits")
func keepsDigitLedCodes() {
    let metadata = MessageMetadata(sender: "Acme <security@acme.example>", subject: "Sign in", date: nil, messageID: "message-8")

    #expect(OTPParser().parse(body: "Your verification code is 1234AB.", metadata: metadata)?.code == "1234AB")
    #expect(OTPParser().parse(body: "Your OTP is 1234ABCD.", metadata: metadata)?.code == "1234ABCD")
}

@Test("accepts year-like codes with explicit verification context")
func acceptsYearLikeCodes() {
    let metadata = MessageMetadata(sender: "Acme <security@acme.example>", subject: "Sign in", date: nil, messageID: "message-year")

    #expect(OTPParser().parse(body: "Your verification code is 2048.", metadata: metadata)?.code == "2048")
    #expect(OTPParser().parse(body: "Your OTP is 1999.", metadata: metadata)?.code == "1999")
}

@Test("does not renew a code from an old message")
func rejectsExpiredMessageDate() {
    let metadata = MessageMetadata(
        sender: "Acme <security@acme.example>",
        subject: "Sign in",
        date: Date(timeIntervalSince1970: 100),
        messageID: "old-message"
    )

    #expect(OTPParser().parse(body: "Your verification code is 482913.", metadata: metadata, detectedAt: Date(timeIntervalSince1970: 1_000)) == nil)
}

@Test("rejects a long candidate that is part of an address")
func rejectsCodeInsideAddress() {
    let metadata = MessageMetadata(sender: "Acme <security@acme.example>", subject: "Sign in", date: nil, messageID: "message-6")
    let body = "Your verification code was sent to 7319042@acme.example."

    #expect(OTPParser().parse(body: body, metadata: metadata) == nil)
}

@Test("rejects a short numeric email local part as an otp")
func rejectsShortCodeInsideAddress() {
    let metadata = MessageMetadata(sender: "Acme <security@acme.example>", subject: "Sign in", date: nil, messageID: "message-short-email")
    let body = "Your verification code was sent to 123456@acme.example."

    #expect(OTPParser().parse(body: body, metadata: metadata) == nil)
}

@Test("accepts real domains and rejects subject fallbacks as service identifiers")
func validatesDomainServiceIdentifiers() {
    #expect(ServiceIdentity.isDomain("acme.example"))
    #expect(ServiceIdentity.isDomain("login.acme.co.uk"))
    #expect(ServiceIdentity.isDomain("example.xn--p1ai"))
    #expect(!ServiceIdentity.isDomain("Your verification code"))
    #expect(!ServiceIdentity.isDomain("localhost"))
    #expect(!ServiceIdentity.isDomain("acme.example."))
    #expect(!ServiceIdentity.isDomain("-acme.example"))
    #expect(!ServiceIdentity.isDomain("acme.123"))
    #expect(ServiceIdentity.matchingValues(for: "localhost").contains(ServiceIdentity.localURLIdentifier))
    #expect(ServiceIdentity.matchingValues(for: "http://127.0.0.1:8788").contains("localhost"))
    #expect(ServiceIdentity.matchingValues(for: "example.xn--p1ai") == ["example.xn--p1ai"])
    #expect(ServiceIdentity.matchingValues(for: "Your verification code").isEmpty)
}

@Test("requires contextual evidence")
func requiresContext() {
    let metadata = MessageMetadata(sender: "news@example.test", subject: "Daily update", date: nil, messageID: "message-4")

    #expect(OTPParser().parse(body: "A random identifier is 482913.", metadata: metadata) == nil)
}

@Test("does not treat keyword substrings as verification context")
func rejectsKeywordSubstrings() {
    let metadata = MessageMetadata(sender: "news@example.test", subject: "Daily update", date: nil, messageID: "message-keyword-boundary")

    #expect(OTPParser().parse(body: "Your postcode is 4829.", metadata: metadata) == nil)
    #expect(OTPParser().parse(body: "The author reference is 482913.", metadata: metadata) == nil)
    #expect(OTPParser().parse(body: "Your verification code is é482913.", metadata: metadata) == nil)
    #expect(OTPParser().parse(body: "OTP expires in 10 minutes.", metadata: metadata) == nil)
}

@Test("derives service only from the actual mailbox")
func rejectsSenderDisplayDomainInjection() {
    let metadata = MessageMetadata(
        sender: "Support @evil.example <security@bank.example>",
        subject: "Sign in",
        date: nil,
        messageID: "message-sender-domain"
    )

    #expect(OTPParser().parse(body: "Your verification code is 482913.", metadata: metadata)?.service == "bank.example")
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
