import Foundation
import Testing

@testable import TaskNotesKit

struct VaultSnapshotsTests {
    @Test func failedSnapshotCleanupStillReleasesWriterLeaseAndClosesCallbacks() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let privateURL = root.appendingPathComponent("private")
        try FileManager.default.createDirectory(at: privateURL, withIntermediateDirectories: true)
        try Data([7]).write(to: root.appendingPathComponent("source"))
        let storage = try VaultBoundedStorage(
            directory: privateURL, secrets: StageTestKeys(),
            engineIdentity: String(repeating: "c", count: 64))
        let snapshot = try #require(
            try storage.openSnapshot(profileID: "vault", directory: root, name: "source"))
        let snapshots = privateURL.appendingPathComponent("snapshots")
        let epoch = try #require(
            FileManager.default.contentsOfDirectory(atPath: snapshots.path).first)
        let epochURL = snapshots.appendingPathComponent(epoch)
        let image = try #require(
            FileManager.default.contentsOfDirectory(atPath: epochURL.path).first)
        let imageURL = epochURL.appendingPathComponent(image)
        try FileManager.default.removeItem(at: imageURL)
        try FileManager.default.createDirectory(at: imageURL, withIntermediateDirectories: false)
        #expect(throws: POSIXError.self) { try storage.close() }
        #expect(throws: VaultSnapshotError.self) {
            try storage.readSnapshot(profileID: "vault", id: snapshot.id, offset: 0, length: 1)
        }
        let lease = try #require(
            try VaultDirectory(url: privateURL).openFile("payload-owner.lock", writable: true))
        try lease.acquireExclusiveLease()
        try lease.releaseLease()
        // Corrupt disposable read-copy state is retained visibly for repair.
        #expect(FileManager.default.fileExists(atPath: imageURL.path))
    }

    @Test func exclusiveCallbackLeaseBlocksOverlappingWritersAndReopensAfterClose() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let keys = StageTestKeys()
        let identity = String(repeating: "c", count: 64)
        let original = try VaultBoundedStorage(
            directory: root, secrets: keys, engineIdentity: identity)
        #expect(throws: POSIXError.self) {
            try VaultBoundedStorage(directory: root, secrets: keys, engineIdentity: identity)
        }
        try original.close()
        let reopened = try VaultBoundedStorage(
            directory: root, secrets: keys, engineIdentity: identity)
        try reopened.close()
        try original.close()
    }

    @Test func concurrentRangesRemainExactAndOwnerCapacityAndCloseAreBounded() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let privateURL = root.appendingPathComponent("private")
        try FileManager.default.createDirectory(at: privateURL, withIntermediateDirectories: true)
        let source = try #require(
            try VaultDirectory(url: root).openFile("source", writable: true, createNew: true))
        for index in 0..<8 {
            try source.write(
                offset: UInt64(index * 4_096), bytes: Data(repeating: UInt8(index), count: 4_096))
        }
        let storage = try VaultBoundedStorage(
            directory: privateURL, secrets: StageTestKeys(),
            engineIdentity: String(repeating: "c", count: 64))
        let snapshot = try #require(
            try storage.openSnapshot(profileID: "vault", directory: root, name: "source"))
        try source.write(offset: 0, bytes: Data([99]))
        try await checkConcurrentRanges(storage, id: snapshot.id)
        var extra: [VaultSnapshotReceipt] = []
        for _ in 0..<3 {
            extra.append(
                try #require(
                    try storage.openSnapshot(profileID: "vault", directory: root, name: "source")))
        }
        #expect(throws: VaultSnapshotError.self) {
            try storage.openSnapshot(profileID: "vault", directory: root, name: "source")
        }
        #expect(throws: AppleVaultError.self) {
            try storage.closeSnapshot(profileID: "wrong-owner", id: snapshot.id)
        }
        try storage.closeSnapshot(profileID: "vault", id: snapshot.id)
        try storage.closeSnapshot(profileID: "vault", id: snapshot.id)
        #expect(throws: VaultSnapshotError.self) {
            try storage.readSnapshot(profileID: "vault", id: snapshot.id, offset: 0, length: 0)
        }
        for image in extra { try storage.closeSnapshot(profileID: "vault", id: image.id) }
        try storage.close()
        #expect(throws: VaultSnapshotError.self) {
            try storage.openSnapshot(profileID: "vault", directory: root, name: "source")
        }
    }

    private func checkConcurrentRanges(_ storage: VaultBoundedStorage, id: String) async throws {
        try await withThrowingTaskGroup(of: Void.self) { group in
            for index in 0..<32 {
                group.addTask {
                    let block = index % 8
                    for _ in 0..<40 {
                        let bytes = try storage.readSnapshot(
                            profileID: "vault", id: id, offset: UInt64(block * 4_096), length: 4_096
                        )
                        #expect(bytes == Data(repeating: UInt8(block), count: 4_096))
                    }
                }
            }
            try await group.waitForAll()
        }
    }
}
