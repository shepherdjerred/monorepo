import CryptoKit
import Foundation
import Testing

@testable import TaskNotesKit

struct AppleVaultBoundedFilesTests {
    @Test func coordinatedThreeChunkCreationSnapshotAndRetirementKeepExactBytes() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let vault = root.appendingPathComponent("vault")
        let host = root.appendingPathComponent("host")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let files = try AppleVaultFiles(directory: host)
        try files.register(profileID: "vault", directory: vault, external: false)
        try files.bindEngine(identity: String(repeating: "c", count: 64), secrets: StageTestKeys())
        defer { NativeTestFiles.closeBounded(files) }
        let block = Data(repeating: 19, count: VaultFile.maximumChunk)
        let revision = threeBlockRevision(block)
        let intent = VaultStageIntent(
            profileID: "vault",
            operationID: "facet-write:" + String(repeating: "a", count: 64),
            path: "attachments/large.bin", expectedRevision: nil,
            size: UInt64(block.count * 3), revision: revision)
        let stage = try files.beginReplacement(intent)
        for index in 0..<3 {
            _ = try files.writeReplacementChunk(
                profileID: "vault", id: stage.id,
                offset: UInt64(index * block.count), bytes: block)
        }
        #expect(try files.sealReplacement(profileID: "vault", id: stage.id).sealed)
        let request = VaultExchangeRequest(
            profileID: "vault", operationID: intent.operationID,
            path: intent.path, expectedRevision: nil, stageID: stage.id)
        let outcome = try files.compareExchangeStaged(request)
        #expect(outcome.applied && outcome.displaced == nil)
        let snapshot = try #require(
            try files.openFileSnapshot(profileID: "vault", path: intent.path))
        #expect(snapshot.size == intent.size && snapshot.revision == revision)
        #expect(
            try files.readSnapshotChunk(
                profileID: "vault", id: snapshot.id,
                offset: UInt64(block.count), length: UInt32(block.count)) == block)
        try files.closeSnapshot(profileID: "vault", id: snapshot.id)
        try files.closeSnapshot(profileID: "vault", id: snapshot.id)
        try files.discardReplacement(profileID: "vault", id: stage.id)
        #expect(try files.compareExchangeStaged(request) == outcome)
        #expect(
            try files.openFileSnapshot(profileID: "vault", path: "missing/different.bin") == nil)
        #expect(
            try files.boundedDisplacedMetadata(profileID: "vault", afterID: nil, limit: 128).isEmpty
        )
        try files.closeBoundedFiles()
        #expect(throws: VaultSnapshotError.self) {
            try files.openFileSnapshot(profileID: "vault", path: intent.path)
        }
    }

    private func threeBlockRevision(_ block: Data) -> String {
        var hash = SHA256()
        for _ in 0..<3 { hash.update(data: block) }
        return hash.finalize().map {
            let value = String($0, radix: 16)
            return value.count == 1 ? "0" + value : value
        }.joined()
    }
}

extension NativeTestFiles {
    static func closeBounded(_ files: AppleVaultFiles) {
        do { try files.closeBoundedFiles() } catch {
            Issue.record("Private callback cleanup failed.")
        }
    }
}
