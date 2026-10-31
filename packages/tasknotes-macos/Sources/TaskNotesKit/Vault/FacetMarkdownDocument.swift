public import Foundation
internal import TaskNotesUniFFI

/// Immutable document properties parsed by the Rust vault boundary.
public struct FacetMarkdownDocument: Sendable {
    public let properties: [String: FacetValue]
    public let body: String

    /// Rejects unsafe logical paths, invalid UTF-8 and malformed frontmatter.
    public init(path: String, bytes: Data) throws {
        let document = try FfiVaultDocument(path: path, bytes: bytes)
        guard let parsed = try FacetJSON.parse(Data(document.propertiesJson().utf8)).object
        else { throw FacetContractError.unsupportedResponse }
        self.properties = parsed.fields
        self.body = document.body()
    }
}
