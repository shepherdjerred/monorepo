import Foundation
import Testing

@testable import TaskNotesKit

struct VaultLegacyRecoveryTests {
    @Test func oldCapturedBytesSurviveBoundedPagingSnapshotsAndReopenedAcknowledgment() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let vault = root.appendingPathComponent("vault")
        let host = root.appendingPathComponent("host")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let files = try AppleVaultFiles(directory: host)
        try files.register(profileID: "owner", directory: vault, external: false)
        let original = Data(repeating: 73, count: VaultFile.maximumChunk * 3)
        try Data(original).write(to: vault.appendingPathComponent("original.bin"))
        let exchange = try files.exchange(
            profileID: "owner", path: "original.bin",
            expectedRevision: AppleVaultFiles.revision(original),
            replacement: Data("updated".utf8))
        let old = try #require(
            try files.displacedMetadata(profileID: "owner", afterID: nil, limit: 1).first)
        #expect(old.id == exchange.displacedVersionID)
        #expect(old.id == old.id.uppercased())
        let keys = StageTestKeys()
        let namespace = String(repeating: "a", count: 64)
        try files.bindEngine(identity: namespace, secrets: keys)
        let new = try boundedCapture(files)
        let first = try files.boundedDisplacedMetadata(profileID: "owner", afterID: nil, limit: 1)
        let cursor = try #require(first.first?.id)
        let second = try files.boundedDisplacedMetadata(
            profileID: "owner", afterID: cursor, limit: 1)
        #expect((first + second).map(\.id) == [old.id, new.id].sorted())
        try expectMixedContinuationsAndNewAcknowledgment(files, old: old.id, new: new.id)
        let snapshot = try files.openDisplacedSnapshot(profileID: "owner", id: old.id)
        #expect(snapshot.size == UInt64(original.count))
        try expectThreeChunks(files, snapshot: snapshot)
        try files.acknowledgeBoundedDisplaced(profileID: "owner", id: old.id)
        // A snapshot is an independent immutable image even after the source
        // capture is acknowledged and removed.
        #expect(
            try files.readSnapshotChunk(profileID: "owner", id: snapshot.id, offset: 0, length: 1)
                == Data([73]))
        try files.closeSnapshot(profileID: "owner", id: snapshot.id)
        try files.closeBoundedFiles()
        let reopened = try AppleVaultFiles(directory: host)
        try reopened.bindEngine(identity: namespace, secrets: keys)
        defer { NativeTestFiles.closeBounded(reopened) }
        try reopened.acknowledgeBoundedDisplaced(profileID: "owner", id: old.id)
        try reopened.acknowledgeBoundedDisplaced(profileID: "owner", id: new.id)
        #expect(
            try reopened.boundedDisplacedMetadata(profileID: "owner", afterID: nil, limit: 128)
                .isEmpty)
        #expect(throws: AppleVaultError.self) {
            try reopened.openDisplacedSnapshot(profileID: "owner", id: old.id)
        }
    }

    private func expectMixedContinuationsAndNewAcknowledgment(
        _ files: AppleVaultFiles, old: String, new: String
    ) throws {
        let ids = [old, new].sorted()
        for cursor in [old, new] {
            #expect(
                try files.boundedDisplacedMetadata(
                    profileID: "owner", afterID: cursor, limit: 1
                ).map(\.id)
                    == Array(ids.filter { $0 > cursor }.prefix(1)))
        }
        let snapshot = try files.openDisplacedSnapshot(profileID: "owner", id: new)
        #expect(
            try files.readSnapshotChunk(
                profileID: "owner", id: snapshot.id, offset: 0, length: 7) == Data("updated".utf8))
        try files.acknowledgeBoundedDisplaced(profileID: "owner", id: new)
        try files.closeSnapshot(profileID: "owner", id: snapshot.id)
        #expect(
            try files.boundedDisplacedMetadata(
                profileID: "owner", afterID: nil, limit: 128
            ).map(\.id) == [old])
    }

    private func expectThreeChunks(_ files: AppleVaultFiles, snapshot: VaultSnapshotReceipt) throws
    {
        for index in 0..<3 {
            #expect(
                try files.readSnapshotChunk(
                    profileID: "owner", id: snapshot.id,
                    offset: UInt64(index * VaultFile.maximumChunk),
                    length: UInt32(VaultFile.maximumChunk))
                    == Data(repeating: 73, count: VaultFile.maximumChunk))
        }
    }

    private func boundedCapture(_ files: AppleVaultFiles) throws -> VaultCapturedPredecessor {
        let replacement = Data("new bounded edit".utf8)
        let intent = VaultStageIntent(
            profileID: "owner", operationID: "facet-write:" + String(repeating: "b", count: 64),
            path: "original.bin", expectedRevision: AppleVaultFiles.revision(Data("updated".utf8)),
            size: UInt64(replacement.count), revision: AppleVaultFiles.revision(replacement))
        let stage = try files.beginReplacement(intent)
        _ = try files.writeReplacementChunk(
            profileID: "owner", id: stage.id, offset: 0, bytes: replacement)
        _ = try files.sealReplacement(profileID: "owner", id: stage.id)
        return try #require(
            try files.compareExchangeStaged(
                VaultExchangeRequest(
                    profileID: "owner", operationID: intent.operationID, path: intent.path,
                    expectedRevision: intent.expectedRevision, stageID: stage.id)
            ).displaced)
    }

    @Test func dispositionPrecedesCleanupAndRestartFinishesAnInterruptedLegacyAcknowledgment()
        throws
    {
        let fixture = try LegacyFixture()
        defer { NativeTestFiles.remove(fixture.root) }
        let crashing = VaultLegacyRecovery(
            directory: fixture.privateDirectory, engineIdentity: fixture.namespace,
            afterAcknowledgment: { throw LegacyCrash.injected })
        #expect(throws: LegacyCrash.self) {
            try crashing.acknowledge(profileID: "owner", id: fixture.id, root: fixture.vault)
        }
        #expect(try fixture.recovery.openFile(fixture.id + ".bytes") != nil)
        #expect(try fixture.recovery.openFile(fixture.id + ".json") != nil)
        // A second interruption occurs between the two unlinks.
        try fixture.recovery.remove(fixture.id + ".bytes")
        let reopened = fixture.helper()
        #expect(
            try reopened.metadata(profileID: "owner", root: fixture.vault, afterID: nil, limit: 128)
                .isEmpty)
        try reopened.acknowledge(profileID: "owner", id: fixture.id, root: fixture.vault)
        try reopened.acknowledge(profileID: "owner", id: fixture.id, root: fixture.vault)
        #expect(try fixture.recovery.openFile(fixture.id + ".json") == nil)
        #expect(throws: AppleVaultError.self) {
            try reopened.acknowledge(profileID: "foreign", id: fixture.id, root: fixture.vault)
        }
    }

    @Test func ambiguousLegacyEqualHashAndMissingCapturesRemainVisibleAndRetained() throws {
        let fixture = try LegacyFixture()
        defer { NativeTestFiles.remove(fixture.root) }
        let bytes = Data("legacy original".utf8)
        let ambiguous = AppleVaultFiles.Displacement(
            id: fixture.id, path: "note.md", replacementRevision: AppleVaultFiles.revision(bytes),
            expectedRevision: AppleVaultFiles.revision(bytes))
        try fixture.recovery.replaceMetadata(
            fixture.id + ".json", bytes: JSONEncoder().encode(ambiguous))
        #expect(throws: AppleVaultError.self) {
            try fixture.helper().metadata(
                profileID: "owner", root: fixture.vault, afterID: nil, limit: 128)
        }
        #expect(try fixture.recovery.read(fixture.id + ".bytes") == bytes)
        try fixture.recovery.remove(fixture.id + ".bytes")
        #expect(throws: AppleVaultError.self) {
            try fixture.helper().metadata(
                profileID: "owner", root: fixture.vault, afterID: nil, limit: 128)
        }
        #expect(try fixture.recovery.openFile(fixture.id + ".json") != nil)
    }
}

