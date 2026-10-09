import Foundation

/// An authoritative receipt read through the complete shared schema.
public struct FacetMutationReceipt: Decodable, Sendable {
    public let mutationId: String
    public let applied: Bool
    public let taskPath: String?
    public let cleanupPending: Bool
    public let paths: [String]
    public let diagnostics: [Diagnostic]

    public enum Diagnostic: String, Sendable {
        case templateMissing = "template_missing"
        case templateParseFailed = "template_parse_failed"
        case filenameShortened = "filename_shortened"

        public var message: String {
            switch self {
            case .templateMissing: "The task was saved without the configured template."
            case .templateParseFailed: "The configured template could not be used."
            case .filenameShortened: "Facet shortened the filename and kept the full title."
            }
        }
    }

    /// Validates raw keys, the full receipt schema, and the submitted mutation identity.
    public static func read(
        json: String, expectedMutationID: String, schema: FacetSchema
    ) throws -> Self {
        let data = Data(json.utf8)
        let value = try FacetJSON.parse(data)
        try schema.validate(value, definition: "receipt")
        let receipt = try FacetJSON.decoder(data).decode(Self.self, from: data)
        guard receipt.mutationId == expectedMutationID else {
            throw FacetContractError.unsupportedResponse
        }
        return receipt
    }

    public var savedMessage: String? {
        guard applied, !diagnostics.isEmpty else { return nil }
        return diagnostics.map(\.message).joined(separator: "\n")
    }
}

extension FacetMutationReceipt.Diagnostic: Decodable {
    private enum CodingKeys: String, CodingKey { case code }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let code = try container.decode(String.self, forKey: .code)
        guard let diagnostic = Self(rawValue: code) else {
            throw FacetContractError.unsupportedResponse
        }
        self = diagnostic
    }
}
