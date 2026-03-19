import AppKit
import Foundation
import UserNotifications

// MARK: - NotificationManager

/// Manages daily tip notification scheduling.
@MainActor
enum NotificationManager {
    /// Whether the app is running inside a proper .app bundle (required for UserNotifications).
    static var isAvailable: Bool {
        Bundle.main.bundleIdentifier != nil
    }

    static func requestPermission() async -> Bool {
        guard self.isAvailable else {
            return false
        }
        let center = UNUserNotificationCenter.current()
        do {
            return try await center.requestAuthorization(options: [.alert, .sound])
        } catch {
            print("Notification permission error: \(error)")
            return false
        }
    }

    /// Schedule a daily notification at the given hour with the current tip content.
    static func scheduleDailyNotification(tip: FlatTip, hour: Int = 9, minute: Int = 0) {
        guard self.isAvailable else {
            return
        }
        let center = UNUserNotificationCenter.current()

        center.removePendingNotificationRequests(withIdentifiers: ["daily-tip"])

        let content = UNMutableNotificationContent()
        content.title = "\(tip.appName) Tip"
        content.subtitle = tip.category
        if let shortcut = tip.shortcut {
            content.body = "\(shortcut) — \(tip.text)"
        } else {
            content.body = tip.text
        }
        content.sound = .default

        var dateComponents = DateComponents()
        dateComponents.hour = hour
        dateComponents.minute = minute

        let trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: true)
        let request = UNNotificationRequest(identifier: "daily-tip", content: content, trigger: trigger)

        center.add(request) { error in
            if let error {
                print("Failed to schedule notification: \(error)")
            }
        }
    }
}

// MARK: - NotificationDelegate

/// Handles notification tap events.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(
        _: UNUserNotificationCenter,
        didReceive _: UNNotificationResponse
    ) async {
        await MainActor.run {
            NSApplication.shared.activate(ignoringOtherApps: true)
        }
    }

    nonisolated func userNotificationCenter(
        _: UNUserNotificationCenter,
        willPresent _: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}