private enum LegacyCrash: Error { case injected }

private struct LegacyFixture {
    let root: URL
    let vault: VaultDirectory
    let recovery: VaultDirectory
    let privateDirectory: VaultDirectory
    let namespace = String(repeating: "c", count: 64)
    let id = UUID().uuidString

    init() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let directory = try VaultDirectory(url: root)
        vault = try directory.directory("vault", create: true)
        privateDirectory = try directory.directory("private", create: true)
        recovery = try vault.directory(
            ".facet-recovery/" + VaultHandleSigner.digest("owner"), create: true)
        let bytes = Data("legacy original".utf8)
        try recovery.writeNew(id + ".bytes", bytes: bytes)
        try recovery.writeNewAtomic(
            id + ".json",
            bytes: JSONEncoder().encode(
                AppleVaultFiles.Displacement(
                    id: id, path: "note.md",
                    replacementRevision: AppleVaultFiles.revision(Data("replacement".utf8)),
                    expectedRevision: AppleVaultFiles.revision(bytes),
                    capturedSize: UInt64(bytes.count),
                    capturedRevision: AppleVaultFiles.revision(bytes))))
    }

    func helper() -> VaultLegacyRecovery {
        VaultLegacyRecovery(directory: privateDirectory, engineIdentity: namespace)
    }
}
