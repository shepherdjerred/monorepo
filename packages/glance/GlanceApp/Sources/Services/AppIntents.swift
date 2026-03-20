import AppIntents
import Foundation

// MARK: - GlanceAppShortcuts

/// Registers App Shortcuts for Siri and the Shortcuts app.
struct GlanceAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: GetOverallHealthIntent(),
            phrases: [
                "Check my homelab with \(.applicationName)",
                "How is my homelab in \(.applicationName)",
            ],
            shortTitle: "Check Homelab Health",
            systemImageName: "heart.text.clipboard",
        )
        AppShortcut(
            intent: RefreshAllIntent(),
            phrases: [
                "Refresh \(.applicationName)",
                "Refresh all services in \(.applicationName)",
            ],
            shortTitle: "Refresh All Services",
            systemImageName: "arrow.clockwise",
        )
        AppShortcut(
            intent: GetServiceStatusIntent(),
            phrases: [
                "Check service status with \(.applicationName)",
            ],
            shortTitle: "Check Service Status",
            systemImageName: "magnifyingglass",
        )
    }
}

// MARK: - GetServiceStatusIntent

/// Returns the current status of a specific service by name.
struct GetServiceStatusIntent: AppIntent {
    static let title: LocalizedStringResource = "Get Service Status"
    static let description: IntentDescription = "Check the current status of a specific homelab service."

    @Parameter(
        title: "Service Name",
        description: "The name of the service to check.",
    )
    var serviceName: String

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let appState = AppIntentStateProvider.shared.appState
        guard let appState else {
            return .result(value: "Glance is not running.")
        }

        // Find the matching snapshot by display name (case-insensitive).
        let lowered = self.serviceName.lowercased()
        guard let snapshot = appState.snapshots.first(where: {
            $0.displayName.lowercased() == lowered
                || $0.id.lowercased() == lowered
        }) else {
            let available = appState.snapshots.map(\.displayName).joined(separator: ", ")
            return .result(
                value: "No service named \"\(self.serviceName)\" found. Available: \(available)",
            )
        }

        let statusLabel = snapshot.status.label.lowercased()
        return .result(value: "\(snapshot.displayName) is \(statusLabel): \(snapshot.summary)")
    }
}

// MARK: - GetOverallHealthIntent

/// Returns a summary of overall homelab health.
struct GetOverallHealthIntent: AppIntent {
    static let title: LocalizedStringResource = "Get Overall Health"
    static let description: IntentDescription = "Get an overall health summary of all monitored homelab services."

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let appState = AppIntentStateProvider.shared.appState
        guard let appState else {
            return .result(value: "Glance is not running.")
        }

        let snapshots = appState.snapshots
        guard !snapshots.isEmpty else {
            return .result(value: "No services are being monitored.")
        }

        let okCount = snapshots.count(where: { $0.status == .ok })
        let warningCount = snapshots.count(where: { $0.status == .warning })
        let errorCount = snapshots.count(where: { $0.status == .error })
        let unknownCount = snapshots.count(where: { $0.status == .unknown })
        let total = snapshots.count

        if okCount == total {
            return .result(value: "All \(total) services healthy.")
        }

        var parts: [String] = []
        if errorCount > 0 {
            parts.append("\(errorCount) error\(errorCount == 1 ? "" : "s")")
        }
        if warningCount > 0 {
            parts.append("\(warningCount) warning\(warningCount == 1 ? "" : "s")")
        }
        if unknownCount > 0 {
            parts.append("\(unknownCount) unknown")
        }
        if okCount > 0 {
            parts.append("\(okCount) healthy")
        }
        return .result(value: "\(parts.joined(separator: ", ")) out of \(total) services.")
    }
}

// MARK: - RefreshAllIntent

/// Triggers a refresh of all service providers.
struct RefreshAllIntent: AppIntent {
    static let title: LocalizedStringResource = "Refresh All Services"
    static let description: IntentDescription = "Trigger an immediate refresh of all monitored homelab services."

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let appState = AppIntentStateProvider.shared.appState
        guard let appState else {
            return .result(value: "Glance is not running.")
        }

        await appState.refreshNow()
        return .result(value: "Refreshed \(appState.snapshots.count) services.")
    }
}

// MARK: - AppIntentStateProvider

/// Shared bridge between App Intents and the running AppState.
///
/// The app sets `appState` at launch so intents can access live data.
@MainActor
final class AppIntentStateProvider {
    // MARK: Lifecycle

    private init() {}

    // MARK: Internal

    static let shared = AppIntentStateProvider()

    var appState: AppState?
}

// MARK: - GlanceFocusFilter

/// Focus Filter that lets users configure which notifications appear
/// during a Focus mode. When enabled, only critical (error-level)
/// alerts are shown during the active Focus.
struct GlanceFocusFilter: SetFocusFilterIntent {
    static let title: LocalizedStringResource = "Glance Notifications"
    static let description: IntentDescription =
        "Configure Glance notifications during this Focus."

    @Parameter(title: "Show only critical alerts")
    var criticalOnly: Bool?

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: (self.criticalOnly ?? false)
                ? "Critical alerts only"
                : "All notifications",
        )
    }

    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set(
            self.criticalOnly ?? false,
            forKey: "focusCriticalOnly",
        )
        return .result()
    }
}
