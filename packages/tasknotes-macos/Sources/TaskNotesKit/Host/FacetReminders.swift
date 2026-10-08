public import Foundation
import UserNotifications

private struct PreparedFacetReminder {
    let profileID: String
    let row: FacetReminderRow
    let date: Date
}

public struct FacetReminderDelivery: Sendable {
    public let scheduled: Int
    public let beyondBudget: UInt64
    public let problemCount: UInt64
}

/// Native opt-in and bounded OS delivery. Every resolved firing comes from Rust.
public actor FacetReminders {
    private var center: UNUserNotificationCenter { UNUserNotificationCenter.current() }
    private var generation: UInt64 = 0
    private var scheduling = false
    private var router: FacetNotificationRouter?
    public init() {}

    public func installRouting(opened: @escaping @Sendable (String, String) async -> Void) {
        let delegate = FacetNotificationRouter(opened: opened)
        router = delegate
        center.delegate = delegate
    }

    public func requestEnable() async throws -> Bool {
        generation += 1
        let attempt = generation
        let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
        guard generation == attempt else { throw FacetSyncError.cancelled }
        UserDefaults.standard.set(granted, forKey: "Facet.reminders.enabled")
        return granted
    }

    public func disable() async {
        generation += 1
        let attempt = generation
        UserDefaults.standard.set(false, forKey: "Facet.reminders.enabled")
        let requests = await ownedRequests()
        guard generation == attempt else { return }
        let owned = requests.filter {
            $0.identifier.hasPrefix("facet:")
        }.map(\.identifier)
        center.removePendingNotificationRequests(withIdentifiers: owned)
        center.removeDeliveredNotifications(withIdentifiers: owned)
    }

    public func cancel(profileIDs: Set<String>) async {
        generation += 1
        let attempt = generation
        let requests = await ownedRequests()
        guard generation == attempt else { return }
        let owned = requests.filter {
            guard $0.identifier.hasPrefix("facet:"),
                let profile = $0.content.userInfo["profileId"] as? String
            else { return false }
            return profileIDs.contains(profile)
        }.map(\.identifier)
        center.removePendingNotificationRequests(withIdentifiers: owned)
        center.removeDeliveredNotifications(withIdentifiers: owned)
    }

    public func refresh(engine: FacetEngine, profileIDs: Set<String>) async throws
        -> FacetReminderDelivery
    {
        guard !scheduling else { throw FacetSyncError.cancelled }
        scheduling = true
        defer { scheduling = false }
        guard UserDefaults.standard.bool(forKey: "Facet.reminders.enabled") else {
            return FacetReminderDelivery(scheduled: 0, beyondBudget: 0, problemCount: 0)
        }
        generation += 1
        let attempt = generation
        guard await authorized() else { throw FacetReminderError.permission }
        guard generation == attempt else { throw FacetSyncError.cancelled }
        let previous = await center.pendingNotificationRequests()
        let foreign = previous.filter { !$0.identifier.hasPrefix("facet:") }
        // An explicit app budget, rather than an assumption about the OS quota.
        let capacity = max(0, 64 - foreign.count)
        let plans = try await readPlans(engine: engine, profileIDs: profileIDs, capacity: capacity)
        let rows = try plans.flatMap { plan in
            try plan.rows.map {
                PreparedFacetReminder(
                    profileID: plan.profileID, row: $0, date: try instant($0.fireAt))
            }
        }.sorted {
            if $0.date != $1.date { return $0.date < $1.date }
            return $0.row.notificationId < $1.row.notificationId
        }.prefix(capacity)
        guard generation == attempt else { throw FacetSyncError.cancelled }
        let desired = Set(rows.map { $0.row.notificationId })
        let obsolete = previous.filter {
            $0.identifier.hasPrefix("facet:") && !desired.contains($0.identifier)
        }.map(\.identifier)
        center.removePendingNotificationRequests(withIdentifiers: obsolete)
        center.removeDeliveredNotifications(withIdentifiers: obsolete)
        for reminder in rows {
            guard generation == attempt else { throw FacetSyncError.cancelled }
            try await center.add(
                request(profileID: reminder.profileID, row: reminder.row, date: reminder.date))
            if generation != attempt {
                center.removePendingNotificationRequests(withIdentifiers: [
                    reminder.row.notificationId
                ])
                throw FacetSyncError.cancelled
            }
        }
        let observed = Set(await center.pendingNotificationRequests().map(\.identifier))
        guard desired.isSubset(of: observed) else { throw FacetReminderError.capacity }
        return FacetReminderDelivery(
            scheduled: rows.count,
            beyondBudget: plans.reduce(0) { $0 + $1.totalCount } - UInt64(rows.count),
            problemCount: plans.reduce(0) { $0 + $1.problemCount })
    }

    private func readPlans(engine: FacetEngine, profileIDs: Set<String>, capacity: Int) async throws
        -> [FacetReminderPlan]
    {
        let now = Date.now
        let window = FacetReminderWindow(
            at: now.ISO8601Format(), timezone: TimeZone.current.identifier,
            from: now.ISO8601Format(), to: now.addingTimeInterval(30 * 86400).ISO8601Format())
        var plans: [FacetReminderPlan] = []
        for profile in profileIDs.sorted() {
            let plan = try await FacetReminderPlanReader.read(
                profileID: profile, window: window, maximumRows: capacity,
                fetch: { try await engine.features(profileID: profile, request: $0) })
            plans.append(plan)
        }
        return plans
    }

    private func authorized() async -> Bool {
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return true
        case .denied, .notDetermined: return false
        @unknown default: return false
        }
    }

    private func ownedRequests() async -> [UNNotificationRequest] {
        let pending = await center.pendingNotificationRequests()
        let delivered = await center.deliveredNotifications().map(\.request)
        return pending + delivered
    }

    private func instant(_ text: String) throws -> Date {
        do { return try Date(text, strategy: .iso8601) } catch {
            throw FacetContractError.unsupportedResponse
        }
    }

    private func request(profileID: String, row: FacetReminderRow, date: Date)
        -> UNNotificationRequest
    {
        let content = UNMutableNotificationContent()
        content.title = row.title
        content.body = row.description ?? "Task reminder"
        content.sound = .default
        content.userInfo = ["profileId": profileID, "taskPath": row.taskPath]
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        let components = calendar.dateComponents(
            [.year, .month, .day, .hour, .minute, .second, .nanosecond, .timeZone], from: date)
        return UNNotificationRequest(
            identifier: row.notificationId, content: content,
            trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false))
    }
}

public enum FacetReminderError: Error, LocalizedError {
    case permission, capacity
    public var errorDescription: String? {
        switch self {
        case .permission: "Allow notifications in system settings before enabling reminders."
        case .capacity:
            "The system did not retain every scheduled reminder. Open Facet to refresh reminders."
        }
    }
}
