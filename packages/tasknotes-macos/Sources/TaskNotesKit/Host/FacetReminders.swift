public import Foundation
import UserNotifications

public struct FacetReminderDelivery: Sendable, Equatable {
    public let scheduled: Int
    public let beyondBudget: Int

    public init(scheduled: Int, beyondBudget: Int) {
        self.scheduled = scheduled
        self.beyondBudget = beyondBudget
    }
}

public enum FacetReminderError: Error, LocalizedError, Sendable, Equatable {
    case permissionDenied
    case cancelled

    public var errorDescription: String? {
        switch self {
        case .permissionDenied:
            "Allow notifications in System Settings before enabling task reminders."
        case .cancelled:
            "Reminder scheduling was superseded by a newer update."
        }
    }
}

internal struct ResolvedReminderCandidate: Sendable {
    let identifier: String
    let taskID: String
    let title: String
    let body: String
    let fireDate: Date
}

/// Schedules bounded OS local notifications from `Protocol.Reminder` and `Task.due_datetime`.
public actor FacetReminders {
    public static let enabledDefaultsKey = "Facet.reminders.enabled"

    private let suiteName: String?
    private var generation: UInt64 = 0
    private var router: FacetNotificationRouter?

    public init(suiteName: String? = nil) {
        self.suiteName = suiteName
    }

    private var defaults: UserDefaults {
        if let suiteName, let suite = UserDefaults(suiteName: suiteName) {
            return suite
        }
        return .standard
    }

    private var center: UNUserNotificationCenter {
        UNUserNotificationCenter.current()
    }

    public func isEnabled() -> Bool {
        defaults.bool(forKey: Self.enabledDefaultsKey)
    }

    public func installRouting(opened: @escaping @Sendable (String) async -> Void) {
        let delegate = FacetNotificationRouter(opened: opened)
        router = delegate
        center.delegate = delegate
    }

    public func requestEnable() async throws -> Bool {
        generation += 1
        let attempt = generation
        let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
        guard generation == attempt else { throw FacetReminderError.cancelled }
        defaults.set(granted, forKey: Self.enabledDefaultsKey)
        return granted
    }

    public func disable() async {
        generation += 1
        let attempt = generation
        defaults.set(false, forKey: Self.enabledDefaultsKey)
        let pending = await center.pendingNotificationRequests()
        let delivered = await center.deliveredNotifications().map(\.request)
        guard generation == attempt else { return }
        let owned = (pending + delivered)
            .map(\.identifier)
            .filter { $0.hasPrefix("facet:") }
        center.removePendingNotificationRequests(withIdentifiers: owned)
        center.removeDeliveredNotifications(withIdentifiers: owned)
    }

    public func refresh(
        tasks: [Task],
        reminders: [Reminder],
        now: Date = .now
    ) async throws -> FacetReminderDelivery {
        guard defaults.bool(forKey: Self.enabledDefaultsKey) else {
            return FacetReminderDelivery(scheduled: 0, beyondBudget: 0)
        }
        generation += 1
        let attempt = generation
        guard await isAuthorized() else {
            throw FacetReminderError.permissionDenied
        }
        guard generation == attempt else { throw FacetReminderError.cancelled }

        let existing = await center.pendingNotificationRequests()
        let foreignCount = existing.filter { !$0.identifier.hasPrefix("facet:") }.count
        let budget = max(0, 64 - foreignCount)
        let candidates = Self.resolveCandidates(tasks: tasks, reminders: reminders, now: now)
        let chosen = Array(candidates.prefix(budget))
        let desiredIDs = Set(chosen.map(\.identifier))
        let obsolete =
            existing
            .map(\.identifier)
            .filter { $0.hasPrefix("facet:") && !desiredIDs.contains($0) }

        center.removePendingNotificationRequests(withIdentifiers: obsolete)
        center.removeDeliveredNotifications(withIdentifiers: obsolete)

        for candidate in chosen {
            guard generation == attempt else { throw FacetReminderError.cancelled }
            try await center.add(makeRequest(for: candidate))
        }
        return FacetReminderDelivery(
            scheduled: chosen.count,
            beyondBudget: max(0, candidates.count - chosen.count)
        )
    }

    internal static func resolveCandidates(
        tasks: [Task],
        reminders: [Reminder],
        now: Date
    ) -> [ResolvedReminderCandidate] {
        let openTasksByID = Dictionary(
            uniqueKeysWithValues: tasks.filter { !$0.is_deleted && !$0.completed }.map {
                ($0.id, $0)
            }
        )
        var explicitTaskIDs: Set<String> = []
        var candidates: [ResolvedReminderCandidate] = []

        for reminder in reminders where !reminder.is_deleted && !reminder.is_notified {
            guard let task = openTasksByID[reminder.task_id],
                let fireDate = fireDate(for: reminder, task: task),
                fireDate > now
            else { continue }
            explicitTaskIDs.insert(task.id)
            candidates.append(
                ResolvedReminderCandidate(
                    identifier: "facet:reminder:\(reminder.id)",
                    taskID: task.id,
                    title: task.title,
                    body: task.description.isEmpty ? "Task reminder" : task.description,
                    fireDate: fireDate
                )
            )
        }

        for task in openTasksByID.values where !explicitTaskIDs.contains(task.id) {
            guard let rawDue = task.due_datetime,
                !rawDue.isEmpty,
                let fireDate = ViewerCalendar.parseISO8601(rawDue),
                fireDate > now
            else { continue }
            candidates.append(
                ResolvedReminderCandidate(
                    identifier: "facet:due:\(task.id)",
                    taskID: task.id,
                    title: task.title,
                    body: task.description.isEmpty ? "Due now" : task.description,
                    fireDate: fireDate
                )
            )
        }

        return candidates.sorted { left, right in
            if left.fireDate != right.fireDate { return left.fireDate < right.fireDate }
            return left.identifier < right.identifier
        }
    }

    private static func fireDate(for reminder: Reminder, task: Task) -> Date? {
        if let explicit = reminder.due_datetime,
            !explicit.isEmpty,
            let parsed = ViewerCalendar.parseISO8601(explicit)
        {
            return parsed
        }
        if let offset = reminder.minute_offset,
            let taskDue = task.due_datetime,
            !taskDue.isEmpty,
            let base = ViewerCalendar.parseISO8601(taskDue)
        {
            return base.addingTimeInterval(TimeInterval(-Int(offset) * 60))
        }
        return nil
    }

    private func isAuthorized() async -> Bool {
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .denied, .notDetermined:
            return false
        @unknown default:
            return false
        }
    }

    private func makeRequest(for candidate: ResolvedReminderCandidate) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = candidate.title
        content.body = candidate.body
        content.sound = .default
        content.userInfo = ["taskId": candidate.taskID]

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        let components = calendar.dateComponents(
            [.year, .month, .day, .hour, .minute, .second, .timeZone],
            from: candidate.fireDate
        )
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        return UNNotificationRequest(
            identifier: candidate.identifier,
            content: content,
            trigger: trigger
        )
    }
}
