import Foundation
import Synchronization
import TaskNotesUniFFI
import Testing

@testable import TaskNotesKit

struct FacetOccurrenceSyncNotificationTests {
    @Test func readyRequestsMaintenanceButRealUploadAcknowledgmentOnlyRefreshesPresentation()
        async throws
    {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let secrets = OccurrenceTestSecrets()
        let engine = try await FacetEngine.open(
            directory: root.appendingPathComponent("engine"), secrets: secrets)
        let profile = try await engine.registerReplica(id: UUID().uuidString, name: "Synthetic")
        try await engine.approveStandard(profile: profile)
        _ = try await engine.refresh(profileID: profile.id)
        let account = try FacetObsidianAccount(
            directory: root.appendingPathComponent("account"), secrets: secrets)
        let vaultJSON = """
            {"id":"synthetic","name":"Synthetic","host":"sync-test.obsidian.md",
             "region":"test","salt":"synthetic","encryptionVersion":3,"managed":true,"shared":false}
            """
        let vault = try JSONDecoder().decode(FacetRemoteVault.self, from: Data(vaultJSON.utf8))
        let counts = OccurrenceNotificationCounts()
        let session = try FacetObsidianSession(
            engine: engine, account: account, profileID: profile.id,
            access: FacetSyncAccess(
                profileID: profile.id,
                identity: FacetSyncIdentity(owner: "synthetic", vault: vault),
                token: "synthetic-test-token", key: Data(repeating: 7, count: 32), generation: 0),
            checkpoint: "", changed: { await counts.presentationChanged() }, status: { _ in },
            remoteChanged: { await counts.maintenanceChanged() })
        // Execute actual typed core effects; no socket is opened or worker started.
        _ = try await session.executeEffect(.ready(cursor: 0), nowMs: 0)
        await session.publishChanges()
        #expect(await counts.presentation == 1)
        #expect(await counts.maintenance == 1)
        await session.publishChanges()
        #expect(await counts.maintenance == 1)

        try await engine.execute(
            profileID: profile.id,
            command: .object([
                "kind": .string("create"),
                "properties": .object(["title": .string("Synthetic upload")]),
            ]))
        let upload = try #require(await engine.uploads(profileID: profile.id).first?.object?.fields)
        let id = try #require(upload["mutationId"]?.text)
        try await session.acknowledgeSyntheticUpload(id)
        #expect(await counts.presentation == 2)
        #expect(await counts.maintenance == 1)
        #expect(try await engine.uploads(profileID: profile.id).isEmpty)
        await session.stop()
        try await engine.close()
    }
}

extension FacetObsidianSession {
    fileprivate func acknowledgeSyntheticUpload(_ id: String) async throws {
        queued.insert(id)
        _ = try await executeEffect(
            .uploaded(operationId: id, contentHash: String(repeating: "a", count: 64)), nowMs: 0)
        await publishChanges()
    }
}

private actor OccurrenceNotificationCounts {
    private(set) var presentation = 0
    private(set) var maintenance = 0
    func presentationChanged() { presentation += 1 }
    func maintenanceChanged() { maintenance += 1 }
}

private final class OccurrenceTestSecrets: FacetSecureStore {
    private let values = Mutex<[String: Data]>([:])
    func read(_ name: String) -> Data? { values.withLock { $0[name] } }
    func write(_ name: String, bytes: Data) { values.withLock { $0[name] = bytes } }
    func remove(_ name: String) { _ = values.withLock { $0.removeValue(forKey: name) } }
}
