import Foundation
import OSLog
@preconcurrency import UserNotifications

// MARK: - NotificationManager

/// Manages user notifications for service status transitions.
///
/// Tracks previous status per provider and sends notifications when
/// meaningful transitions occur (ok->error, ok->warning, error->ok).
final class NotificationManager: NSObject, Sendable {
    // MARK: Lifecycle

    override init() {
        self.center = UNUserNotificationCenter.current()
        self.previousStatuses = OSAllocatedUnfairLock(initialState: [:])
        super.init()
        self.center.delegate = self
    }

    // MARK: Internal

    /// Request notification authorization from the user.
    func requestAuthorization() async {
        do {
            let granted = try await self.center.requestAuthorization(options: [.alert, .sound])
            GlanceLogger.notifications.info(
                "Notification authorization \(granted ? "granted" : "denied", privacy: .public)",
            )
        } catch {
            GlanceLogger.notifications.error(
                "Failed to request notification authorization: \(error.localizedDescription, privacy: .public)",
            )
        }
    }

    /// Process new snapshots, comparing against previous statuses
    /// and sending notifications for meaningful transitions.
    func processSnapshots(
        _ snapshots: [ServiceSnapshot],
        notificationsEnabled: Bool,
    ) {
        guard notificationsEnabled else {
            return
        }

        self.previousStatuses.withLock { previous in
            for snapshot in snapshots {
                let oldStatus = previous[snapshot.id]
                let newStatus = snapshot.status

                // Only notify on meaningful transitions from a known previous state.
                if let oldStatus, self.shouldNotify(from: oldStatus, to: newStatus) {
                    self.sendNotification(
                        snapshot: snapshot,
                        previousStatus: oldStatus,
                    )
                }

                previous[snapshot.id] = newStatus
            }
        }
    }

    /// Register notification categories and actions.
    func registerCategories() {
        let openDashboardAction = UNNotificationAction(
            identifier: "OPEN_DASHBOARD",
            title: "Open Dashboard",
        )

        let category = UNNotificationCategory(
            identifier: "SERVICE_STATUS",
            actions: [openDashboardAction],
            intentIdentifiers: [],
        )

        self.center.setNotificationCategories([category])
    }

    // MARK: Private

    // swiftlint:disable:next modifier_order
    private nonisolated(unsafe) let center: UNUserNotificationCenter
    private let previousStatuses: OSAllocatedUnfairLock<[String: ServiceStatus]>

    /// Determine whether a status transition warrants a notification.
    private func shouldNotify(from oldStatus: ServiceStatus, to newStatus: ServiceStatus) -> Bool {
        let isTransition =
            switch (oldStatus, newStatus) {
            case (.ok, .error),
                 (.ok, .warning),
                 (.warning, .error):
                true
            case (.error, .ok),
                 (.warning, .ok):
                // Recovery notification
                true
            default:
                false
            }

        guard isTransition else {
            return false
        }

        // When Focus Filter "critical only" is active, suppress non-error notifications.
        if UserDefaults.standard.bool(forKey: "focusCriticalOnly") {
            return newStatus == .error
        }

        return true
    }

    /// Send a notification for a status transition.
    private func sendNotification(
        snapshot: ServiceSnapshot,
        previousStatus: ServiceStatus,
    ) {
        let content = UNMutableNotificationContent()

        let isRecovery = snapshot.status == .ok
        if isRecovery {
            content.title = "\(snapshot.displayName) Recovered"
            content.body = "Status changed from \(previousStatus.label) to \(snapshot.status.label)"
        } else {
            content.title = "\(snapshot.displayName) \(snapshot.status.label)"
            content.body = snapshot.summary
            if snapshot.status == .error {
                content.sound = .default
            }
        }

        content.threadIdentifier = snapshot.id
        content.categoryIdentifier = "SERVICE_STATUS"

        let request = UNNotificationRequest(
            identifier: "\(snapshot.id)-\(Date.now.timeIntervalSince1970)",
            content: content,
            trigger: nil,
        )

        self.center.add(request) { error in
            if let error {
                let desc = error.localizedDescription
                GlanceLogger.notifications.error(
                    "Failed to deliver notification for \(snapshot.id, privacy: .public): \(desc, privacy: .public)",
                )
            }
        }
    }
}

// MARK: UNUserNotificationCenterDelegate

extension NotificationManager: UNUserNotificationCenterDelegate {
    /// Handle notification taps and actions while the app is in the foreground.
    func userNotificationCenter(
        _: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void,
    ) {
        switch response.actionIdentifier {
        case "OPEN_DASHBOARD",
             UNNotificationDefaultActionIdentifier:
            // Post notification to open the dashboard window.
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: .glanceOpenDashboard, object: nil)
            }
        default:
            break
        }
        completionHandler()
    }

    /// Allow notifications to be displayed even when the app is in the foreground.
    func userNotificationCenter(
        _: UNUserNotificationCenter,
        willPresent _: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void,
    ) {
        completionHandler([.banner, .sound])
    }
}

extension Notification.Name {
    static let glanceOpenDashboard = Notification.Name("glanceOpenDashboard")
}
