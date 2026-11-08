public import Foundation

/// The same neutral event palette is validated by every native consumer.
public struct FacetFeedbackPolicy: Decodable, Sendable {
    public struct Cue: Decodable, Sendable {
        public let milliseconds: Double
        public let sha256: String
        public let file: String
    }
    public struct Palette: Decodable, Sendable {
        public let cues: [String: Cue]
    }
    public struct Defaults: Decodable, Sendable {
        public let sounds: Bool
        public let mobileHaptics: Bool
        public let desktopHaptics: Bool
    }
    public struct Effect: Decodable, Sendable {
        public let sound: String?
        public let haptic: String
    }
    public let defaults: Defaults
    public let events: [String: Effect]
    public static let shared: Self = {
        do {
            guard
                let values = Bundle.module.url(
                    forResource: "FacetFeedbackPolicy", withExtension: "json"),
                let schema = Bundle.module.url(
                    forResource: "FacetFeedbackSchema", withExtension: "json")
            else { throw FacetContractError.unsupportedResponse }
            return try decode(data: Data(contentsOf: values), schema: Data(contentsOf: schema))
        } catch { preconditionFailure("Facet feedback resources are invalid: \(error)") }
    }()
    public static func decode(data: Data, schema: Data) throws -> Self {
        try FacetSchema(data: schema).validate(FacetJSON.parse(data), definition: "feedback")
        return try JSONDecoder().decode(Self.self, from: data)
    }
    public static func palette(data: Data) throws -> Palette {
        guard
            let schema = Bundle.module.url(
                forResource: "FacetFeedbackSchema", withExtension: "json")
        else {
            throw FacetContractError.unsupportedResponse
        }
        try FacetSchema(data: Data(contentsOf: schema)).validate(
            FacetJSON.parse(data), definition: "palette")
        return try JSONDecoder().decode(Palette.self, from: data)
    }
}
