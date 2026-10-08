import Foundation
import Testing

@testable import TaskNotesKit

struct VaultStagedExchangesTests {
    @Test func missingPreparedCreationSlotNeverInfersApplicationOrRecreatesBytes() throws {
        let fixture = try ExchangeFixture()
        defer { NativeTestFiles.remove(fixture.url) }
        let bytes = Data("ready source".utf8)
        let request = try fixture.request(bytes, expected: nil)
        let crashing = fixture.exchanges { if $0 == .prepared { throw ExchangeCrash.injected } }
        #expect(throws: ExchangeCrash.self) { try crashing.exchange(request, root: fixture.vault) }
        let preparation = try #require(try fixture.journal.existing(request)?.preparation)
        try fixture.recovery.remove(preparation.backupID + ".bytes")
        #expect(throws: VaultStageError.self) {
            try fixture.exchanges().exchange(request, root: fixture.vault)
        }
        #expect(try fixture.journal.existing(request)?.outcome == nil)
        #expect(try fixture.vault.openFile("note.md") == nil)
        let stage = try #require(request.stageID)
        #expect(
            try fixture.stages.write(profileID: "vault", id: stage, offset: 0, bytes: bytes).sealed)
    }

    @Test func metadataRecoveryAndAcknowledgmentNeverEraseTheOriginalOutcome() throws {
        let fixture = try ExchangeFixture()
        defer { NativeTestFiles.remove(fixture.url) }
        let bytes = Data("original".utf8)
        try fixture.vault.writeNew("note.md", bytes: bytes)
        let request = try fixture.request(
            Data("new".utf8), expected: AppleVaultFiles.revision(bytes))
        let crashing = fixture.exchanges { if $0 == .exchanged { throw ExchangeCrash.injected } }
        #expect(throws: ExchangeCrash.self) { try crashing.exchange(request, root: fixture.vault) }
        let exchanges = fixture.exchanges()
        let page = try exchanges.displacedMetadata(
            profileID: "vault", root: fixture.vault, afterID: nil, limit: 1)
        let retained = try #require(page.first)
        #expect(retained.revision == AppleVaultFiles.revision(bytes))
        let outcome = try exchanges.exchange(request, root: fixture.vault)
        // Emulate a crash after the owned acknowledgment commit, before unlink.
        try fixture.journal.acknowledge(profileID: "vault", id: retained.id)
        #expect(
            try exchanges.displacedMetadata(
                profileID: "vault", root: fixture.vault, afterID: nil, limit: 128
            ).isEmpty)
        try exchanges.acknowledgeDisplaced(profileID: "vault", id: retained.id, root: fixture.vault)
        try exchanges.acknowledgeDisplaced(profileID: "vault", id: retained.id, root: fixture.vault)
        #expect(try fixture.recovery.openFile(retained.id + ".bytes") == nil)
        #expect(try exchanges.exchange(request, root: fixture.vault) == outcome)
        try exchanges.discard(
            profileID: "vault", id: try #require(request.stageID), root: fixture.vault)
        #expect(try exchanges.exchange(request, root: fixture.vault) == outcome)
    }

    @Test func crashAfterEqualHashSwapUsesInodeProofAndReplaysTheOriginalOutcome() throws {
        let fixture = try ExchangeFixture()
        defer { NativeTestFiles.remove(fixture.url) }
        let bytes = Data("original".utf8)
        try fixture.vault.writeNew("note.md", bytes: bytes)
        let request = try fixture.request(bytes, expected: AppleVaultFiles.revision(bytes))
        let crashing = fixture.exchanges { if $0 == .exchanged { throw ExchangeCrash.injected } }
        #expect(throws: ExchangeCrash.self) { try crashing.exchange(request, root: fixture.vault) }
        let replayed = try fixture.exchanges().exchange(request, root: fixture.vault)
        let retained = try #require(replayed.displaced)
        #expect(retained.revision == AppleVaultFiles.revision(bytes))
        #expect(replayed.applied && retained.size == UInt64(bytes.count))
        let changed = Data("later external edit".utf8)
        try fixture.vault.replaceMetadata("note.md", bytes: changed)
        #expect(try fixture.exchanges().exchange(request, root: fixture.vault) == replayed)
        #expect(try fixture.vault.read("note.md") == changed)
        try fixture.stages.discard(profileID: "vault", id: try #require(request.stageID))
        #expect(try fixture.exchanges().exchange(request, root: fixture.vault) == replayed)
        #expect(
            try fixture.recovery.openFile(retained.id + ".bytes")?.fingerprint().revision
                == retained.revision)
    }

    @Test func racedPredecessorIsRetainedWhileTheSealedSourceStaysIndependent() throws {
        let fixture = try ExchangeFixture()
        defer { NativeTestFiles.remove(fixture.url) }
        let old = Data("old".utf8)
        let replacement = Data("replacement".utf8)
        let raced = Data("concurrent external bytes".utf8)
        try fixture.vault.writeNew("note.md", bytes: old)
        let request = try fixture.request(replacement, expected: AppleVaultFiles.revision(old))
        let exchanging = fixture.exchanges { boundary in
            if boundary == .beforeExchange {
                try fixture.vault.replaceMetadata("note.md", bytes: raced)
            }
        }
        let outcome = try exchanging.exchange(request, root: fixture.vault)
        let retained = try #require(outcome.displaced)
        #expect(outcome.applied && retained.revision == AppleVaultFiles.revision(raced))
        #expect(try fixture.vault.read("note.md") == replacement)
        try fixture.vault.replaceMetadata("note.md", bytes: Data("edited after swap".utf8))
        let stageID = try #require(request.stageID)
        #expect(
            try fixture.stages.write(profileID: "vault", id: stageID, offset: 0, bytes: replacement)
                .sealed)
        #expect(try fixture.recovery.read(retained.id + ".bytes") == raced)
    }

    @Test func creationAndDeletionCrashRetriesNeverRepeatTheirFilesystemEffects() throws {
        let fixture = try ExchangeFixture()
        defer { NativeTestFiles.remove(fixture.url) }
        let creation = try fixture.request(Data(), expected: nil)
        let crashing = fixture.exchanges { if $0 == .exchanged { throw ExchangeCrash.injected } }
        #expect(throws: ExchangeCrash.self) { try crashing.exchange(creation, root: fixture.vault) }
        #expect(try fixture.exchanges().exchange(creation, root: fixture.vault).applied)
        #expect(try fixture.vault.openFile("note.md")?.size() == 0)
        let deletion = VaultExchangeRequest(
            profileID: "vault", operationID: "facet-write:" + String(repeating: "d", count: 64),
            path: "note.md", expectedRevision: AppleVaultFiles.revision(Data()), stageID: nil)
        #expect(throws: ExchangeCrash.self) { try crashing.exchange(deletion, root: fixture.vault) }
        let removed = try fixture.exchanges().exchange(deletion, root: fixture.vault)
        #expect(removed.applied && removed.displaced?.size == 0)
        try fixture.vault.writeNew("note.md", bytes: Data("independent new file".utf8))
        #expect(try fixture.exchanges().exchange(deletion, root: fixture.vault) == removed)
        #expect(try fixture.vault.read("note.md") == Data("independent new file".utf8))
    }
}

