import TaskNotesUniFFI

/// Display projections of schema-validated core decisions. Native clients never
/// infer series eligibility, occurrence dates, or repair commands themselves.
public struct FacetOccurrenceTarget: Decodable, Sendable {
    public let parentPath: String
    public let expectedParentRevision: String
    public let referenceDate: String
    public let start: String
    public let end: String

    public func command(automatic: Bool = false) -> FacetValue {
        .object([
            "kind": .string("materialize_occurrence_window"),
            "parentPath": .string(parentPath),
            "expectedParentRevision": .string(expectedParentRevision),
            "referenceDate": .string(referenceDate),
            "origin": .string(automatic ? "automatic_maintenance" : "user"),
        ])
    }
}

public struct FacetOccurrenceProblem: Decodable, Sendable {
    public let taskPath: String
    public let code: String
}

public struct FacetRollingMaintenancePlan: Decodable, Sendable {
    public let profileId: String
    public let version: UInt64
    public let referenceDate: String
    public let inspectedCount: Int
    public let targets: [FacetOccurrenceTarget]
    public let problems: [FacetOccurrenceProblem]
    public let nextCursor: FacetValue?
}

public struct FacetOccurrenceGenerationItem: Decodable, Sendable {
    public struct Resolution: Decodable, Sendable {
        public let kind: String
        public let futureDate: String?
        public let successorId: String?
    }
    public struct Failure: Decodable, Sendable {
        public let code: String
        public let message: String
    }
    public let kind: String
    public let successorId: String
    public let parentPath: String
    public let childPath: String?
    public let occurrenceDate: String?
    public let state: String
    public let failure: Failure?
    public let resolution: Resolution?
    public var needsAttention: Bool {
        failure != nil && resolution == nil && state != "applied" && state != "cancelled"
    }
}

public struct FacetOccurrenceSuccessors: Decodable, Sendable {
    public let mutationId: String
    public let items: [FacetOccurrenceGenerationItem]
}

public struct FacetGenerationFailure: Decodable, Sendable, Identifiable {
    public enum SourceTasks: Sendable, Equatable {
        case legacy
        case current([String])
    }
    public struct Action: Decodable, Sendable {
        public let kind: String
        public let command: FacetValue?
        public let reason: String?
    }
    public let primaryMutationId: String
    public let item: FacetOccurrenceGenerationItem
    public let action: Action
    public let sourceTaskPaths: SourceTasks
    public var id: String { item.successorId }

    private enum CodingKeys: String, CodingKey {
        case primaryMutationId, item, action, sourceTaskPaths
    }

    public init(from decoder: any Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        primaryMutationId = try fields.decode(String.self, forKey: .primaryMutationId)
        item = try fields.decode(FacetOccurrenceGenerationItem.self, forKey: .item)
        action = try fields.decode(Action.self, forKey: .action)
        sourceTaskPaths =
            fields.contains(.sourceTaskPaths)
            ? .current(try fields.decode([String].self, forKey: .sourceTaskPaths)) : .legacy
    }

    /// Core's current canonical source identities supersede historical child paths.
    public func applies(toTaskPath path: String) -> Bool {
        if item.parentPath == path { return true }
        switch sourceTaskPaths {
        case .current(let paths): return paths.contains(path)
        case .legacy: return item.childPath == path
        }
    }
}

public struct FacetGenerationFailuresPlan: Decodable, Sendable {
    public let profileId: String
    public let version: UInt64
    public let inspectedCount: Int
    public let items: [FacetGenerationFailure]
    public let nextCursor: FacetValue?
}

public struct FacetOccurrenceOverview: Sendable {
    public let targets: [FacetOccurrenceTarget]
    public let problems: [FacetOccurrenceProblem]
    public let failures: [FacetGenerationFailure]
}

extension FacetEngine {
    /// Complete read traversal precedes any write: mutations invalidate cursors.
    /// Pages are bounded by the core; cancellation never publishes a partial plan.
    public func occurrenceOverview(profileID: String, referenceDate: String) throws
        -> FacetOccurrenceOverview
    {
        var restarts = 0
        while true {
            do {
                return try readOccurrenceOverview(
                    profileID: profileID, referenceDate: referenceDate)
            } catch FacetEngineError.Conflict {
                // A concurrent owned Sync effect may invalidate a read cursor.
                // Restart complete discovery, never publish a partial traversal.
                restarts += 1
                guard restarts < 3 else { throw FacetEngineError.Conflict }
            }
        }
    }

    private func readOccurrenceOverview(profileID: String, referenceDate: String) throws
        -> FacetOccurrenceOverview
    {
        var targets: [FacetOccurrenceTarget] = []
        var problems: [FacetOccurrenceProblem] = []
        var request: [String: FacetValue] = [
            "kind": .string("rolling_maintenance_plan"), "limit": .integer(256),
            "referenceDate": .string(referenceDate),
        ]
        while true {
            try _Concurrency.Task.checkCancellation()
            let page = try FacetFeatureProjection.decode(
                FacetRollingMaintenancePlan.self,
                from: features(profileID: profileID, request: .object(request)))
            guard page.profileId == profileID, page.referenceDate == referenceDate else {
                throw FacetContractError.unsupportedResponse
            }
            targets.append(contentsOf: page.targets)
            problems.append(contentsOf: page.problems)
            guard let cursor = page.nextCursor else { break }
            request["after"] = cursor
            request["expectedVersion"] = .unsigned(page.version)
        }
        var failures: [FacetGenerationFailure] = []
        request = ["kind": .string("occurrence_generation_failures"), "limit": .integer(256)]
        while true {
            try _Concurrency.Task.checkCancellation()
            let page = try FacetFeatureProjection.decode(
                FacetGenerationFailuresPlan.self,
                from: features(profileID: profileID, request: .object(request)))
            guard page.profileId == profileID else { throw FacetContractError.unsupportedResponse }
            failures.append(contentsOf: page.items)
            guard let cursor = page.nextCursor else { break }
            request["after"] = cursor
            request["expectedVersion"] = .unsigned(page.version)
        }
        return FacetOccurrenceOverview(targets: targets, problems: problems, failures: failures)
    }

    /// Resume exact durable envelopes before admitting a new automatic window.
    public func resumeOccurrenceMaintenance(
        profileID: String, admission: FacetOccurrenceAdmission
    ) throws {
        try FacetOccurrenceRecovery.resume(
            admission: admission,
            pending: { try pendingMutations(profileID: profileID, afterID: $0) },
            retry: { _ = try retryMutation(id: $0, occurrenceAdmission: admission) },
            retire: { try retireSavedMutation(id: $0.id, expectedProfileID: profileID) },
            observe: { try discardObservedMutation(id: $0) })
    }
}
