import CryptoKit
import Foundation
import Testing

@testable import TaskNotesKit

struct FacetPayloadConsumptionTests {
    @Test func binaryExportStreamsExactBytesAndTextCapClosesWithoutReading() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let block = Data(repeating: 42, count: VaultFile.maximumChunk)
        let reader = PayloadChunkFixture(block: block, count: 7)
        let metadata = metadata(block: block, count: 7)
        let exported = try await FacetPayloadConsumer.export(
            reader: reader, metadata: metadata, directory: root)
        let fingerprint = try #require(
            try VaultDirectory(url: root).fingerprint(exported.value.lastPathComponent))
        #expect(fingerprint.size == metadata.size && fingerprint.revision == metadata.revision)
        #expect(exported.cleanupDiagnostic == nil)
        #expect(await reader.closed)
        #expect(await reader.readCount == 7)
        let capped = PayloadChunkFixture(block: block, count: 7)
        await #expect(throws: FacetPayloadConsumerError.self) {
            try await FacetPayloadConsumer.text(reader: capped, metadata: metadata)
        }
        #expect(await capped.closed)
        #expect(await capped.readCount == 0)
    }

    @Test func hashAndCancellationFailuresCloseReaderAndRetainFirstDiagnostic() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let reader = PayloadChunkFixture(block: Data([9]), count: 1, failClose: true)
        let wrong = FacetVersionMetadata(size: 1, revision: String(repeating: "a", count: 64))
        do {
            _ = try await FacetPayloadConsumer.export(
                reader: reader, metadata: wrong, directory: root)
            Issue.record("Changed immutable payload must fail.")
        } catch {
            let diagnostic = FacetFailureDiagnostic(error)
            #expect(diagnostic.classification == "internal_contract")
            #expect(diagnostic.chain.contains("storage"))
        }
        #expect(await reader.closed)
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
        let cancelled = PayloadChunkFixture(
            block: Data([9]), count: 1, failClose: true, cancelRead: true)
        do {
            _ = try await FacetPayloadConsumer.text(
                reader: cancelled, metadata: metadata(block: Data([9]), count: 1))
            Issue.record("Cancelled payload must fail.")
        } catch {
            #expect(FacetFailureDiagnostic(error).classification == "cancelled")
        }
        #expect(await cancelled.closed)
    }

    @Test func successfulReadPreservesResultAndReportsCleanupSeparately() async throws {
        let bytes = Data("retained text".utf8)
        let reader = PayloadChunkFixture(block: bytes, count: 1, failClose: true)
        let result = try await FacetPayloadConsumer.text(
            reader: reader, metadata: metadata(block: bytes, count: 1))
        #expect(result.value == "retained text")
        #expect(result.cleanupDiagnostic?.classification == "storage")
        #expect(await reader.closed)
        let binary = PayloadChunkFixture(block: Data([255]), count: 1)
        await #expect(throws: FacetPayloadConsumerError.self) {
            try await FacetPayloadConsumer.text(
                reader: binary, metadata: metadata(block: Data([255]), count: 1))
        }
        #expect(await binary.closed)
    }

    @Test func cancelledExportRemovesOnlyPrivatePartialAndCleanupIgnoresCancellation() async throws
    {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let preserved = root.appendingPathComponent("existing-user-export.bin")
        try Data([3]).write(to: preserved)
        let reader = PausedPayloadFixture()
        let metadata = metadata(block: Data([9]), count: 1)
        let export = _Concurrency.Task {
            try await FacetPayloadConsumer.export(
                reader: reader, metadata: metadata, directory: root)
        }
        await reader.waitForRead()
        export.cancel()
        await reader.resumeRead()
        await #expect(throws: CancellationError.self) { try await export.value }
        #expect(await reader.closed)
        #expect(await !reader.cleanupWasCancelled)
        #expect(try Data(contentsOf: preserved) == Data([3]))
        #expect(
            try FileManager.default.contentsOfDirectory(atPath: root.path) == [
                preserved.lastPathComponent
            ])
    }

    @Test func symbolicExportDirectoryFailsClosedWithoutChangingItsTarget() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let target = root.appendingPathComponent("target")
        let alias = root.appendingPathComponent("alias")
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: target)
        let reader = PayloadChunkFixture(block: Data([9]), count: 1)
        await #expect(throws: POSIXError.self) {
            try await FacetPayloadConsumer.export(
                reader: reader, metadata: metadata(block: Data([9]), count: 1), directory: alias)
        }
        #expect(await reader.closed)
        #expect(await reader.readCount == 0)
        #expect(try FileManager.default.contentsOfDirectory(atPath: target.path).isEmpty)
    }

    private func metadata(block: Data, count: Int) -> FacetVersionMetadata {
        var hash = SHA256()
        for _ in 0..<count { hash.update(data: block) }
        let revision = hash.finalize().map {
            let hex = String($0, radix: 16)
            return hex.count == 1 ? "0" + hex : hex
        }.joined()
        return FacetVersionMetadata(size: UInt64(block.count * count), revision: revision)
    }
}

private actor PausedPayloadFixture: FacetPayloadReading {
    private var waiting: CheckedContinuation<Void, Never>?
    private var paused: CheckedContinuation<Void, Never>?
    private var started = false
    private(set) var closed = false
    private(set) var cleanupWasCancelled = false

    func read(offset: UInt64, length: UInt32) async -> Data {
        await withCheckedContinuation { continuation in
            paused = continuation
            started = true
            waiting?.resume()
            waiting = nil
        }
        return Data([9])
    }

    func waitForRead() async {
        guard !started else { return }
        await withCheckedContinuation { waiting = $0 }
    }

    func resumeRead() {
        paused?.resume()
        paused = nil
    }

    func close() {
        cleanupWasCancelled = _Concurrency.Task.isCancelled
        closed = true
    }
}

private actor PayloadChunkFixture: FacetPayloadReading {
    private let block: Data
    private let count: Int
    private let failClose: Bool
    private let cancelRead: Bool
    private(set) var closed = false
    private(set) var readCount = 0

    init(block: Data, count: Int, failClose: Bool = false, cancelRead: Bool = false) {
        self.block = block
        self.count = count
        self.failClose = failClose
        self.cancelRead = cancelRead
    }

    func read(offset: UInt64, length: UInt32) throws -> Data {
        guard !closed, length <= VaultFile.maximumChunk,
            offset % UInt64(block.count) == 0, Int(length) == block.count,
            offset + UInt64(length) <= UInt64(block.count * count)
        else { throw FacetContractError.unsupportedResponse }
        readCount += 1
        if cancelRead { throw CancellationError() }
        return block
    }

    func close() throws {
        closed = true
        if failClose { throw POSIXError(.EIO) }
    }
}
