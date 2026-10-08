import Foundation

public struct FacetTrackingCursor: Codable, Sendable, Equatable {
    public let taskPath: String
    public let at: String

    public static func == (left: Self, right: Self) -> Bool {
        FacetTrackingPath.same(left.taskPath, right.taskPath) && left.at == right.at
    }
}

public struct FacetTrackingSession: Decodable, Sendable, Equatable {
    public let sessionId: String
    public let taskPath: String
    public let title: String
    public let taskRevision: String
    public let startedAt: String
    public let elapsedSeconds: UInt64
    public let state: String
    public let projectLabels: [String]
}

public struct FacetTrackingProblem: Decodable, Sendable {
    public let taskPath: String
    public let code: String

    public static func same(_ left: [Self], _ right: [Self]) -> Bool {
        left.count == right.count
            && zip(left, right).allSatisfy {
                FacetTrackingPath.same($0.taskPath, $1.taskPath)
                    && $0.code.utf8.elementsEqual($1.code.utf8)
            }
    }
}

private struct FacetTrackingPage: Decodable, Sendable {
    let schemaVersion: UInt32
    let profileId: String
    let version: UInt64
    let at: String
    let totalCount: UInt64
    let rows: [FacetTrackingSession]
    let nextCursor: FacetTrackingCursor?
    let problemCount: UInt64
    let problems: [FacetTrackingProblem]
}

public struct FacetTrackingPlan: Sendable {
    public let profileID: String
    public let version: UInt64
    public let at: String
    public let totalCount: UInt64
    public let rows: [FacetTrackingSession]
    public let problemCount: UInt64
    public let problems: [FacetTrackingProblem]
}

/// Metadata-only complete-page read. A failed or superseded read never gives
/// an OS host a partial replacement for its previous owned activities.
public enum FacetTrackingPlanReader {
    public static func read(
        profileID: String, at: String, maximumRows: Int,
        retain: @Sendable (FacetTrackingSession) -> Bool = { _ in true },
        fetch: @Sendable (FacetValue) async throws -> FacetValue
    ) async throws -> FacetTrackingPlan {
        guard (0...128).contains(maximumRows) else {
            throw FacetContractError.unsupportedResponse
        }
        let base: [String: FacetValue] = [
            "schemaVersion": .integer(1), "kind": .string("tracking_sessions"),
            "at": .string(at), "limit": .integer(128),
        ]
        var request = base
        var first: FacetTrackingPage?
        var rows: [FacetTrackingSession] = []
        var count: UInt64 = 0
        var cursor: FacetTrackingCursor?
        var previousPath: String?
        while true {
            try _Concurrency.Task.checkCancellation()
            let value = try await fetch(.object(request))
            try FacetTrackingBoundary.validate(value)
            let page = try FacetFeatureProjection.decode(FacetTrackingPage.self, from: value)
            try validate(page, profileID: profileID, at: at, previous: first)
            if first == nil { first = page }
            for row in page.rows {
                if let previousPath, !FacetTrackingPath.precedes(previousPath, row.taskPath) {
                    throw FacetContractError.unsupportedResponse
                }
                previousPath = row.taskPath
            }
            count += UInt64(page.rows.count)
            rows += page.rows.filter(retain).prefix(maximumRows - rows.count)
            guard let next = page.nextCursor else {
                guard count == page.totalCount, let first else {
                    throw FacetContractError.unsupportedResponse
                }
                return FacetTrackingPlan(
                    profileID: profileID, version: first.version, at: first.at,
                    totalCount: first.totalCount, rows: rows, problemCount: first.problemCount,
                    problems: first.problems)
            }
            guard let last = page.rows.last, next != cursor,
                next == FacetTrackingCursor(taskPath: last.taskPath, at: page.at)
            else { throw FacetContractError.unsupportedResponse }
            cursor = next
            request = base
            request["expectedVersion"] = .unsigned(page.version)
            request["after"] = .object([
                "taskPath": .string(next.taskPath), "at": .string(next.at),
            ])
        }
    }

    private static func validate(
        _ page: FacetTrackingPage, profileID: String, at: String, previous: FacetTrackingPage?
    ) throws {
        guard page.schemaVersion == 1, page.profileId == profileID,
            try FacetInstantFence(page.at) == FacetInstantFence(at),
            page.rows.count <= 128, page.problems.count <= 128,
            UInt64(page.rows.count) <= page.totalCount,
            UInt64(page.problems.count) <= page.problemCount,
            Set(page.rows.map(\.sessionId)).count == page.rows.count,
            page.rows.allSatisfy({ $0.state == "running" })
        else { throw FacetContractError.unsupportedResponse }
        for row in page.rows { try validate(row) }
        for problem in page.problems {
            try validatePath(problem.taskPath)
            guard ["invalid_time_entries", "invalid_projects"].contains(problem.code) else {
                throw FacetContractError.unsupportedResponse
            }
        }
        if let previous {
            guard page.version == previous.version, page.at == previous.at,
                page.totalCount == previous.totalCount, page.problemCount == previous.problemCount,
                FacetTrackingProblem.same(page.problems, previous.problems)
            else { throw FacetContractError.unsupportedResponse }
        }
    }

    private static func validate(_ row: FacetTrackingSession) throws {
        guard row.sessionId.hasPrefix("facet-tracking:"),
            VaultRelativePath.isRevision(String(row.sessionId.dropFirst(15))),
            VaultRelativePath.isRevision(row.taskRevision)
        else { throw FacetContractError.unsupportedResponse }
        try validatePath(row.taskPath)
        _ = try instant(row.startedAt)
    }

    private static func validatePath(_ path: String) throws {
        do { try VaultRelativePath.validate(path) } catch {
            throw FacetContractError.unsupportedResponse
        }
    }

    private static func instant(_ text: String) throws -> Date {
        do { return try Date.ISO8601FormatStyle().parse(text) } catch {
            throw FacetContractError.unsupportedResponse
        }
    }
}
