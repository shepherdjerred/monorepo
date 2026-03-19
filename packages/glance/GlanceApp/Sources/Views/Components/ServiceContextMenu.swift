import AppKit
import SwiftUI

// MARK: - ServiceContextMenu

/// Context menu for service rows in sidebar and popover.
struct ServiceContextMenu: View {
    // MARK: Internal

    let snapshot: ServiceSnapshot
    var settings: GlanceSettings?

    var body: some View {
        if let urlString = snapshot.webURL,
           let url = URL(string: urlString)
        {
            Button(String(localized: "Open in Browser")) {
                self.openURL(url)
            }
        }

        Button(String(localized: "Copy Status")) {
            let statusText = "\(self.snapshot.displayName): \(self.snapshot.status.label) - \(self.snapshot.summary)"
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(statusText, forType: .string)
        }

        Button(String(localized: "Refresh This Service")) {
            NotificationCenter.default.post(
                name: .glanceRefreshService,
                object: self.snapshot.id,
            )
        }

        Divider()

        if let settings {
            let isEnabled = settings.enabledProviderIds.contains(self.snapshot.id)
            Button(isEnabled ? String(localized: "Disable Service") : String(localized: "Enable Service")) {
                if isEnabled {
                    settings.enabledProviderIds.remove(self.snapshot.id)
                } else {
                    settings.enabledProviderIds.insert(self.snapshot.id)
                }
            }
        }
    }

    // MARK: Private

    @Environment(\.openURL) private var openURL
}

extension Notification.Name {
    static let glanceRefreshService = Notification.Name("glanceRefreshService")
}
