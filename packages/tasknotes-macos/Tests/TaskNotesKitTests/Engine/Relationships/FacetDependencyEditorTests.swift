import Foundation
import Testing

@testable import TaskNotesKit

@Suite("Authoritative dependency editor contract")
struct FacetDependencyEditorTests {
    @Test func allThirteenNeutralCasesUseTheSharedSchema() throws {
        let schema = try FacetSchema.bundled()
        var packages = URL(filePath: #filePath)
        for _ in 0..<6 { packages.deleteLastPathComponent() }
        let corpus = try FacetJSON.parse(
            Data(
                contentsOf: packages.appendingPathComponent(
                    "tasknotes-fixtures/vault/facet-dependency-editor-contract.json")))
        let cases = try #require(corpus.object?.fields["cases"]?.array?.elements)
        #expect(cases.count == 13)
        var identifiers: Set<String> = []
        for item in cases {
            let fields = try #require(item.object?.fields)
            let identifier = try #require(fields["id"]?.text)
            let definition = try #require(fields["definition"]?.text)
            let value = try #require(fields["value"])
            #expect(identifiers.insert(identifier).inserted)
            if fields["valid"] == .bool(true) {
                try schema.validate(value, definition: definition)
                if definition == "dependencyEditor" {
                    let metadata = try FacetFeatureProjection.decode(
                        FacetDependencyEditor.self, from: value)
                    #expect(metadata.schemaVersion == 1)
                    #expect(
                        metadata.relationshipTypes.map(\.rawValue)
                            == value.object?.fields["relationshipTypes"]?.array?.elements
                            .compactMap(\.text))
                    #expect(
                        metadata.defaultReltype?.rawValue
                            == value.object?.fields["defaultReltype"]?.text)
                }
            } else {
                #expect(throws: FacetContractError.self, Comment(rawValue: identifier)) {
                    try schema.validate(value, definition: definition)
                }
            }
        }
    }

    @Test(arguments: [nil, "STARTTOSTART"] as [String?])
    func realMetadataAndMutationPreserveExplicitDefaultsAndExtensions(defaultReltype: String?)
        async throws
    {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let vault = root.appendingPathComponent("vault")
        let note = try seed(vault, defaultReltype: defaultReltype)
        let before = try Data(contentsOf: note)
        let engine = try await FacetEngine.open(
            directory: root.appendingPathComponent("engine"), secrets: StageTestKeys())
        do {
            let profile = try await engine.registerLocal(directory: vault, approveStandard: true)
            _ = try await engine.refresh(profileID: profile.id)
            let response = try await engine.features(
                profileID: profile.id,
                request: .object([
                    "schemaVersion": .integer(1), "kind": .string("dependency_editor"),
                ]))
            let metadata = try FacetFeatureProjection.decode(
                FacetDependencyEditor.self, from: response)
            #expect(metadata.defaultReltype?.rawValue == defaultReltype)
            #expect(try Data(contentsOf: note) == before)
            let original = try #require(
                await engine.snapshot(profileID: profile.id, query: .object([:])).tasks.first)
            let existing = try #require(original.properties["blockedBy"]?.array?.elements)
            var added = try #require(metadata.newDependency.object?.fields)
            #expect(added["reltype"] == .string(defaultReltype ?? ""))
            added["uid"] = .string("Tasks/Second.md")
            if defaultReltype == nil { added["reltype"] = .string("STARTTOFINISH") }
            added["gap"] = .string("-PT15M")
            added["vendorNew"] = .array([.bool(false), .integer(7)])
            let dependencies = FacetValue.array(existing + [.object(added)])
            try await engine.execute(
                profileID: profile.id,
                command: .object([
                    "kind": .string("edit_task"), "path": .string(original.path),
                    "expectedRevision": .string(original.revision),
                    "properties": .object(["blockedBy": dependencies]),
                ]))
            let updated = try #require(
                await engine.snapshot(profileID: profile.id, query: .object([:])).tasks.first)
            #expect(updated.properties["blockedBy"] == dependencies)
            #expect(updated.properties["vendorNote"] == original.properties["vendorNote"])
            #expect(updated.body == original.body)
            try await engine.close()
        } catch {
            let failure = error
            try await engine.close()
            throw failure
        }
    }

    private func seed(_ vault: URL, defaultReltype: String?) throws -> URL {
        let tasks = vault.appendingPathComponent("Tasks")
        try FileManager.default.createDirectory(at: tasks, withIntermediateDirectories: true)
        var configuration =
            "title:\n  storage: frontmatter\ntask_detection:\n  method: tag\n  tag: task\n"
        if let defaultReltype {
            configuration += "dependencies:\n  default_reltype: \(defaultReltype)\n"
        }
        try Data(configuration.utf8).write(to: vault.appendingPathComponent("tasknotes.yaml"))
        let note = tasks.appendingPathComponent("Dependent.md")
        let source = """
            ---
            title: Dependent
            status: open
            priority: normal
            tags: [task]
            dateCreated: '2026-10-25T12:00:00Z'
            dateModified: '2026-10-25T12:00:00Z'
            vendorNote: { exact: 'keep: punctuation' }
            blockedBy:
              - uid: '[[Tasks/Target.md|Alias]]'
                reltype: FINISHTOSTART
                gap: P1D
                vendorExisting: { enabled: false, values: [1, 'keep'] }
            ---
            Preserve **Markdown** and [[Reference]].

            """
        try Data(source.utf8).write(to: note)
        return note
    }
}
