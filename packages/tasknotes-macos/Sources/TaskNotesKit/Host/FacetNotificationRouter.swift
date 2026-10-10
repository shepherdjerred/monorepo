public import Foundation
public import UserNotifications

/// The notification carries only a profile/path projection, never credentials.
public final class FacetNotificationRouter: NSObject, UNUserNotificationCenterDelegate {
    private let opened: @Sendable (String, String) async -> Void
    public init(opened: @escaping @Sendable (String, String) async -> Void) {
        self.opened = opened
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
    ) async {
        let request = response.notification.request
        guard request.identifier.hasPrefix("facet:"),
            let profile = request.content.userInfo["profileId"] as? String,
            let path = request.content.userInfo["taskPath"] as? String
        else { return }
        await opened(profile, path)
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        notification.request.identifier.hasPrefix("facet:") ? [.banner, .sound] : []
    }
}
