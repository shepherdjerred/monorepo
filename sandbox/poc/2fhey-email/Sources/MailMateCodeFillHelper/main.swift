import Foundation
#if SWIFT_PACKAGE
import MailMateCodeFillShared
#endif

private enum HelperError: Error, CustomStringConvertible {
    case usage
    case invalidBodyEncoding
    case missingMessageID

    var description: String {
        switch self {
        case .usage:
            return "usage: MailMateCodeFillHelper --mailmate"
        case .invalidBodyEncoding:
            return "MailMate supplied a body that is not valid UTF-8"
        case .missingMessageID:
            return "MailMate did not provide MM_MESSAGE_ID"
        }
    }
}

private func run() throws {
    let startedAt = Date()
    CodeFillObservability.helperLogger.info("event=helper_started mode=mailmate argument_count=\(CommandLine.arguments.count, privacy: .public)")
    guard CommandLine.arguments.dropFirst().contains("--mailmate") else {
        throw HelperError.usage
    }

    let environment = ProcessInfo.processInfo.environment
    let messageID = environment["MM_MESSAGE_ID"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !messageID.isEmpty else { throw HelperError.missingMessageID }

    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let body = String(data: input, encoding: .utf8) else {
        throw HelperError.invalidBodyEncoding
    }

    let metadata = MessageMetadata(
        sender: environment["MM_FROM"] ?? "",
        subject: environment["MM_SUBJECT"] ?? "",
        date: parseDate(environment["MM_DATE"]),
        messageID: messageID
    )
    CodeFillObservability.helperLogger.info("event=helper_input_received input_bytes=\(input.count, privacy: .public) \(CodeFillObservability.metadataSummary(metadata), privacy: .public)")
    let parser = OTPParser(lifetime: CodeFillConfiguration.recordLifetime)
    guard let record = parser.parse(body: body, metadata: metadata) else {
        CodeFillObservability.parserLogger.info("event=otp_parse outcome=no_match \(CodeFillObservability.metadataSummary(metadata), privacy: .public) duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
        CodeFillObservability.helperLogger.info("event=helper_finished outcome=no_code duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
        return
    }

    CodeFillObservability.parserLogger.info("event=otp_parse outcome=match \(CodeFillObservability.recordSummary(record), privacy: .public) duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")

    let store = try CodeStore(applicationGroupIdentifier: CodeFillConfiguration.applicationGroupIdentifier)
    try store.append(record)
    DistributedNotificationCenter.default().post(
        name: CodeFillConfiguration.recordsDidChangeNotification,
        object: nil
    )
    CodeFillObservability.helperLogger.info("event=helper_finished outcome=stored duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
}

private func elapsedMilliseconds(since start: Date) -> Int {
    Int(Date().timeIntervalSince(start) * 1_000)
}

private func parseDate(_ value: String?) -> Date? {
    guard let value, !value.isEmpty else { return nil }
    let formatter = ISO8601DateFormatter()
    return formatter.date(from: value)
}

do {
    try run()
} catch {
    CodeFillObservability.helperLogger.error("event=helper_finished outcome=error error=\(CodeFillObservability.errorSummary(error), privacy: .public)")
    let message = "MailMateCodeFillHelper: \(error)\n"
    FileHandle.standardError.write(Data(message.utf8))
    Foundation.exit(EXIT_FAILURE)
}
