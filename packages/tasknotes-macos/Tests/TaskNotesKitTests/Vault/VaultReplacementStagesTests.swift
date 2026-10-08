import Foundation
import Synchronization
import Testing

@testable import TaskNotesKit

struct VaultReplacementStagesTests {
    @Test func sealedRetriesAndRetiredOutcomeSurviveReopenWithoutWritableAliasing() throws {
        let fixture = try StageFixture()
        defer { NativeTestFiles.remove(fixture.url) }
        let bytes = Data(repeating: 41, count: 8_192)
        let intent = fixture.intent(bytes)
        let stage = try fixture.stages.begin(intent)
        _ = try fixture.stages.write(profileID: "vault", id: stage.id, offset: 0, bytes: bytes)
        let sealed = try fixture.stages.seal(profileID: "vault", id: stage.id)
        #expect(
            try fixture.stages.write(profileID: "vault", id: stage.id, offset: 0, bytes: bytes)
                == sealed)
        #expect(throws: VaultStageError.self) {
            try fixture.stages.write(profileID: "vault", id: stage.id, offset: 0, bytes: Data([99]))
        }
        let destination = try #require(
            try fixture.directory.openFile("destination", writable: true, createNew: true))
        _ = try fixture.stages.copySealed(
            profileID: "vault", id: stage.id, destination: destination)
        try destination.write(offset: 0, bytes: Data([99]))
        #expect(
            try fixture.stages.write(profileID: "vault", id: stage.id, offset: 0, bytes: bytes)
                == sealed)
        let outcome = VaultStagedOutcome(
            applied: true,
            displaced: VaultCapturedPredecessor(
                id: UUID().uuidString, path: intent.path, size: 4,
                revision: AppleVaultFiles.revision(Data([1, 2, 3, 4]))))
        try fixture.stages.recordOutcome(profileID: "vault", id: stage.id, outcome: outcome)
        try fixture.stages.discard(profileID: "vault", id: stage.id)
        let reopened = try fixture.reopen()
        #expect(try reopened.outcome(profileID: "vault", id: stage.id) == outcome)
        #expect(try reopened.begin(intent) == sealed)
        try reopened.discard(profileID: "vault", id: stage.id)
        #expect(throws: VaultStageError.self) {
            try reopened.recordOutcome(
                profileID: "vault", id: stage.id,
                outcome: VaultStagedOutcome(applied: false, displaced: nil))
        }
    }

    @Test func durableIntentAndCommittedPrefixRecoverInterruptedCreationAndWrites() throws {
        let fixture = try StageFixture()
        defer { NativeTestFiles.remove(fixture.url) }
        let bytes = Data(repeating: 17, count: 16)
        let intent = fixture.intent(bytes)
        let id = try fixture.signer.stage(profileID: "vault", operationID: intent.operationID)
        let name = try fixture.signer.stageName(profileID: "vault", id: id)
        let folder = try fixture.directory.directory(
            VaultHandleSigner.digest("vault"), create: true)
        let stage = VaultStageReceipt(
            id: id, operationID: intent.operationID, path: intent.path, size: intent.size,
            revision: intent.revision, written: 0, sealed: false)
        try folder.writeNewAtomic(
            name + ".json",
            bytes: JSONEncoder().encode(
                VaultStageManifest(
                    schemaVersion: 1, engineIdentity: fixture.signer.engineIdentity,
                    intent: intent, stage: stage, discarded: false)
            ))
        #expect(try fixture.stages.begin(intent) == stage)
        let prefix = try fixture.stages.write(
            profileID: "vault", id: id, offset: 0, bytes: Data(bytes.prefix(8)))
        let image = try #require(try folder.openFile(name + ".image", writable: true))
        try image.write(offset: 8, bytes: Data([99, 98]))
        #expect(try fixture.reopen().begin(intent) == prefix)
        #expect(try image.size() == 8)
        #expect(throws: VaultStageError.self) {
            try fixture.stages.write(profileID: "vault", id: id, offset: 9, bytes: Data([17]))
        }
        #expect(throws: VaultStageError.self) {
            try fixture.stages.write(profileID: "vault", id: id, offset: 7, bytes: Data([17, 17]))
        }
    }

    @Test func retirementBeforeImageCleanupAndMissingKeyPreserveTerminalReceipt() throws {
        let fixture = try StageFixture()
        defer { NativeTestFiles.remove(fixture.url) }
        let bytes = Data([1, 2, 3])
        let intent = fixture.intent(bytes)
        let stage = try fixture.stages.begin(intent)
        _ = try fixture.stages.write(profileID: "vault", id: stage.id, offset: 0, bytes: bytes)
        let sealed = try fixture.stages.seal(profileID: "vault", id: stage.id)
        let name = try fixture.signer.stageName(profileID: "vault", id: stage.id)
        let folder = try fixture.directory.directory(VaultHandleSigner.digest("vault"))
        try folder.replaceMetadata(
            name + ".json",
            bytes: JSONEncoder().encode(
                VaultStageManifest(
                    schemaVersion: 1, engineIdentity: fixture.signer.engineIdentity,
                    intent: intent, stage: sealed, discarded: true)
            ))
        try fixture.reopen().discard(profileID: "vault", id: stage.id)
        #expect(try folder.openFile(name + ".image") == nil)
        fixture.keys.clear()
        #expect(throws: AppleVaultError.self) { try fixture.reopen() }
        #expect(try folder.openFile(name + ".json") != nil)
    }

    @Test func unknownPrivateManifestFieldsFailWithoutResettingCommittedImage() throws {
        let fixture = try StageFixture()
        defer { NativeTestFiles.remove(fixture.url) }
        let intent = fixture.intent(Data())
        let stage = try fixture.stages.begin(intent)
        let name = try fixture.signer.stageName(profileID: "vault", id: stage.id)
        let folder = try fixture.directory.directory(VaultHandleSigner.digest("vault"))
        let encoded = try JSONEncoder().encode(
            VaultStageManifest(
                schemaVersion: 1, engineIdentity: fixture.signer.engineIdentity,
                intent: intent, stage: stage, discarded: false))
        var fields = try #require(try JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        fields["unknown"] = true
        try folder.replaceMetadata(
            name + ".json", bytes: JSONSerialization.data(withJSONObject: fields))
        #expect(throws: VaultStageError.self) { try fixture.stages.begin(intent) }
        #expect(try folder.openFile(name + ".image") != nil)
    }
}