private enum ExchangeCrash: Error { case injected }

private struct ExchangeFixture {
    let url: URL
    let vault: VaultDirectory
    let recovery: VaultDirectory
    let stages: VaultReplacementStages
    let journal: VaultExchangeJournal

    init() throws {
        url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        let root = try VaultDirectory(url: url)
        let privateDirectory = try root.directory("private", create: true)
        let signer = try VaultHandleSigner(
            directory: privateDirectory, secrets: StageTestKeys(),
            engineIdentity: String(repeating: "c", count: 64))
        vault = try root.directory("vault", create: true)
        recovery = try vault.directory(
            ".facet-recovery/" + VaultHandleSigner.digest("vault") + "/bounded", create: true)
        stages = VaultReplacementStages(directory: privateDirectory, signer: signer)
        journal = VaultExchangeJournal(directory: privateDirectory, signer: signer)
    }

    func request(_ bytes: Data, expected: String?) throws -> VaultExchangeRequest {
        let operation = "facet-write:" + String(repeating: "b", count: 64)
        let intent = VaultStageIntent(
            profileID: "vault", operationID: operation, path: "note.md", expectedRevision: expected,
            size: UInt64(bytes.count), revision: AppleVaultFiles.revision(bytes))
        let stage = try stages.begin(intent)
        _ = try stages.write(profileID: "vault", id: stage.id, offset: 0, bytes: bytes)
        _ = try stages.seal(profileID: "vault", id: stage.id)
        return VaultExchangeRequest(
            profileID: "vault", operationID: operation, path: "note.md", expectedRevision: expected,
            stageID: stage.id)
    }

    func exchanges(fault: @escaping (VaultExchangeBoundary) throws -> Void = { _ in })
        -> VaultStagedExchanges
    {
        VaultStagedExchanges(stages: stages, journal: journal, fault: fault)
    }
}
