import Foundation

/// Typed display projections. Feature validation and domain decisions run
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

public struct FacetUndoAvailable: Decodable, Sendable {
    public let canUndo: Bool
    public let receiptId: String?
    public let at: String?
    public let commandKind: String?
}
