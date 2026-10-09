public import Foundation

/// A local Apple preference; strict parsing also rejects duplicate JSON keys.
public struct FacetFeedbackPreference: Codable, Sendable {
    public let enabled: Bool
    public init(enabled: Bool) { self.enabled = enabled }
    public static func decode(_ data: Data) throws -> Self {
        guard let fields = try FacetJSON.parse(data).object?.fields,
            Set(fields.keys) == ["enabled"], case .bool(let enabled) = fields["enabled"]
        else { throw FacetContractError.unsupportedResponse }
        return Self(enabled: enabled)
    }
}
