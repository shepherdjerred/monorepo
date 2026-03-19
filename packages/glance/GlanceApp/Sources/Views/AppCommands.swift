import AppKit
import SwiftUI

// MARK: - AppCommands

/// App-wide menu bar commands for Glance.
struct AppCommands: Commands {
    // MARK: Internal

    var body: some Commands {
        // Replace the About menu item
        CommandGroup(replacing: .appInfo) {
            Button("About Glance") {
                NSApplication.shared.orderFrontStandardAboutPanel(options: [
                    .credits: NSAttributedString(
                        string: "https://github.com/shepherdjerred/monorepo",
                    ),
                ])
            }
        }

        // Replace the default Help menu
        CommandGroup(replacing: .help) {
            Link("Glance Help", destination: self.helpURL)
            Link("Send Feedback", destination: self.feedbackURL)
        }

        // Custom Services menu
        CommandMenu("Services") {
            Button("Refresh All") {
                NotificationCenter.default.post(name: .glanceRefreshAll, object: nil)
            }
            .keyboardShortcut("r", modifiers: .command)

            Divider()

            if let service = selectedService,
               let webURL = service.webURL,
               let url = URL(string: webURL)
            {
                Link("Open in Browser", destination: url)
            } else {
                Button("Open in Browser") {}
                    .disabled(true)
            }
        }

        // View menu additions
        CommandGroup(after: .sidebar) {
            Button("Toggle Sidebar") {
                NotificationCenter.default.post(name: .glanceToggleSidebar, object: nil)
            }
            .keyboardShortcut("s", modifiers: [.command, .shift])

            Button("Toggle Debug Inspector") {
                NotificationCenter.default.post(name: .glanceToggleInspector, object: nil)
            }
            .keyboardShortcut("d", modifiers: [.command, .shift])
        }

        // File menu — Export Diagnostics
        CommandGroup(after: .newItem) {
            Divider()
            Button("Export Diagnostics...") {
                NotificationCenter.default.post(name: .glanceExportDiagnostics, object: nil)
            }
            .keyboardShortcut("e", modifiers: [.command, .shift])
        }
    }

    // MARK: Private

    @FocusedValue(\.selectedService) private var selectedService

    // swiftlint:disable:next force_unwrapping
    private let helpURL = URL(string: "https://github.com/shepherdjerred/monorepo")!
    // swiftlint:disable:next force_unwrapping
    private let feedbackURL = URL(string: "https://github.com/shepherdjerred/monorepo/issues")!
}

extension Notification.Name {
    static let glanceRefreshAll = Notification.Name("glanceRefreshAll")
    static let glanceToggleSidebar = Notification.Name("glanceToggleSidebar")
    static let glanceToggleInspector = Notification.Name("glanceToggleInspector")
    static let glanceExportDiagnostics = Notification.Name("glanceExportDiagnostics")
}
