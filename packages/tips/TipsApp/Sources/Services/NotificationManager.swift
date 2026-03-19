import AppKit
import Foundation
import os
import UserNotifications

// MARK: - NotificationManager

/// Manages daily tip notification scheduling.
@MainActor
enum NotificationManager {
    // MARK: Internal

    static let browseActionIdentifier = "BROWSE_MORE"

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
            let granted = try await center.requestAuthorization(options: [.alert, .sound])
            if granted {
                self.registerCategories()
            }
            return granted
        } catch {
            Logger.notifications.error("Notification permission error: \(error)")
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
        content.threadIdentifier = "daily-tips"
        content.categoryIdentifier = "DAILY_TIP"

        var dateComponents = DateComponents()
        dateComponents.hour = hour
        dateComponents.minute = minute

        let trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: true)
        let request = UNNotificationRequest(identifier: "daily-tip", content: content, trigger: trigger)

        center.add(request) { error in
            if let error {
                Logger.notifications.error("Failed to schedule notification: \(error)")
            } else {
                Logger.notifications.info("Scheduled daily tip notification for \(hour):\(minute)")
            }
        }
    }

    // MARK: Private

    private static func registerCategories() {
        let browseAction = UNNotificationAction(
            identifier: self.browseActionIdentifier,
            title: "Browse More",
            options: [.foreground]
        )
        let category = UNNotificationCategory(
            identifier: "DAILY_TIP",
            actions: [browseAction],
            intentIdentifiers: [],
            options: []
        )
        UNUserNotificationCenter.current().setNotificationCategories([category])
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
            NSApplication.shared.setActivationPolicy(.regular)
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
