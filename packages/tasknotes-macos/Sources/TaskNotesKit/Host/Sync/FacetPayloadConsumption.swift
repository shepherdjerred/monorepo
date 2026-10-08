import CryptoKit
import Darwin
public import Foundation

/// An independent immutable retained version. The generated bounded bridge
/// adapter will implement this host seam after its coherent ABI cutover.
internal protocol FacetPayloadReading: Sendable {
    func read(offset: UInt64, length: UInt32) async throws -> Data
    func close() async throws
}

internal struct FacetPayloadConsumption<Value: Sendable>: Sendable {
    let value: Value
    let cleanupDiagnostic: FacetFailureDiagnostic?
}

/// Text preview/editing is explicitly capped; binary export preserves every
/// legal attachment byte using independent private files and bounded reads.
internal enum FacetPayloadConsumer {
    static let textLimit: UInt64 = 1_048_576

    static func text(
        reader: any FacetPayloadReading, metadata: FacetVersionMetadata
    ) async throws -> FacetPayloadConsumption<String> {
        try await consume(reader: reader) {
            guard metadata.size <= textLimit else { throw FacetPayloadConsumerError.textTooLarge }
            var bytes = Data()
            try await stream(reader: reader, metadata: metadata) { bytes.append($0) }
            guard let text = String(data: bytes, encoding: .utf8) else {
                throw FacetPayloadConsumerError.binaryContent
            }
            return text
        }
    }

    static func export(
        reader: any FacetPayloadReading, metadata: FacetVersionMetadata, directory: URL
    ) async throws -> FacetPayloadConsumption<URL> {
        try await consume(reader: reader) {
            let root = try VaultDirectory(url: directory)
            let id = UUID().uuidString.lowercased()
            let temporary = id + ".partial"
            guard let file = try root.openFile(temporary, writable: true, createNew: true) else {
                throw FacetContractError.unsupportedResponse
            }
            do {
                var offset: UInt64 = 0
                try await stream(reader: reader, metadata: metadata) {
                    try file.write(offset: offset, bytes: $0)
                    offset += UInt64($0.count)
                }
                try file.synchronize()
                let name = id + ".bin"
                try root.rename(temporary, to: root, name: name, flags: UInt32(RENAME_EXCL))
                try root.synchronize()
                return directory.appendingPathComponent(name)
            } catch {
                let primary = error
                do {
                    try root.remove(temporary)
                    try root.synchronize()
                } catch {
                    throw FacetPayloadConsumptionFailure(primary: primary, cleanup: error)
                }
                throw primary
            }
        }
    }

    private static func stream(
        reader: any FacetPayloadReading, metadata: FacetVersionMetadata,
        receive: (Data) throws -> Void
    ) async throws {
        guard VaultRelativePath.isRevision(metadata.revision) else {
            throw FacetContractError.unsupportedResponse
        }
        var offset: UInt64 = 0
        var digest = SHA256()
        while offset < metadata.size {
            try _Concurrency.Task.checkCancellation()
            let length = UInt32(min(UInt64(VaultFile.maximumChunk), metadata.size - offset))
            let bytes = try await reader.read(offset: offset, length: length)
            guard bytes.count == Int(length) else { throw FacetContractError.unsupportedResponse }
            digest.update(data: bytes)
            try receive(bytes)
            offset += UInt64(length)
        }
        try _Concurrency.Task.checkCancellation()
        let revision = digest.finalize().map {
            let hex = String($0, radix: 16)
            return hex.count == 1 ? "0" + hex : hex
        }.joined()
        guard revision == metadata.revision else { throw FacetContractError.unsupportedResponse }
    }

    private static func consume<Value: Sendable>(
        reader: any FacetPayloadReading, operation: () async throws -> Value
    ) async throws -> FacetPayloadConsumption<Value> {
        let outcome: Result<Value, any Error>
        do { outcome = .success(try await operation()) } catch { outcome = .failure(error) }
        // Detached cleanup deliberately does not inherit operation cancellation.
        let cleanup = await _Concurrency.Task.detached {
            do {
                try await reader.close()
                return Result<Void, any Error>.success(())
            } catch { return Result<Void, any Error>.failure(error) }
        }.value
        switch (outcome, cleanup) {
        case (.success(let value), .success):
            return FacetPayloadConsumption(value: value, cleanupDiagnostic: nil)
        case (.success(let value), .failure(let error)):
            return FacetPayloadConsumption(
                value: value, cleanupDiagnostic: FacetFailureDiagnostic(error))
        case (.failure(let error), .success): throw error
        case (.failure(let error), .failure(let cleanup)):
            throw FacetPayloadConsumptionFailure(primary: error, cleanup: cleanup)
        }
    }
}

internal struct FacetPayloadConsumptionFailure: Error, CustomNSError {
    let primary: any Error
    let cleanup: any Error
    static var errorDomain: String { "Facet.PayloadConsumption" }
    var errorCode: Int { 1 }
    var errorUserInfo: [String: Any] {
        [NSUnderlyingErrorKey: primary, NSMultipleUnderlyingErrorsKey: [cleanup]]
    }
}

internal enum FacetPayloadConsumerError: Error, LocalizedError {
    case textTooLarge, binaryContent
    var errorDescription: String? {
        switch self {
        case .textTooLarge:
            "This retained version exceeds the 1 MiB text editor limit. "
                + "Keep either exact version or export its complete contents."
        case .binaryContent:
            "This retained version contains binary data. "
                + "Keep either exact version or export its complete contents."
        }
    }
}
