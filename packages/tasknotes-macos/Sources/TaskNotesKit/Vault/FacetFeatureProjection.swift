import Foundation

/// Typed display projections. Feature validation and all timing decisions run
/// in the engine before these values reach presentation.
public enum FacetFeatureProjection {
    public static func parseJSON(_ text: String) throws -> FacetValue {
        try FacetJSON.parse(Data(text.utf8))
    }

    public static func json(_ value: FacetValue) throws -> String { try FacetJSON.encode(value) }

    public static func decode<Value: Decodable>(_ type: Value.Type, from value: FacetValue) throws
        -> Value
    {
        let data = Data(try FacetJSON.encode(value).utf8)
        return try FacetJSON.decoder(data).decode(type, from: data)
    }
}

public struct FacetTaskTime: Decodable, Sendable {
    public let path: String
    public let totalMinutes: UInt64
    public let totalSeconds: UInt64
    public let hasActiveSession: Bool
    public let entries: [FacetValue]
}

public struct FacetTimeReport: Decodable, Sendable {
    public let totalMinutes: UInt64
    public let totalSeconds: UInt64
    public let rows: [Row]

    public struct Row: Decodable, Identifiable, Sendable {
        public let path: String
        public let title: String
        public let seconds: UInt64
        public let minutes: UInt64
        public var id: String { path }
    }
}

public struct FacetPomodoro: Decodable, Sendable {
    public let status: String
    public let taskPath: String?
    public let durationSeconds: UInt64
    public let elapsedSeconds: UInt64
    public let startedAt: String?
    public let updatedAt: String?
}

public struct FacetUndoAvailable: Decodable, Sendable {
    public let canUndo: Bool
    public let receiptId: String?
    public let at: String?
    public let commandKind: String?
}
