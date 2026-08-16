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

private final class MailMateCodeFillAppDelegate: NSObject, NSApplicationDelegate {
    private var observer: NSObjectProtocol?

    func applicationDidFinishLaunching(_ notification: Notification) {
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
    }

    deinit {
        if let observer {
            DistributedNotificationCenter.default().removeObserver(observer)
        }
    }
}

extension Notification.Name {
    static let codeFillRecordsDidChange = Notification.Name("com.sjerred.MailMateCodeFill.appRecordsDidChange")
}
