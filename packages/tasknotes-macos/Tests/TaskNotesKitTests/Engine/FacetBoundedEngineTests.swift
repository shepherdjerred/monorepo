import Foundation
import TaskNotesUniFFI
import Testing

@testable import TaskNotesKit

struct FacetBoundedEngineTests {
    @Test func payloadPrefixSurvivesEngineReopenAndClosedHandleCannotRead() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { NativeTestFiles.remove(root) }
        let keys = StageTestKeys()
        let engine = try await FacetEngine.open(directory: root, secrets: keys)
        let profile = try await engine.registerReplica(id: UUID().uuidString, name: "Replica")
        let first = Data(repeating: 0x31, count: 1_048_576)
        let second = Data(repeating: 0x62, count: 37)
        let bytes = first + second
        let revision = AppleVaultFiles.revision(bytes)
        let payloadID = "draft:" + UUID().uuidString
        let core = await engine.engine
        let handle = try core.beginPayload(
            profileId: profile.id, payloadId: payloadID, size: UInt64(bytes.count),
            revision: revision)
        _ = try handle.writeChunk(offset: 0, bytes: first)
        try await engine.close()
        handle.closeHandle()
        #expect(throws: FacetEngineError.self) { try handle.readChunk(offset: 0, length: 1) }

        let reopened = try await FacetEngine.open(directory: root, secrets: keys)
        let resumedCore = await reopened.engine
        let resumed = try resumedCore.beginPayload(
            profileId: profile.id, payloadId: payloadID, size: UInt64(bytes.count),
            revision: revision)
        let progress = try FacetJSON.parse(Data(resumed.infoJson().utf8))
        #expect(progress.object?.fields["written"] == .integer(Int64(first.count)))
        _ = try resumed.writeChunk(offset: UInt64(first.count), bytes: second)
        let sealed = try resumed.seal()
        try FacetSchema.bundled().validate(json: sealed, definition: "payloadInfo")
        #expect(try resumed.readChunk(offset: 1_048_576, length: 37) == second)
        resumed.closeHandle()
        try await reopened.close()
    }

    @Test func lateReaderRegistrationClosesHandleAndRetiredLeaseCannotRead() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { NativeTestFiles.remove(root) }
        let engine = try await FacetEngine.open(directory: root, secrets: StageTestKeys())
        let profile = try await engine.registerReplica(id: UUID().uuidString, name: "Replica")
        let bytes = Data("bounded reader".utf8)
        let revision = AppleVaultFiles.revision(bytes)
        let core = await engine.engine
        let handle = try core.beginPayload(
            profileId: profile.id, payloadId: "draft:" + UUID().uuidString,
            size: UInt64(bytes.count), revision: revision)
        _ = try handle.writeChunk(offset: 0, bytes: bytes)
        _ = try handle.seal()
        let reader = try FacetBoundedPayloadReader(
            payload: handle,
            expected: FacetVersionMetadata(size: UInt64(bytes.count), revision: revision),
            schema: FacetSchema.bundled())
        let registry = FacetPayloadReaders()
        let old = try await registry.owner(profileID: profile.id)
        await registry.closeProfile(profile.id)
        await #expect(throws: FacetSyncError.self) {
            try await registry.register(reader, owner: old)
        }
        #expect(await reader.isClosed())
        handle.closeHandle()
        try await engine.close()
    }

    @Test func boundedLocalMutationReplaysAfterReopenWithoutDuplicateTask() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let vault = root.appendingPathComponent("vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let keys = StageTestKeys()
        let directory = root.appendingPathComponent("engine")
        let engine = try await FacetEngine.open(directory: directory, secrets: keys)
        let profile = try await engine.registerLocal(directory: vault, approveStandard: true)
        _ = try await engine.refresh(profileID: profile.id)
        let mutationID = UUID().uuidString
        try await engine.execute(
            profileID: profile.id,
            command: .object([
                "kind": .string("create"),
                "properties": .object(["title": .string("Bounded durable task")]),
            ]), mutationID: mutationID)
        try await engine.close()
        let reopened = try await FacetEngine.open(directory: directory, secrets: keys)
        try await reopened.retryMutation(id: mutationID)
        let snapshot = try await reopened.snapshot(profileID: profile.id, query: .object([:]))
        #expect(snapshot.tasks.count == 1)
        #expect(snapshot.tasks.first?.title == "Bounded durable task")
        try await reopened.discardObservedMutation(id: mutationID)
        #expect(try await reopened.pendingMutations().isEmpty)
        try await reopened.close()
    }
}
