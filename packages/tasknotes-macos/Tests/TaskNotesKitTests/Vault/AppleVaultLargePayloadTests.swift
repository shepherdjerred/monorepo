import CryptoKit
import Foundation
import Testing

@testable import TaskNotesKit

/// Real filesystem capability test at the supported Sync plaintext limit.
/// It intentionally never constructs a complete attachment Data value.
struct AppleVaultLargePayloadTests {
    private let chunks = 199
    private let profile = "near-limit-vault"
    private let path = "attachments/199-mib.bin"

    @Test func supportedLimitSnapshotReplacementAndCapturedPredecessorRemainExact() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let vault = root.appendingPathComponent("vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let oldBlock = Data(repeating: 11, count: VaultFile.maximumChunk)
        let newBlock = Data(repeating: 37, count: VaultFile.maximumChunk)
        let oldRevision = try writeSource(vault: vault, block: oldBlock)
        let files = try AppleVaultFiles(directory: root.appendingPathComponent("host"))
        try files.register(profileID: profile, directory: vault, external: false)
        try files.bindEngine(identity: String(repeating: "e", count: 64), secrets: StageTestKeys())
        defer { NativeTestFiles.closeBounded(files) }
        let original = try #require(try files.openFileSnapshot(profileID: profile, path: path))
        try verifySnapshot(files, snapshot: original, block: oldBlock, revision: oldRevision)
        let stage = try stageReplacement(files, block: newBlock, expected: oldRevision)
        let request = VaultExchangeRequest(
            profileID: profile, operationID: stage.operationID, path: path,
            expectedRevision: oldRevision, stageID: stage.id)
        let outcome = try files.compareExchangeStaged(request)
        #expect(outcome.applied)
        let predecessor = try #require(outcome.displaced)
        #expect(predecessor.size == byteCount && predecessor.revision == oldRevision)
        let captured = try files.openDisplacedSnapshot(profileID: profile, id: predecessor.id)
        try verifySnapshot(files, snapshot: captured, block: oldBlock, revision: oldRevision)
        let current = try #require(try files.openFileSnapshot(profileID: profile, path: path))
        try verifySnapshot(files, snapshot: current, block: newBlock, revision: stage.revision)
        try files.acknowledgeBoundedDisplaced(profileID: profile, id: predecessor.id)
        // Acknowledgement cannot invalidate an already-open independent image.
        try verifySnapshot(files, snapshot: captured, block: oldBlock, revision: oldRevision)
        for snapshot in [original, captured, current] {
            try files.closeSnapshot(profileID: profile, id: snapshot.id)
        }
        try files.discardReplacement(profileID: profile, id: stage.id)
        #expect(try files.compareExchangeStaged(request) == outcome)
        #expect(
            try files.boundedDisplacedMetadata(profileID: profile, afterID: nil, limit: 128).isEmpty
        )
    }

    private var byteCount: UInt64 { UInt64(chunks * VaultFile.maximumChunk) }

    private func writeSource(vault: URL, block: Data) throws -> String {
        let root = try VaultDirectory(url: vault)
        let (parent, name) = try root.parent(path, create: true)
        let file = try #require(try parent.openFile(name, writable: true, createNew: true))
        for index in 0..<chunks {
            try file.write(offset: UInt64(index * block.count), bytes: block)
        }
        try file.synchronize()
        try parent.synchronize()
        try root.synchronize()
        let fingerprint = try file.fingerprint()
        #expect(fingerprint.size == byteCount)
        return fingerprint.revision
    }

    private func stageReplacement(_ files: AppleVaultFiles, block: Data, expected: String) throws
        -> VaultStageReceipt
    {
        let revision = repeatedRevision(block)
        let stage = try files.beginReplacement(
            VaultStageIntent(
                profileID: profile, operationID: "facet-write:" + String(repeating: "d", count: 64),
                path: path, expectedRevision: expected, size: byteCount, revision: revision))
        for index in 0..<chunks {
            let receipt = try files.writeReplacementChunk(
                profileID: profile, id: stage.id, offset: UInt64(index * block.count), bytes: block)
            #expect(receipt.written == UInt64((index + 1) * block.count))
        }
        let sealed = try files.sealReplacement(profileID: profile, id: stage.id)
        #expect(sealed.sealed && sealed.size == byteCount && sealed.revision == revision)
        // Exact chunk retries use the retained sealed image, without restarting.
        #expect(
            try files.writeReplacementChunk(
                profileID: profile, id: stage.id, offset: 0, bytes: block)
                == sealed)
        return sealed
    }

    private func verifySnapshot(
        _ files: AppleVaultFiles, snapshot: VaultSnapshotReceipt, block: Data, revision: String
    ) throws {
        #expect(snapshot.size == byteCount && snapshot.revision == revision)
        var hash = SHA256()
        for index in 0..<chunks {
            let bytes = try files.readSnapshotChunk(
                profileID: profile, id: snapshot.id, offset: UInt64(index * block.count),
                length: UInt32(block.count))
            #expect(bytes == block)
            hash.update(data: bytes)
        }
        #expect(hex(hash.finalize()) == revision)
        #expect(
            try files.readSnapshotChunk(
                profileID: profile, id: snapshot.id, offset: byteCount, length: 0
            ).isEmpty)
    }

    private func repeatedRevision(_ block: Data) -> String {
        var hash = SHA256()
        for _ in 0..<chunks { hash.update(data: block) }
        return hex(hash.finalize())
    }

    private func hex(_ digest: SHA256.Digest) -> String {
        digest.map {
            let value = String($0, radix: 16)
            return value.count == 1 ? "0" + value : value
        }.joined()
    }
}
