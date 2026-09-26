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

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // The helper launches this app hidden as a short-lived reconciliation broker. If the
        // setup window is closed, let that broker exit after its records are reconciled. A normal
        // setup app remains alive so the provider's post-consumption notification still reaches
        // an identity-store owner after the user closes the window.
        Self.launchedAsBroker
    }

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
        // A helper can write the marker after this method has consumed it but before AppKit
        // reports that launch finished. Check again on the next run-loop turn and when the app
        // becomes active so that marker ownership is acknowledged during this launch, never a
        // later user launch.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.acknowledgeBrokerRequestIfPresent()
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
            return false
        }
        return true
    }

    private func acknowledgeBrokerRequestIfPresent() {
        guard consumeBrokerRequest() else { return }
        Self.launchedAsBroker = true
        CodeFillObservability.appLogger.info("event=broker_request outcome=acknowledged")
        NotificationCenter.default.post(name: .codeFillBrokerModeDidChange, object: nil)
        NotificationCenter.default.post(name: .codeFillRecordsDidChange, object: nil)
    }

}

extension Notification.Name {
    static let codeFillRecordsDidChange = Notification.Name("com.sjerred.MailMateCodeFill.appRecordsDidChange")
    static let codeFillBrokerModeDidChange = Notification.Name("com.sjerred.MailMateCodeFill.appBrokerModeDidChange")
}