private struct StageFixture {
    let url: URL
    let directory: VaultDirectory
    let keys = StageTestKeys()
    let signer: VaultHandleSigner
    let stages: VaultReplacementStages

    init() throws {
        url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        directory = try VaultDirectory(url: url)
        signer = try VaultHandleSigner(
            directory: directory, secrets: keys,
            engineIdentity: String(repeating: "c", count: 64))
        stages = VaultReplacementStages(directory: directory, signer: signer)
    }

    func intent(_ bytes: Data) -> VaultStageIntent {
        VaultStageIntent(
            profileID: "vault", operationID: "facet-write:" + String(repeating: "b", count: 64),
            path: "files/note.md", expectedRevision: nil, size: UInt64(bytes.count),
            revision: AppleVaultFiles.revision(bytes))
    }

    func reopen() throws -> VaultReplacementStages {
        try VaultReplacementStages(
            directory: directory,
            signer: VaultHandleSigner(
                directory: directory, secrets: keys,
                engineIdentity: String(repeating: "c", count: 64)))
    }
}

internal final class StageTestKeys: FacetSecureStore {
    private let values = Mutex<[String: Data]>([:])
    func read(_ name: String) throws -> Data? { values.withLock { $0[name] } }
    func write(_ name: String, bytes: Data) throws { values.withLock { $0[name] = bytes } }
    func remove(_ name: String) throws { values.withLock { _ = $0.removeValue(forKey: name) } }
    func clear() { values.withLock { $0.removeAll() } }
}
