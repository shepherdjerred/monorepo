public import Foundation

/// A local Apple preference; strict parsing also rejects duplicate JSON keys.
public struct FacetFeedbackPreference: Codable, Sendable {
    public let schemaVersion: UInt32
    public let sounds: Bool
    public let haptics: Bool
    public init(sounds: Bool = true, haptics: Bool = true) {
        schemaVersion = 2
        self.sounds = sounds
        self.haptics = haptics
    }
    public static func decode(_ data: Data) throws -> Self {
        guard let fields = try FacetJSON.parse(data).object?.fields else {
            throw FacetContractError.unsupportedResponse
        }
        if Set(fields.keys) == ["enabled"], case .bool(let enabled) = fields["enabled"] {
            return Self(sounds: enabled, haptics: enabled)
        }
        guard Set(fields.keys) == ["schemaVersion", "sounds", "haptics"],
            fields["schemaVersion"] == .integer(2),
            case .bool(let sounds) = fields["sounds"], case .bool(let haptics) = fields["haptics"]
        else { throw FacetContractError.unsupportedResponse }
        return Self(sounds: sounds, haptics: haptics)
    }
}
