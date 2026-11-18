public import Foundation
public import UserNotifications

/// Notification delegate routing tapped `facet:` notifications back to a task ID.
public final class FacetNotificationRouter: NSObject, UNUserNotificationCenterDelegate {
    private let opened: @Sendable (String) async -> Void

    public init(opened: @escaping @Sendable (String) async -> Void) {
        self.opened = opened
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let request = response.notification.request
        guard request.identifier.hasPrefix("facet:"),
            let taskID = request.content.userInfo["taskId"] as? String
        else { return }
        await opened(taskID)
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        notification.request.identifier.hasPrefix("facet:") ? [.banner, .sound] : []
    }
}
