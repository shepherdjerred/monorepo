import Foundation
import AppKit
import Darwin
#if SWIFT_PACKAGE
import MailMateCodeFillShared
#endif

private enum HelperError: Error, CustomStringConvertible {
    case usage
    case invalidBodyEncoding
    case invalidMessageDate
    case missingMessageID
    case inputTooLarge(Int)

    var description: String {
        switch self {
        case .usage:
            return "usage: MailMateCodeFillHelper --mailmate"
        case .invalidBodyEncoding:
            return "MailMate supplied a body that is not valid UTF-8"
        case .invalidMessageDate:
            return "MailMate supplied an invalid message date"
        case .missingMessageID:
            return "MailMate did not provide MM_MESSAGE_ID"
        case let .inputTooLarge(limit):
            return "MailMate supplied a body larger than \(limit) bytes"
        }
    }
}

private let maximumInputBytes = 1_048_576

// A verification-code mail is tiny, so reading an arbitrarily large body into memory only risks
// spiking or killing the helper. Read in chunks and stop as soon as the cap is exceeded.
private func readBoundedInput() throws -> Data {
    let handle = FileHandle.standardInput
    var input = Data()
    while let chunk = try handle.read(upToCount: 65_536), !chunk.isEmpty {
        input.append(chunk)
        if input.count > maximumInputBytes {
            throw HelperError.inputTooLarge(maximumInputBytes)
        }
    }
    return input
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

    let input = try readBoundedInput()
    guard let body = String(data: input, encoding: .utf8) else {
        throw HelperError.invalidBodyEncoding
    }

    let messageDate = try parseDate(environment["MM_DATE"])
    let metadata = MessageMetadata(
        sender: environment["MM_FROM"] ?? "",
        subject: environment["MM_SUBJECT"] ?? "",
        date: messageDate,
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
    requestIdentityReconciliation()
    CodeFillObservability.helperLogger.info("event=helper_finished outcome=stored duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
}

// MailMate launches the helper independently of the containing app. Launch the app hidden so
// its startup reconciliation can register the new identity even when the setup window is closed.
// The distributed notification above still handles the common case where the app is already up.
private func requestIdentityReconciliation() {
    let appURL = Bundle.main.bundleURL
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    guard appURL.pathExtension == "app" else {
        CodeFillObservability.helperLogger.error("event=identity_reconciliation outcome=invalid_containing_app_path")
        return
    }

    if let bundleIdentifier = Bundle(url: appURL)?.bundleIdentifier,
       NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).contains(where: { !$0.isTerminated }) {
        CodeFillObservability.helperLogger.info("event=identity_reconciliation outcome=already_running")
        return
    }
    writeBrokerRequestMarker()

    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = false
    configuration.hides = true
    configuration.promptsUserIfNeeded = false
    NSWorkspace.shared.openApplication(at: appURL, configuration: configuration) { _, error in
        if let error {
            CodeFillObservability.helperLogger.error("event=identity_reconciliation outcome=error error=\(CodeFillObservability.errorSummary(error), privacy: .public)")
        } else {
            CodeFillObservability.helperLogger.info("event=identity_reconciliation outcome=launched")
        }
    }
}

private func writeBrokerRequestMarker() {
    guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: CodeFillConfiguration.applicationGroupIdentifier
    ) else {
        CodeFillObservability.helperLogger.error("event=identity_reconciliation outcome=app_group_unavailable")
        return
    }
    let markerURL = containerURL.appendingPathComponent(CodeFillConfiguration.brokerRequestFileName)
    do {
        try Data().write(to: markerURL, options: .atomic)
    } catch {
        CodeFillObservability.helperLogger.error("event=identity_reconciliation outcome=marker_write_error error=\(CodeFillObservability.errorSummary(error), privacy: .public)")
    }
}

private func elapsedMilliseconds(since start: Date) -> Int {
    Int(Date().timeIntervalSince(start) * 1_000)
}

private func parseDate(_ value: String?) throws -> Date? {
    guard let value else { return nil }
    let normalizedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedValue.isEmpty else { return nil }

    let iso8601Formatter = ISO8601DateFormatter()
    if let date = iso8601Formatter.date(from: normalizedValue) {
        return date
    }

    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    for format in ["EEE, dd MMM yyyy HH:mm:ss Z", "yyyy-MM-dd HH:mm:ss Z"] {
        formatter.dateFormat = format
        if let date = formatter.date(from: normalizedValue) {
            return date
        }
    }

    throw HelperError.invalidMessageDate
}

do {
    try run()
} catch {
    CodeFillObservability.helperLogger.error("event=helper_finished outcome=error error=\(CodeFillObservability.errorSummary(error), privacy: .public)")
    let message = "MailMateCodeFillHelper: \(error)\n"
    FileHandle.standardError.write(Data(message.utf8))
    Darwin.exit(EXIT_FAILURE)
}
