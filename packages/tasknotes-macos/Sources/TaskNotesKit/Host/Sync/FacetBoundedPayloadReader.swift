import Foundation
import TaskNotesUniFFI

/// The FacetEngine actor registers this object before its factory returns and
/// retains each active reader until its infallible transient close finishes.
internal actor FacetBoundedPayloadReader: FacetPayloadReading {
    private struct Info: Decodable {
        let schemaVersion: UInt32
        let id: String
        let size: UInt64
        let revision: String
        let written: UInt64
        let state: String
    }

    private let payload: FfiFacetPayload
    private let size: UInt64
    private var closed = false

    init(payload: FfiFacetPayload, expected: FacetVersionMetadata, schema: FacetSchema) throws {
        do {
            let json = try payload.infoJson()
            try schema.validate(json: json, definition: "payloadInfo")
            let bytes = Data(json.utf8)
            let info = try FacetJSON.decoder(bytes).decode(Info.self, from: bytes)
            guard info.schemaVersion == 1, info.state == "sealed",
                info.size == expected.size, info.written == expected.size,
                info.revision == expected.revision
            else { throw FacetContractError.unsupportedResponse }
            self.payload = payload
            size = info.size
        } catch {
            payload.closeHandle()
            throw error
        }
    }

    func read(offset: UInt64, length: UInt32) throws -> Data {
        guard !closed else { throw FacetSyncError.cancelled }
        guard length <= VaultFile.maximumChunk, offset <= size,
            UInt64(length) <= size - offset
        else { throw FacetContractError.unsupportedResponse }
        let bytes = try payload.readChunk(offset: offset, length: length)
        guard bytes.count == Int(length) else { throw FacetContractError.unsupportedResponse }
        return bytes
    }

    func close() {
        guard !closed else { return }
        // Close remains valid after engine/profile retirement. It releases the
        // transient handle, never discards or acknowledges durable bytes.
        payload.closeHandle()
        closed = true
    }

    func isClosed() -> Bool { closed }
}
