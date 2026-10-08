public struct FacetReminderCursor: Codable, Sendable, Equatable {
    public let fireAt: String
    public let reminderId: String
    public let taskPath: String
}

public struct FacetReminderRow: Decodable, Sendable, Equatable {
    public let notificationId: String
    public let taskPath: String
    public let title: String
    public let taskRevision: String
    public let reminderId: String
    public let fireAt: String
    public let occurrenceDate: String?
    public let description: String?
}

public struct FacetReminderProblem: Decodable, Sendable {
    public let taskPath: String
    public let reminderId: String?
    public let code: String
}

internal struct FacetReminderPage: Decodable, Sendable {
    let profileId: String
    let version: UInt64
    let totalCount: UInt64
    let rows: [FacetReminderRow]
    let nextCursor: FacetReminderCursor?
    let problemCount: UInt64
    let problems: [FacetReminderProblem]
}

public struct FacetReminderPlan: Sendable {
    public let profileID: String
    public let version: UInt64
    public let totalCount: UInt64
    public let rows: [FacetReminderRow]
    public let problemCount: UInt64
    public let problems: [FacetReminderProblem]
}

public struct FacetReminderWindow: Sendable {
    public let at: String
    public let timezone: String
    public let from: String
    public let to: String
    public init(at: String, timezone: String, from: String, to: String) {
        self.at = at
        self.timezone = timezone
        self.from = from
        self.to = to
    }
}

/// Reads every fenced page, retaining only the nearest native scheduling budget.
/// A failed or changed plan never yields a partial replacement for OS entries.
public enum FacetReminderPlanReader {
    public static func read(
        profileID: String, window: FacetReminderWindow, maximumRows: Int,
        fetch: @Sendable (FacetValue) async throws -> FacetValue
    ) async throws -> FacetReminderPlan {
        guard maximumRows >= 0, maximumRows <= 128 else {
            throw FacetContractError.unsupportedResponse
        }
        let base: [String: FacetValue] = [
            "schemaVersion": .integer(1),
            "kind": .string("reminder_plan"), "at": .string(window.at),
            "timezone": .string(window.timezone),
            "from": .string(window.from), "to": .string(window.to), "limit": .integer(128),
        ]
        var request = base
        var first: FacetReminderPage?
        var rows: [FacetReminderRow] = []
        var count: UInt64 = 0
        var cursor: FacetReminderCursor?
        while true {
            try _Concurrency.Task.checkCancellation()
            let page = try FacetFeatureProjection.decode(
                FacetReminderPage.self, from: await fetch(.object(request)))
            try validate(page, profileID: profileID, previous: first)
            if first == nil { first = page }
            count += UInt64(page.rows.count)
            rows += page.rows.prefix(maximumRows - rows.count)
            guard let next = page.nextCursor else {
                guard count == page.totalCount, let first else {
                    throw FacetContractError.unsupportedResponse
                }
                return FacetReminderPlan(
                    profileID: profileID, version: first.version, totalCount: first.totalCount,
                    rows: rows, problemCount: first.problemCount, problems: first.problems)
            }
            guard let last = page.rows.last, next != cursor,
                next
                    == FacetReminderCursor(
                        fireAt: last.fireAt, reminderId: last.reminderId, taskPath: last.taskPath)
            else { throw FacetContractError.unsupportedResponse }
            cursor = next
            request = base
            request["expectedVersion"] = .unsigned(page.version)
            request["after"] = .object([
                "fireAt": .string(next.fireAt), "reminderId": .string(next.reminderId),
                "taskPath": .string(next.taskPath),
            ])
        }
    }

    private static func validate(
        _ page: FacetReminderPage, profileID: String, previous: FacetReminderPage?
    ) throws {
        guard page.profileId == profileID, page.rows.count <= 128, page.problems.count <= 128,
            Set(page.rows.map(\.notificationId)).count == page.rows.count
        else { throw FacetContractError.unsupportedResponse }
        if let previous {
            guard page.version == previous.version, page.totalCount == previous.totalCount,
                page.problemCount == previous.problemCount
            else { throw FacetContractError.unsupportedResponse }
        }
    }
}
