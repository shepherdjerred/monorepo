import Foundation
import UserNotifications

public enum FacetRetiredNotifications {
    @MainActor
    public static func clearIfNeeded() async {
        let defaults = UserDefaults.standard
        let enabledKey = "Facet.reminders.enabled"
        guard defaults.object(forKey: enabledKey) != nil else { return }

        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests().map(\.identifier)
        center.removePendingNotificationRequests(withIdentifiers: pending.filter(isRetired))
        let delivered = await center.deliveredNotifications().map(\.request.identifier)
        center.removeDeliveredNotifications(withIdentifiers: delivered.filter(isRetired))
        defaults.removeObject(forKey: enabledKey)
    }

    private static func isRetired(_ identifier: String) -> Bool {
        identifier.hasPrefix("facet:reminder:") || identifier.hasPrefix("facet:due:")
    }
}
