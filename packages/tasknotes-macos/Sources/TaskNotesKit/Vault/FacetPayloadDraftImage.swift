import Foundation

/// Opens an immutable native draft by descriptor for bounded staging.
internal struct FacetPayloadDraftImage {
    private struct Metadata: Decodable {
        let deleted: Bool
        let size: UInt64
        let revision: String?
    }

    let size: UInt64
    let revision: String
    private let file: VaultFile

    private init(file: VaultFile, metadata: Metadata) throws {
        guard let declaredRevision = metadata.revision,
            VaultRelativePath.isRevision(declaredRevision),
            !metadata.deleted
        else { throw FacetContractError.unsupportedResponse }
        let actual = try file.fingerprint()
        guard actual.size == metadata.size, actual.revision == declaredRevision else {
            throw FacetContractError.unsupportedResponse
        }
        self.file = file
        size = metadata.size
        self.revision = declaredRevision
    }

    static func open(directory: URL, id: String, maximumSize: UInt64) throws -> Self? {
        guard UUID(uuidString: id) != nil else {
            throw FacetContractError.unsupportedResponse
        }
        let files = try VaultDirectory(url: directory)
        guard let encoded = try files.read(id + ".payload-meta"),
            let fields = try FacetJSON.parse(encoded).object?.fields,
            Set(fields.keys) == ["deleted", "size", "revision"]
        else { throw FacetContractError.unsupportedResponse }
        let metadata = try FacetJSON.decoder(encoded).decode(Metadata.self, from: encoded)
        if metadata.deleted {
            guard metadata.size == 0, metadata.revision == nil,
                try files.openFile(id + ".payload") == nil
            else { throw FacetContractError.unsupportedResponse }
            return nil
        }
        guard metadata.size <= maximumSize,
            let payloadFile = try files.openFile(id + ".payload")
        else { throw FacetContractError.unsupportedResponse }
        return try Self(file: payloadFile, metadata: metadata)
    }

    func read(offset: UInt64, length: UInt32) throws -> Data {
        guard length <= VaultFile.maximumChunk, offset <= size,
            UInt64(length) <= size - offset
        else { throw FacetContractError.unsupportedResponse }
        return try file.read(offset: offset, length: Int(length))
    }
}
