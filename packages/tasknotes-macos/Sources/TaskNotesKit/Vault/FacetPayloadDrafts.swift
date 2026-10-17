import CryptoKit
import Foundation

/// Immutable private binary draft files keep attachment bytes out of JSON.
internal struct FacetPayloadDrafts {
    private struct Metadata: Codable, Equatable {
        let deleted: Bool
        let size: UInt64
        let revision: String?
    }
    let directory: URL

    func prepare(id: String, bytes: Data?) throws {
        try validate(id)
        let files = try VaultDirectory(url: directory)
        let metadata = Metadata(
            deleted: bytes == nil, size: UInt64(bytes?.count ?? 0),
            revision: bytes.map(Self.revision))
        if let existing = try files.read(id + ".payload-meta") {
            guard try decode(existing) == metadata else { throw FacetDraftError.changedOperation }
            return
        }
        if let bytes {
            if let existing = try files.fingerprint(id + ".payload") {
                guard existing.size == metadata.size, existing.revision == metadata.revision else {
                    throw FacetDraftError.changedOperation
                }
            } else {
                try files.writeNewAtomic(id + ".payload", bytes: bytes)
            }
        }
        let encoded = try FacetJSON.encode(
            .object([
                "deleted": .bool(metadata.deleted), "size": .unsigned(metadata.size),
                "revision": metadata.revision.map { .string($0) } ?? .null,
            ]))
        try files.writeNewAtomic(id + ".payload-meta", bytes: Data(encoded.utf8))
    }

    func read(id: String, maximumSize: UInt64) throws -> Data? {
        try validate(id)
        let files = try VaultDirectory(url: directory)
        guard let encoded = try files.read(id + ".payload-meta") else {
            throw FacetContractError.unsupportedResponse
        }
        let metadata = try decode(encoded)
        if metadata.deleted {
            guard metadata.size == 0, metadata.revision == nil else {
                throw FacetContractError.unsupportedResponse
            }
            return nil
        }
        guard metadata.size <= maximumSize, let bytes = try files.read(id + ".payload"),
            UInt64(bytes.count) == metadata.size, Self.revision(bytes) == metadata.revision
        else {
            throw FacetContractError.unsupportedResponse
        }
        return bytes
    }

    private func decode(_ bytes: Data) throws -> Metadata {
        guard let fields = try FacetJSON.parse(bytes).object?.fields,
            Set(fields.keys) == ["deleted", "size", "revision"]
        else {
            throw FacetContractError.unsupportedResponse
        }
        return try FacetJSON.decoder(bytes).decode(Metadata.self, from: bytes)
    }

    private func validate(_ id: String) throws {
        guard UUID(uuidString: id) != nil else { throw FacetContractError.unsupportedResponse }
    }

    private static func revision(_ bytes: Data) -> String {
        SHA256.hash(data: bytes).map { byte in
            let hex = String(byte, radix: 16)
            return hex.count == 1 ? "0" + hex : hex
        }.joined()
    }
}
