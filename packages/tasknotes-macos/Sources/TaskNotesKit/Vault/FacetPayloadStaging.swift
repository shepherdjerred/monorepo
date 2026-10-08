import Foundation
import TaskNotesUniFFI

/// The FacetEngine actor owns this scope. Every factory handle is registered
/// before its first metadata/write call and closed on every completed attempt.
internal enum FacetPayloadStaging {
    private struct Info: Decodable {
        let schemaVersion: UInt32
        let id: String
        let size: UInt64
        let revision: String
        let written: UInt64
        let state: String
    }

    static func resume(
        payload: FfiFacetPayload, id: String, image: FacetPayloadDraftImage,
        schema: FacetSchema
    ) throws {
        var info = try metadata(payload.infoJson(), schema: schema)
        try validate(info, id: id, image: image)
        while info.written < image.size {
            try _Concurrency.Task.checkCancellation()
            let offset = info.written
            let length = UInt32(min(UInt64(VaultFile.maximumChunk), image.size - offset))
            let next = try metadata(
                payload.writeChunk(
                    offset: offset, bytes: image.read(offset: offset, length: length)),
                schema: schema)
            try validate(next, id: id, image: image)
            guard next.written == offset + UInt64(length) else {
                throw FacetContractError.unsupportedResponse
            }
            info = next
        }
        try _Concurrency.Task.checkCancellation()
        let sealed = try metadata(payload.seal(), schema: schema)
        try validate(sealed, id: id, image: image)
        guard sealed.state == "sealed", sealed.written == image.size else {
            throw FacetContractError.unsupportedResponse
        }
    }

    private static func metadata(_ json: String, schema: FacetSchema) throws -> Info {
        try schema.validate(json: json, definition: "payloadInfo")
        let bytes = Data(json.utf8)
        return try FacetJSON.decoder(bytes).decode(Info.self, from: bytes)
    }

    private static func validate(_ info: Info, id: String, image: FacetPayloadDraftImage) throws {
        guard info.schemaVersion == 1, info.id == id, info.size == image.size,
            info.revision == image.revision, info.written <= info.size,
            ["preparing", "sealed"].contains(info.state),
            info.state != "sealed" || info.written == image.size
        else { throw FacetContractError.unsupportedResponse }
    }
}
