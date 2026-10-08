public enum FacetTrackingPath {
    public static func same(_ left: String, _ right: String) -> Bool {
        left.utf8.elementsEqual(right.utf8)
    }

    public static func same(_ left: String?, _ right: String?) -> Bool {
        switch (left, right) {
        case (nil, nil): true
        case (.some(let left), .some(let right)): same(left, right)
        case (nil, .some), (.some, nil): false
        }
    }

    public static func precedes(_ left: String, _ right: String) -> Bool {
        left.utf8.lexicographicallyPrecedes(right.utf8)
    }
}

extension FacetTrackingCursor {
    public var value: FacetValue {
        .object(["taskPath": .string(taskPath), "at": .string(at)])
    }
}

public struct FacetTrackingHistoryCursor: Decodable, Sendable {
    public let entryIndex: UInt64
    public let at: String
    public var value: FacetValue {
        .object(["entryIndex": .unsigned(entryIndex), "at": .string(at)])
    }
}

public struct FacetTrackingSessions: Decodable, Sendable {
    public let profileId: String
    public let version: UInt64
    public let at: String
    public let totalCount: UInt64
    public private(set) var rows: [Row]
    public private(set) var nextCursor: FacetTrackingCursor?
    public let problemCount: UInt64
    public let problems: [FacetTrackingProblem]

    public struct Row: Decodable, Identifiable, Sendable {
        public let sessionId: String
        public let taskPath: String
        public let title: String
        public let taskRevision: String
        public let startedAt: String
        public let elapsedSeconds: UInt64
        public let projectLabels: [String]
        public var id: String { sessionId }
    }

    public func validatePage(maxRows: Int = 128) throws {
        guard rows.count <= maxRows, UInt64(rows.count) <= totalCount,
            UInt64(problems.count) <= problemCount,
            Set(rows.map(\.id)).count == rows.count,
            zip(rows, rows.dropFirst()).allSatisfy({
                FacetTrackingPath.precedes($0.taskPath, $1.taskPath)
            }),
            nextCursor == nil
                || FacetTrackingPath.same(nextCursor?.taskPath, rows.last?.taskPath),
            nextCursor == nil || nextCursor?.at == at
        else { throw FacetContractError.unsupportedResponse }
    }
}

public struct FacetTrackingHistory: Decodable, Sendable {
    public let profileId: String
    public let version: UInt64
    public let at: String
    public let taskPath: String
    public let taskRevision: String
    public let totalCount: UInt64
    public private(set) var rows: [Row]
    public private(set) var nextCursor: FacetTrackingHistoryCursor?
    public let problemCount: UInt64
    public let problems: [FacetTrackingProblem]

    public struct Row: Decodable, Identifiable, Sendable {
        public let entryIndex: UInt64
        public let startedAt: String
        public let endedAt: String?
        public let elapsedSeconds: UInt64
        public let state: String
        public var id: UInt64 { entryIndex }
    }

    public func validatePage(maxRows: Int = 128) throws {
        guard rows.count <= maxRows, UInt64(rows.count) <= totalCount,
            UInt64(problems.count) <= problemCount,
            Set(rows.map(\.id)).count == rows.count,
            zip(rows, rows.dropFirst()).allSatisfy({ $0.entryIndex < $1.entryIndex }),
            nextCursor == nil || nextCursor?.entryIndex == rows.last?.entryIndex,
            nextCursor == nil || nextCursor?.at == at
        else { throw FacetContractError.unsupportedResponse }
    }
}
