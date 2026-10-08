import Foundation
import TaskNotesKit

@MainActor
internal struct FacetTrackingContinuation {
    let profileID: String
    let path: String?
    let at: String
    let version: UInt64
    let cursor: FacetValue
    let seenCount: UInt64
    let totalCount: UInt64
    let problemCount: UInt64
    let problems: [FacetTrackingProblem]
    let taskRevision: String?
    let ownsPresentation: () -> Bool
}

private struct FacetHistorySelection {
    let profileID: String
    let path: String
    let at: String
}

private struct FacetTrackingPageCounts {
    let version: UInt64
    let total: UInt64
    let problems: UInt64
    let rows: Int
    let problemList: [FacetTrackingProblem]
}

extension FacetStore {
    public func loadTracking(profileID: String, path: String? = nil) async {
        guard let engine else { return }
        await readTracking(
            profileID: profileID, path: path, at: Date.now.ISO8601Format(),
            ownsEngine: { self.engine === engine },
            read: { try await engine.features(profileID: $0, request: .object($1)) })
    }

    public func loadMoreTracking() async {
        guard let engine, let continuation = trackingContinuation else { return }
        await readTracking(
            profileID: continuation.profileID, path: continuation.path, at: continuation.at,
            continuing: true, ownsEngine: { self.engine === engine },
            read: { try await engine.features(profileID: $0, request: .object($1)) })
    }

    internal func readTracking(
        profileID: String, path: String?, at: String, continuing: Bool = false,
        ownsEngine: @escaping () -> Bool,
        read: (String, [String: FacetValue]) async throws -> FacetValue
    ) async {
        let ownsPresentation: () -> Bool
        var request: [String: FacetValue] = [
            "kind": .string(path == nil ? "tracking_sessions" : "tracking_history"),
            "at": .string(at), "limit": .integer(64),
        ]
        if let path { request["path"] = .string(path) }
        if continuing {
            guard let previous = trackingContinuation, previous.ownsPresentation(),
                previous.profileID == profileID, FacetTrackingPath.same(previous.path, path),
                previous.at == at,
                ownsEngine()
            else {
                trackingContinuation = nil
                trackingSessions = nil
                trackingHistory = nil
                return
            }
            ownsPresentation = previous.ownsPresentation
            request["expectedVersion"] = .unsigned(previous.version)
            request["after"] = previous.cursor
        } else {
            ownsPresentation = presentationOwner(profileID: profileID, ownsEngine: ownsEngine)
            guard ownsPresentation() else { return }
            trackingContinuation = nil
            trackingSessions = nil
            trackingHistory = nil
        }
        trackingGeneration += 1
        let generation = trackingGeneration
        let previous = continuing ? trackingContinuation : nil
        do {
            let value = try await read(profileID, request)
            guard generation == trackingGeneration, ownsPresentation() else { return }
            if let path {
                try installHistory(
                    value,
                    selection: FacetHistorySelection(profileID: profileID, path: path, at: at),
                    previous: previous,
                    ownsPresentation: ownsPresentation)
            } else {
                try installSessions(
                    value, selection: (profileID, at), previous: previous,
                    ownsPresentation: ownsPresentation)
            }
        } catch {
            if generation == trackingGeneration, ownsPresentation() {
                trackingContinuation = nil
                self.error = error.localizedDescription
            }
        }
    }

    private func installHistory(
        _ value: FacetValue, selection: FacetHistorySelection,
        previous: FacetTrackingContinuation?, ownsPresentation: @escaping () -> Bool
    ) throws {
        try FacetSchema.bundled().validate(value, definition: "trackingHistory")
        let page = try FacetFeatureProjection.decode(FacetTrackingHistory.self, from: value)
        try page.validatePage(maxRows: 64)
        guard page.profileId == selection.profileID, page.at == selection.at,
            FacetTrackingPath.same(page.taskPath, selection.path)
        else { throw FacetContractError.unsupportedResponse }
        if let previous {
            guard previous.taskRevision == page.taskRevision,
                case .unsigned(let index) = previous.cursor.object?.fields["entryIndex"],
                let first = page.rows.first, first.entryIndex > index
            else { throw FacetContractError.unsupportedResponse }
        }
        for (offset, row) in page.rows.enumerated() {
            let (expected, overflow) = (previous?.seenCount ?? 0).addingReportingOverflow(
                UInt64(offset))
            guard !overflow, row.entryIndex == expected else {
                throw FacetContractError.unsupportedResponse
            }
        }
        let seenCount = try trackingSeenCount(
            page: FacetTrackingPageCounts(
                version: page.version, total: page.totalCount,
                problems: page.problemCount, rows: page.rows.count, problemList: page.problems),
            hasNext: page.nextCursor != nil, previous: previous)
        trackingHistory = page
        trackingContinuation = page.nextCursor.map {
            FacetTrackingContinuation(
                profileID: selection.profileID, path: selection.path, at: selection.at,
                version: page.version, cursor: $0.value, seenCount: seenCount,
                totalCount: page.totalCount, problemCount: page.problemCount,
                problems: page.problems,
                taskRevision: page.taskRevision, ownsPresentation: ownsPresentation)
        }
    }

    private func installSessions(
        _ value: FacetValue, selection: (profileID: String, at: String),
        previous: FacetTrackingContinuation?, ownsPresentation: @escaping () -> Bool
    ) throws {
        try FacetSchema.bundled().validate(value, definition: "trackingSessions")
        let page = try FacetFeatureProjection.decode(FacetTrackingSessions.self, from: value)
        try page.validatePage(maxRows: 64)
        guard page.profileId == selection.profileID, page.at == selection.at else {
            throw FacetContractError.unsupportedResponse
        }
        if let previous {
            guard let path = previous.cursor.object?.fields["taskPath"]?.text,
                let first = page.rows.first, FacetTrackingPath.precedes(path, first.taskPath)
            else { throw FacetContractError.unsupportedResponse }
        }
        let seenCount = try trackingSeenCount(
            page: FacetTrackingPageCounts(
                version: page.version, total: page.totalCount,
                problems: page.problemCount, rows: page.rows.count, problemList: page.problems),
            hasNext: page.nextCursor != nil, previous: previous)
        trackingSessions = page
        trackingContinuation = page.nextCursor.map {
            FacetTrackingContinuation(
                profileID: selection.profileID, path: nil, at: selection.at,
                version: page.version, cursor: $0.value, seenCount: seenCount,
                totalCount: page.totalCount, problemCount: page.problemCount,
                problems: page.problems,
                taskRevision: nil, ownsPresentation: ownsPresentation)
        }
    }

    private func trackingSeenCount(
        page: FacetTrackingPageCounts,
        hasNext: Bool, previous: FacetTrackingContinuation?
    ) throws -> UInt64 {
        if let previous {
            guard previous.version == page.version, previous.totalCount == page.total,
                previous.problemCount == page.problems, page.rows > 0,
                FacetTrackingProblem.same(previous.problems, page.problemList)
            else { throw FacetContractError.unsupportedResponse }
        }
        let (seen, overflow) = (previous?.seenCount ?? 0).addingReportingOverflow(UInt64(page.rows))
        guard !overflow, seen <= page.total,
            hasNext ? (page.rows > 0 && seen < page.total) : seen == page.total
        else { throw FacetContractError.unsupportedResponse }
        return seen
    }
}
