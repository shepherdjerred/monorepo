import SwiftUI

@main
struct MailMateCodeFillApp: App {
    @NSApplicationDelegateAdaptor(MailMateCodeFillAppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup("MailMate CodeFill") {
            SetupView()
                .frame(minWidth: 560, minHeight: 680)
        }
    }
}

@MainActor
final class MailMateCodeFillAppDelegate: NSObject, NSApplicationDelegate {
    private var observer: NSObjectProtocol?

    static var launchedAsBroker = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        Self.launchedAsBroker = consumeBrokerRequest()
        let version = String(describing: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") ?? "unknown")
        CodeFillObservability.appLogger.info("event=app_started version=\(version, privacy: .public)")
        observer = DistributedNotificationCenter.default().addObserver(
            forName: CodeFillConfiguration.recordsDidChangeNotification,
            object: nil,
            queue: .main
        ) { _ in
            CodeFillObservability.appLogger.info("event=records_changed_notification_received")
            NotificationCenter.default.post(name: .codeFillRecordsDidChange, object: nil)
        }
        if Self.launchedAsBroker {
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: .codeFillRecordsDidChange, object: nil)
            }
        }
    }

    private func consumeBrokerRequest() -> Bool {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: CodeFillConfiguration.applicationGroupIdentifier
        ) else {
            return false
        }
        let markerURL = containerURL.appendingPathComponent(CodeFillConfiguration.brokerRequestFileName)
        guard FileManager.default.fileExists(atPath: markerURL.path) else {
            return false
        }
        do {
            try FileManager.default.removeItem(at: markerURL)
        } catch {
            CodeFillObservability.appLogger.error("event=broker_request outcome=marker_remove_error error=\(CodeFillObservability.errorSummary(error), privacy: .public)")
        }
        return true
    }

}

extension Notification.Name {
    static let codeFillRecordsDidChange = Notification.Name("com.sjerred.MailMateCodeFill.appRecordsDidChange")
}
