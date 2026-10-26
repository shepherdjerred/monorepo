import Foundation
import Testing

@testable import TaskNotesKit

struct FacetGenerationFailureMembershipTests {
    @Test func concreteFailureUsesCurrentSourcesAndRetainsExactRepair() throws {
        let failure = try decode(
            parent: "Tasks/A.md", historicalChild: nil,
            sources: .current(["Tasks/A-renamed-child.md", "Tasks/A-second-child.md"]))
        #expect(failure.applies(toTaskPath: "Tasks/A.md"))
        #expect(failure.applies(toTaskPath: "Tasks/A-renamed-child.md"))
        #expect(failure.applies(toTaskPath: "Tasks/A-second-child.md"))
        #expect(!failure.applies(toTaskPath: "Tasks/A-deleted-child.md"))
        #expect(!failure.applies(toTaskPath: "Tasks/B-child.md"))
        #expect(failure.action.command == command(parent: "Tasks/A.md"))
    }

    @Test func explicitEmptySourcesExcludeHistoricalChildButKeepParent() throws {
        let failure = try decode(
            parent: "Tasks/A.md", historicalChild: "Tasks/deleted-child.md", sources: .current([]))
        #expect(failure.sourceTaskPaths == .current([]))
        #expect(failure.applies(toTaskPath: "Tasks/A.md"))
        #expect(!failure.applies(toTaskPath: "Tasks/deleted-child.md"))
    }

    @Test func authoritativeRenameNeverAlsoMatchesHistoricalPath() throws {
        let failure = try decode(
            parent: "Tasks/A.md", historicalChild: "Tasks/old-child.md",
            sources: .current(["Tasks/new-child.md"]))
        #expect(failure.applies(toTaskPath: "Tasks/new-child.md"))
        #expect(!failure.applies(toTaskPath: "Tasks/old-child.md"))
    }

    @Test func oldSchemaPreservesExplicitHistoricalChildCompatibility() throws {
        let failure = try decode(
            parent: "Tasks/A.md", historicalChild: "Tasks/legacy-child.md", sources: .legacy)
        #expect(failure.sourceTaskPaths == .legacy)
        #expect(failure.applies(toTaskPath: "Tasks/A.md"))
        #expect(failure.applies(toTaskPath: "Tasks/legacy-child.md"))
        #expect(!failure.applies(toTaskPath: "Tasks/unrelated-child.md"))
        let concrete = try decode(parent: "Tasks/A.md", historicalChild: nil, sources: .legacy)
        #expect(!concrete.applies(toTaskPath: "Tasks/legacy-child.md"))
    }

    @Test func batchFiltersDoNotLeakAnotherSeriesOrCollapseCommands() throws {
        let failures = try [
            decode(
                parent: "Tasks/A.md", historicalChild: nil, sources: .current(["Tasks/A-child.md"])),
            decode(
                parent: "Tasks/B.md", historicalChild: nil, sources: .current(["Tasks/B-child.md"])),
            decode(
                parent: "Tasks/C.md", historicalChild: "Tasks/A-child.md", sources: .current([])),
        ]
        let selected = failures.filter { $0.applies(toTaskPath: "Tasks/A-child.md") }
        #expect(selected.count == 1)
        #expect(selected.first?.item.parentPath == "Tasks/A.md")
        #expect(selected.first?.action.command == command(parent: "Tasks/A.md"))
    }

