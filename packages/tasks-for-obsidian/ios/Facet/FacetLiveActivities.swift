import ActivityKit
import Foundation
import TaskNotesKit

struct FacetActivityOwner {
    let profileID: String
    let engineIdentity: String
}

/// The foreground application remains the only runtime writer. OS effects are
/// serialized; supersession immediately fences every later effect of a read.
@MainActor
final class FacetLiveActivities {
    private struct Observed {
        let id: String
        let attributes: TimeTrackingAttributes
    }
    private enum Retirement {
        case superseded
        case retained([Observed])
    }
    private var generation: UInt64 = 0
    private var tail: Task<Void, Never>?

    func replace(
        owner: FacetActivityOwner, plan: FacetTrackingPlan,
        isCurrent: @escaping @MainActor () -> Bool
    ) async throws -> String? {
        guard plan.profileID == owner.profileID else {
            throw FacetContractError.unsupportedResponse
        }
        generation += 1
        let attempt = generation
        let preceding = tail
        let operation = Task { @MainActor in
            await preceding?.value
            guard attempt == self.generation, isCurrent(), !Task.isCancelled else {
                return nil as String?
            }
            return try await self.apply(owner: owner, plan: plan) {
                attempt == self.generation && isCurrent() && !Task.isCancelled
            }
        }
        tail = Task { _ = await operation.result }
        return try await operation.value
    }

    /// Capture and retire only this account's activities. New replacement work
    /// waits for the retirement, and can never be ended by its old async tail.
    func cancelOwned(profileIDs: Set<String>) async {
        generation += 1
        let preceding = tail
        let retiring = Activity<TimeTrackingAttributes>.activities.filter {
            profileIDs.contains($0.attributes.profileID)
        }.map(\.id)
        let operation = Task { @MainActor in
            await preceding?.value
            for id in retiring { await Self.endActivity(id: id) }
        }
        tail = operation
        await operation.value
    }

    private func apply(
        owner: FacetActivityOwner, plan: FacetTrackingPlan,
        isCurrent: () -> Bool
    ) async throws -> String? {
        let observed = try Date.ISO8601FormatStyle().parse(plan.at)
        let existing: [Observed]
        switch await retireSuperseded(owner: owner, plan: plan, isCurrent: isCurrent) {
        case .superseded: return nil
        case .retained(let rows): existing = rows
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            return "Live Activities are disabled in system settings. Tracking continues in Facet."
        }
        for row in plan.rows {
            guard isCurrent() else { return nil }
            let state = TimeTrackingAttributes.ContentState(
                taskTitle: boundedText(row.title, bytes: 512),
                projectLabels: row.projectLabels.prefix(3).map { boundedText($0, bytes: 128) },
                taskRevision: row.taskRevision, elapsedSeconds: row.elapsedSeconds,
                observedAt: observed)
            let content = ActivityContent(state: state, staleDate: observed.addingTimeInterval(300))
            if let activity = existing.first(where: { $0.attributes.sessionID == row.sessionId }) {
                await Self.updateActivity(id: activity.id, content: content)
            } else {
                let attributes = TimeTrackingAttributes(
                    profileID: owner.profileID, engineIdentity: owner.engineIdentity,
                    sessionID: row.sessionId, taskPath: row.taskPath,
                    startedAt: try Date.ISO8601FormatStyle().parse(row.startedAt))
                let created = try Activity.request(
                    attributes: attributes, content: content, pushType: nil)
                if !isCurrent() { await created.end(nil, dismissalPolicy: .immediate) }
            }
            guard isCurrent() else { return nil }
        }
        return plan.totalCount > UInt64(plan.rows.count)
            ? "Additional running sessions are available in Facet." : nil
    }

    private func retireSuperseded(
        owner: FacetActivityOwner, plan: FacetTrackingPlan, isCurrent: () -> Bool
    ) async -> Retirement {
        let owned = Activity<TimeTrackingAttributes>.activities.filter {
            $0.attributes.profileID == owner.profileID
        }.map { Observed(id: $0.id, attributes: $0.attributes) }
        for activity in owned where activity.attributes.engineIdentity != owner.engineIdentity {
            guard isCurrent() else { return .superseded }
            await Self.endActivity(id: activity.id)
            guard isCurrent() else { return .superseded }
        }
        let existing = owned.filter { $0.attributes.engineIdentity == owner.engineIdentity }
        let desired = Set(plan.rows.map(\.sessionId))
        for activity in existing where !desired.contains(activity.attributes.sessionID) {
            guard isCurrent() else { return .superseded }
            await Self.endActivity(id: activity.id)
            guard isCurrent() else { return .superseded }
        }
        return .retained(existing)
    }

    /// ActivityKit's concurrent methods receive fresh local references. The
    /// MainActor keeps only immutable IDs/attributes across suspension points.
    private nonisolated static func endActivity(id: String) async {
        guard
            let activity = Activity<TimeTrackingAttributes>.activities.first(where: { $0.id == id })
        else { return }
        await activity.end(nil, dismissalPolicy: .immediate)
    }

    private nonisolated static func updateActivity(
        id: String, content: ActivityContent<TimeTrackingAttributes.ContentState>
    ) async {
        guard
            let activity = Activity<TimeTrackingAttributes>.activities.first(where: { $0.id == id })
        else { return }
        await activity.update(content)
    }

    private func boundedText(_ text: String, bytes maximum: Int) -> String {
        var result = String.UnicodeScalarView()
        var count = 0
        for scalar in text.unicodeScalars {
            let length = String(scalar).utf8.count
            if count + length > maximum { break }
            result.append(scalar)
            count += length
        }
        return String(result)
    }
}
