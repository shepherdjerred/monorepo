import Foundation
import Synchronization
import Testing

@testable import TaskNotesKit

struct VaultHandleSignerTests {
    @Test func snapshotProofsAreOwnerAndEngineBoundWhileStagesSurviveReopen() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let directory = try VaultDirectory(url: root)
        let secrets = SyntheticVaultHandleKeys()
        let original = try VaultHandleSigner(
            directory: directory, secrets: secrets,
            engineIdentity: String(repeating: "c", count: 64))
        let nonce = UUID().uuidString.lowercased()
        let snapshot = try original.snapshot(profileID: "vault", nonce: nonce)
        #expect(try original.snapshotNonce(profileID: "vault", id: snapshot) == nonce)
        #expect(throws: AppleVaultError.self) {
            try original.snapshotNonce(profileID: "another-vault", id: snapshot)
        }
        let operation = "facet-write:" + String(repeating: "a", count: 64)
        let stage = try original.stage(profileID: "vault", operationID: operation)
        let reopened = try VaultHandleSigner(
            directory: directory, secrets: secrets,
            engineIdentity: String(repeating: "c", count: 64))
        #expect(try reopened.stage(profileID: "vault", operationID: operation) == stage)
        #expect(
            try reopened.stageName(profileID: "vault", id: stage)
                == VaultHandleSigner.digest(operation))
        #expect(throws: AppleVaultError.self) {
            try reopened.snapshotNonce(profileID: "vault", id: snapshot)
        }
        #expect(throws: AppleVaultError.self) {
            try reopened.stageName(profileID: "another-vault", id: stage)
        }
        #expect(stage.utf8.count <= 256 && snapshot.utf8.count <= 256)
        let otherEngine = try VaultHandleSigner(
            directory: directory, secrets: secrets,
            engineIdentity: String(repeating: "d", count: 64))
        #expect(throws: AppleVaultError.self) {
            try otherEngine.stageName(profileID: "vault", id: stage)
        }
    }

    @Test func forgedOversizedOrPathLikeTokensCannotBecomePrivateBasenames() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let signer = try VaultHandleSigner(
            directory: VaultDirectory(url: root), secrets: SyntheticVaultHandleKeys(),
            engineIdentity: String(repeating: "c", count: 64))
        let stage = try signer.stage(
            profileID: "vault", operationID: "facet-write:" + String(repeating: "a", count: 64))
        let replacement = stage.last == "0" ? "1" : "0"
        for invalid in [
            String(stage.dropLast()) + replacement, "../outside",
            String(repeating: "x", count: 257),
        ] {
            #expect(throws: AppleVaultError.self) {
                try signer.stageName(profileID: "vault", id: invalid)
            }
        }
    }
}

private final class SyntheticVaultHandleKeys: FacetSecureStore {
    private let values = Mutex<[String: Data]>([:])
    func read(_ name: String) throws -> Data? { values.withLock { $0[name] } }
    func write(_ name: String, bytes: Data) throws { values.withLock { $0[name] = bytes } }
    func remove(_ name: String) throws { values.withLock { _ = $0.removeValue(forKey: name) } }
}