    @Test func sharedSchemaRejectsCorruptSourceArrays() throws {
        let schema = try FacetSchema.bundled()
        for invalid in [
            FacetValue.string("Tasks/child.md"), .null,
            .array([.integer(1)]), .array([.string("")]),
        ] {
            var wrapper = fields(parent: "Tasks/A.md", historicalChild: nil)
            wrapper["sourceTaskPaths"] = invalid
            #expect(throws: (any Error).self) {
                try schema.validate(plan(wrapper), definition: "generationFailuresPlan")
            }
        }
    }

    @Test func additiveNeutralCorpusKeepsOptionalAndAuthoritativeShapesExact() throws {
        var packages = URL(filePath: #filePath)
        for _ in 0..<6 { packages.deleteLastPathComponent() }
        let corpus = try JSONDecoder().decode(
            SourceContract.self,
            from: Data(
                contentsOf: packages.appendingPathComponent(
                    "tasknotes-fixtures/vault/facet-generation-sources-contract.json")))
        #expect(corpus.schemaVersion == 1)
        #expect(corpus.definitions == ["generationFailuresPlan"])
        let expected = Set(
            [
                "legacy", "concrete-current-child", "deferred-current-child", "deleted-empty",
                "batch-multiple", "invalid-null", "invalid-string", "invalid-object",
                "invalid-entry-number", "invalid-entry-empty", "invalid-duplicate",
                "invalid-over-batch-limit",
            ].map { "generation-sources-" + $0 })
        #expect(corpus.cases.count == expected.count)
        #expect(Set(corpus.cases.map(\.id)) == expected)
        let schema = try FacetSchema.bundled()
        for entry in corpus.cases {
            #expect(entry.definition == "generationFailuresPlan")
            if entry.valid {
                try schema.validate(entry.value, definition: entry.definition)
                let plan = try FacetFeatureProjection.decode(
                    FacetGenerationFailuresPlan.self, from: entry.value)
                #expect(
                    plan.items.count == entry.value.object?.fields["items"]?.array?.elements.count)
            } else {
                #expect(throws: (any Error).self) {
                    try schema.validate(entry.value, definition: entry.definition)
                }
            }
        }
    }

    private struct SourceContract: Decodable {
        let schemaVersion: Int
        let definitions: [String]
        let cases: [SourceCase]
    }

    private struct SourceCase: Decodable {
        let id: String
        let definition: String
        let valid: Bool
        let value: FacetValue
    }

    private func decode(
        parent: String, historicalChild: String?, sources: FacetGenerationFailure.SourceTasks
    ) throws
        -> FacetGenerationFailure
    {
        var wrapper = fields(parent: parent, historicalChild: historicalChild)
        if case .current(let paths) = sources {
            wrapper["sourceTaskPaths"] = .array(paths.map(FacetValue.string))
        }
        let value = plan(wrapper)
        try FacetSchema.bundled().validate(value, definition: "generationFailuresPlan")
        return try #require(
            FacetFeatureProjection.decode(FacetGenerationFailuresPlan.self, from: value).items.first
        )
    }

    private func fields(parent: String, historicalChild: String?) -> [String: FacetValue] {
        let revision = String(repeating: "a", count: 64)
        let item: FacetValue
        if let historicalChild {
            item = .object([
                "kind": .string("deferred_progression"),
                "successorId": .string("occprogress:" + revision),
                "parentPath": .string(parent), "childPath": .string(historicalChild),
                "completedOccurrenceDate": .string("2026-10-26"),
                "childState": .string("completed"), "occurrenceDate": .null,
                "parentProjectionOwed": .bool(true), "successorDiscoveryOwed": .bool(true),
                "state": .string("failed"), "resolution": .null,
                "failure": .object(["code": .string("validation"), "message": .string("Blocked")]),
            ])
        } else {
            item = .object([
                "kind": .string("materialize_occurrence"),
                "successorId": .string("occnext:" + revision), "parentPath": .string(parent),
                "occurrenceDate": .string("2026-10-27"), "state": .string("failed"),
                "failure": .object(["code": .string("validation"), "message": .string("Blocked")]),
            ])
        }
        return [
            "primaryMutationId": .string("source-completion"), "item": item,
            "action": .object(["kind": .string("repairable"), "command": command(parent: parent)]),
        ]
    }

    private func command(parent: String) -> FacetValue {
        .object([
            "kind": .string("materialize_occurrence"), "parentPath": .string(parent),
            "expectedParentRevision": .string(String(repeating: "a", count: 64)),
            "occurrenceDate": .string("2026-10-27"), "expectedOccurrenceRevision": .null,
            "properties": .object([:]), "body": .null,
        ])
    }

    private func plan(_ wrapper: [String: FacetValue]) -> FacetValue {
        .object([
            "schemaVersion": .integer(1), "profileId": .string("vault"), "version": .integer(1),
            "inspectedCount": .integer(1), "items": .array([.object(wrapper)]), "nextCursor": .null,
        ])
    }
}
