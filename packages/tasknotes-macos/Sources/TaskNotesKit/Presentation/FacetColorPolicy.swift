public import Foundation

/// Both the configured color parser and its vocabulary consume the neutral contract.
public struct FacetColorPolicy: Decodable, Sendable {
    public let schemaVersion: UInt32
    public let hexFormats: [String]
    public let hexOrder: String
    public let normalization: String
    public let namedColors: [String: String]
    public let unsupportedValue: String
    public static let shared: Self = {
        do {
            guard
                let values = Bundle.module.url(
                    forResource: "FacetColorPolicy", withExtension: "json"),
                let schema = Bundle.module.url(
                    forResource: "FacetPresentationSchema", withExtension: "json")
            else { throw FacetContractError.unsupportedResponse }
            return try decode(data: Data(contentsOf: values), schema: Data(contentsOf: schema))
        } catch { preconditionFailure("Facet color policy resources are invalid: \(error)") }
    }()
    public static func decode(data: Data, schema: Data) throws -> Self {
        try FacetSchema(data: schema).validate(FacetJSON.parse(data), definition: "colorPolicy")
        return try JSONDecoder().decode(Self.self, from: data)
    }
}
