import Foundation
import TaskNotesUniFFI
import Testing

@testable import TaskNotesKit

struct FacetEditorEngineTests {
    @Test func filenameTitleEditUsesAuthoritativeNewIdentityForTheNextEdit() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let vault = try configuredVault(root, filenameTitles: true)
        let engine = try await FacetEngine.open(directory: root.appendingPathComponent("engine"))
        let profile = try await engine.registerLocal(directory: vault, approveStandard: false)
        _ = try await engine.refresh(profileID: profile.id)
        try await engine.execute(
            profileID: profile.id,
            command: .object([
                "kind": .string("create"),
                "properties": .object(["title": .string("Original title")]),
            ]))
        let original = try #require(
            await engine.snapshot(profileID: profile.id, query: .object([:])).tasks.first)
        try await engine.execute(
            profileID: profile.id,
            command: .object([
                "kind": .string("edit_task"), "path": .string(original.path),
                "expectedRevision": .string(original.revision),
                "properties": .object(["title": .string("Renamed authoritative title")]),
            ]))
        let renamed = try #require(
            await engine.snapshot(profileID: profile.id, query: .object([:])).tasks.first)
        #expect(renamed.path != original.path)
        #expect(renamed.id != original.id)
        try await engine.execute(
            profileID: profile.id,
            command: .object([
                "kind": .string("edit_task"), "path": .string(renamed.path),
                "expectedRevision": .string(renamed.revision),
                "properties": .object(["contexts": .array([.string("next edit")])]),
            ]))
        let result = try await engine.snapshot(profileID: profile.id, query: .object([:]))
        #expect(result.tasks.count == 1)
        #expect(result.tasks.first?.path == renamed.path)
        #expect(result.tasks.first?.properties["contexts"] == .array([.string("next edit")]))
    }
    @Test func completedEditorUsesOneFence() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let vault = try configuredVault(root)
        let engine = try await FacetEngine.open(directory: root.appendingPathComponent("engine"))
        let profile = try await engine.registerLocal(directory: vault, approveStandard: false)
        _ = try await engine.refresh(profileID: profile.id)
        try await engine.execute(
            profileID: profile.id,
            command: .object([
                "kind": .string("create"), "properties": .object(["title": .string("Editor task")]),
            ]))
        let editing = try #require(
            await engine.snapshot(profileID: profile.id, query: .object([:])).tasks.first)
        let id = UUID().uuidString
        try await engine.execute(
            profileID: profile.id,
            command: .object([
                "kind": .string("edit_task"), "path": .string(editing.path),
                "expectedRevision": .string(editing.revision), "status": .string("done"),
                "properties": .object(["title": .string("Edited and completed")]),
            ]), mutationID: id)
        let saved = try #require(
            await engine.snapshot(profileID: profile.id, query: .object([:])).tasks.first)
        #expect(saved.completed)
        #expect(saved.title == "Edited and completed")
        #expect(saved.properties["completedDate"]?.text != nil)
        let undo = try await engine.features(
            profileID: profile.id,
            request: .object([
                "kind": .string("undo_available")
            ]))
        #expect(undo.object?.fields["receiptId"] == .string(id))
        try await engine.retryMutation(id: id)
        #expect(
            try await engine.snapshot(profileID: profile.id, query: .object([:])).tasks.count == 1)
    }

    @Test func incompleteNotePreservesBytesUntilExplicitKnownCreationDateRepair() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let vault = try configuredVault(root)
        let note = vault.appendingPathComponent("Incomplete.md")
        let original = Data(
            "---\ntitle: Incomplete\nstatus: open\ntags: [task]\nvendor: retained\n---\nOriginal body\n"
                .utf8)
        try original.write(to: note)
        let engine = try await FacetEngine.open(directory: root.appendingPathComponent("engine"))
        let profile = try await engine.registerLocal(directory: vault, approveStandard: false)
        let before = try #require(await engine.refresh(profileID: profile.id).tasks.first)
        let rejected = UUID().uuidString
        do {
            try await engine.execute(
                profileID: profile.id,
                command: .object([
                    "kind": .string("edit_task"), "path": .string(before.path),
                    "expectedRevision": .string(before.revision),
                    "properties": .object(["contexts": .array([.string("home")])]),
                ]), mutationID: rejected)
            Issue.record("Incomplete note should require an explicit metadata correction.")
        } catch let failure as FacetEngineError {
            guard case .Validation = failure else { throw failure }
        }
        #expect(try Data(contentsOf: note) == original)
        #expect(
            try await engine.pendingMutations(profileID: profile.id).contains { $0.id == rejected })
        try await engine.execute(
            profileID: profile.id,
            command: .object([
                "kind": .string("edit_task"), "path": .string(before.path),
                "expectedRevision": .string(before.revision),
                "properties": .object([
                    "dateCreated": .string("2025-01-02T08:00:00Z"),
                    "contexts": .array([.string("home")]),
                ]),
            ]))
        let saved = try #require(
            await engine.snapshot(profileID: profile.id, query: .object([:])).tasks.first)
        #expect(saved.properties["dateCreated"] == .string("2025-01-02T08:00:00Z"))
        #expect(saved.body.contains("Original body"))
        #expect(try String(contentsOf: note, encoding: .utf8).contains("vendor: retained"))
    }

    private func configuredVault(_ root: URL, filenameTitles: Bool = false) throws -> URL {
        let vault = root.appendingPathComponent("vault")
        let settings = vault.appendingPathComponent(".obsidian/plugins/tasknotes")
        try FileManager.default.createDirectory(at: settings, withIntermediateDirectories: true)
        try JSONEncoder().encode([
            "storeTitleInFilename": filenameTitles
        ])
        .write(to: settings.appendingPathComponent("data.json"))
        return vault
    }
}
