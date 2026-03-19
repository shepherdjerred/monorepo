import ServiceManagement
import SwiftUI
import UserNotifications

@main
struct TipsApp: App {
    // MARK: Lifecycle

    init() {
        let state = AppState(tipsDirectory: Self.findContentDirectory())
        _appState = State(initialValue: state)

        if NotificationManager.isAvailable {
            UNUserNotificationCenter.current().delegate = self.notificationDelegate

            Task { @MainActor in
                let granted = await NotificationManager.requestPermission()
                if granted, let tip = state.currentTip {
                    NotificationManager.scheduleDailyNotification(tip: tip)
                }
            }
        }
    }

    // MARK: Internal

    var body: some Scene {
        MenuBarExtra("Tips", systemImage: "lightbulb.fill") {
            MenuBarPopover(appState: self.appState)
        }
        .menuBarExtraStyle(.window)

        Window("Browse Tips", id: "browse") {
            BrowseWindow(appState: self.appState)
        }
        .defaultSize(width: 700, height: 500)

        Settings {
            SettingsView()
        }
    }

    // MARK: Private

    @State private var appState: AppState

    private let notificationDelegate = NotificationDelegate()

    private static func findContentDirectory() -> URL {
        if let resourceURL = Bundle.module.resourceURL {
            let bundledContentURL = resourceURL.appendingPathComponent("content", isDirectory: true)

            if self.containsMarkdownFiles(at: bundledContentURL) {
                return bundledContentURL
            }

            if self.containsMarkdownFiles(at: resourceURL) {
                return resourceURL
            }
        }

        let executableURL = Bundle.main.executableURL
            ?? URL(fileURLWithPath: ProcessInfo.processInfo.arguments[0])
        let possiblePaths = [
            executableURL
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("content"),
            executableURL
                .deletingLastPathComponent()
                .appendingPathComponent("content"),
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                .appendingPathComponent("content"),
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                .deletingLastPathComponent()
                .appendingPathComponent("content")
        ]

        for path in possiblePaths where FileManager.default.fileExists(atPath: path.path) {
            return path
        }

        return possiblePaths[0]
    }

    private static func containsMarkdownFiles(at directory: URL) -> Bool {
        guard let enumerator = FileManager.default.enumerator(
            at: directory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else {
            return false
        }

        while let fileURL = enumerator.nextObject() as? URL {
            if fileURL.pathExtension == "md" {
                return true
            }
        }
        return false
    }
}
