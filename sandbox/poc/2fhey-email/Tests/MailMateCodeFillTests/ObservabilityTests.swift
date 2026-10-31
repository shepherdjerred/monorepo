import Testing
@testable import MailMateCodeFillShared

@Test("observability fingerprints are stable without exposing identifiers")
func fingerprintsAreStableAndOpaque() {
    let first = CodeFillObservability.fingerprint("message-id@example.test")
    let second = CodeFillObservability.fingerprint("message-id@example.test")
    let different = CodeFillObservability.fingerprint("other-message@example.test")

    #expect(first == second)
    #expect(first != different)
    #expect(first.count == 16)
    #expect(!first.contains("message"))
    #expect(!first.contains("example"))
}

@Test("observability summaries exclude message content and OTP values")
func summariesArePrivacySafe() {
    let metadata = MessageMetadata(
        sender: "Demo Service <no-reply@example.test>",
        subject: "Your verification code is 864219",
        date: nil,
        messageID: "<secret-message@example.test>"
    )
    let record = OTPRecord(
        code: "864219",
        service: "example.test",
        sender: "Demo Service",
        messageID: metadata.messageID,
        detectedAt: .now,
        expiresAt: .now.addingTimeInterval(180)
    )

    let metadataSummary = CodeFillObservability.metadataSummary(metadata)
    let recordSummary = CodeFillObservability.recordSummary(record)

    #expect(metadataSummary.contains("subject_length="))
    #expect(!metadataSummary.contains("verification"))
    #expect(!metadataSummary.contains("864219"))
    #expect(!metadataSummary.contains("example.test"))
    #expect(recordSummary.contains("code_length=6"))
    #expect(!recordSummary.contains("864219"))
    #expect(!recordSummary.contains("secret-message"))
}
