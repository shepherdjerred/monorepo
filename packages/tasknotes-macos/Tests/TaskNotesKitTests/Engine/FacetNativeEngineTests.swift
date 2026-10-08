import Foundation
import Testing

@testable import TaskNotesKit

struct FacetNativeEngineTests {
    @Test func removedSavedActionCannotResumeAndRetiresOnlyAfterOutcomeCheck() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let vault = root.appendingPathComponent("vault")
        let engineDirectory = root.appendingPathComponent("engine")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        defer { NativeTestFiles.remove(root) }
        let engine = try await FacetEngine.open(directory: engineDirectory)
        let profile = try await engine.registerLocal(directory: vault, approveStandard: true)
        let id = UUID().uuidString
        let draftsDirectory = engineDirectory.appendingPathComponent("action-drafts")
        let drafts = try FacetMutationDrafts(directory: draftsDirectory)
        _ = try drafts.envelope(
            profileID: profile.id, id: id,
            command: .object(["kind": .string("stop_time"), "path": .string("Tasks/old.md")]),
            at: "2026-10-03T12:00:00Z")
        let path = draftsDirectory.appendingPathComponent(id + ".json")
        let original = try Data(contentsOf: path)
        let pending = try #require(await engine.pendingMutations().first)
        #expect(!pending.canResume)
        await #expect(throws: FacetDraftError.retiredFeature) {
            try await engine.retryMutation(id: id)
        }
        #expect(try Data(contentsOf: path) == original)
        try await engine.retireSavedMutation(id: id)
        #expect(try await engine.pendingMutations().isEmpty)
        #expect(try await engine.snapshot(profileID: profile.id, query: .object([:])).tasks.isEmpty)
        try await engine.close()
    }

    @Test func nativeViewsAndPartialBatchKeepAppliedWork() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let vault = root.appendingPathComponent("vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        defer { NativeTestFiles.remove(root) }
        let engine = try await FacetEngine.open(directory: root.appendingPathComponent("engine"))
        let profile = try await engine.registerLocal(directory: vault, approveStandard: true)
        _ = try await engine.refresh(profileID: profile.id)
        try await engine.execute(
            profileID: profile.id,
            command: .object([
                "kind": .string("create"),
                "properties": .object(["title": .string("Native task")]),
            ]))
        let task = try #require(
            await engine.snapshot(profileID: profile.id, query: .object([:])).tasks.first)
        try await engine.execute(
            profileID: profile.id,
            command: .object([
                "kind": .string("save_view"), "id": .string("native-view"),
                "view": .object([
                    "name": .string("Native work"), "query": .object(["scope": .string("all")]),
                ]),
            ]))
        let mutationID = UUID().uuidString
        try await engine.execute(
            profileID: profile.id,
            command: .object([
                "kind": .string("batch_partial"),
                "commands": .array([
                    .object([
                        "kind": .string("update"), "path": .string(task.path),
                        "properties": .object(["contexts": .array([.string("saved")])]),
                    ]),
                    .object(["kind": .string("delete"), "path": .string("missing.md")]),
                ]),
            ]), mutationID: mutationID)
        let outcome = try await engine.features(
            profileID: profile.id,
            request: .object([
                "kind": .string("batch_outcome"), "mutationId": .string(mutationID),
            ]))
        #expect(outcome.object?.fields["succeeded"] == .integer(1))
        #expect(outcome.object?.fields["failed"] == .integer(1))
        let snapshot = try await engine.snapshot(profileID: profile.id, query: .object([:]))
        #expect(snapshot.views.first?.view["name"] == .string("Native work"))
        #expect(snapshot.tasks.first?.properties["contexts"] == .array([.string("saved")]))
    }

    @Test func standaloneCaptureReceiptReplayAndFeaturesValidate() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let vault = root.appendingPathComponent("vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        defer { NativeTestFiles.remove(root) }
        let profile = try await saveUnobservedAction(root: root, vault: vault)
        let reopened = try await FacetEngine.open(directory: root.appendingPathComponent("engine"))
        let discovered = try #require(await reopened.pendingMutations().first)
        #expect(discovered.profileID == profile.id)
        try await reopened.retryMutation(id: discovered.id)
        let result = try await reopened.snapshot(
            profileID: profile.id, query: .object(["limit": .integer(100)]))
        #expect(result.tasks.count == 1)
        #expect(result.tasks.first?.title == "Capture from native Swift")
        let discovery = try await reopened.features(
            profileID: profile.id, request: .object(["kind": .string("discovery")]))
        #expect(discovery.object?.fields["configurationAvailable"] == .bool(true))
    }

    private func saveUnobservedAction(root: URL, vault: URL) async throws -> FacetProfile {
        let engine = try await FacetEngine.open(directory: root.appendingPathComponent("engine"))
        let profile = try await engine.registerLocal(directory: vault, approveStandard: true)
        _ = try await engine.refresh(profileID: profile.id)
        let command = FacetValue.object([
            "kind": .string("create"),
            "properties": .object(["title": .string("Capture from native Swift")]),
        ])
        let mutationID = UUID().uuidString
        try await engine.execute(profileID: profile.id, command: command, mutationID: mutationID)
        // Simulate a saved receipt whose response was lost before the host cleared its draft.
        return profile
    }
}
