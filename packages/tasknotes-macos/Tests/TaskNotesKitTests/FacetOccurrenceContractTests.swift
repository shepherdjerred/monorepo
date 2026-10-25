import Foundation
import Testing

@testable import TaskNotesKit

struct FacetOccurrenceContractTests {
    @Test func everySharedOccurrenceShapeAndTypedProjectionIsAccountedFor() throws {
        let schema = try FacetSchema.bundled()
        let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let corpus = try FacetJSON.parse(
            Data(
                contentsOf: source.appendingPathComponent(
                    "tasknotes-fixtures/vault/facet-occurrence-contract.json")))
        let fields = try #require(corpus.object?.fields)
        #expect(Set(fields.keys) == ["schemaVersion", "definitions", "cases"])
        #expect(fields["schemaVersion"] == .integer(1))
        let definitions: Set<String> = [
            "featureRequest", "command", "occurrenceSuccessors", "rollingMaintenancePlan",
            "generationFailuresPlan",
        ]
        let declared = try #require(fields["definitions"]?.array?.elements)
        #expect(Set(declared.compactMap(\.text)) == definitions)
        let cases = try #require(fields["cases"]?.array?.elements)
        #expect(cases.count == 117)
        var ids: Set<String> = []
        var coverage: Set<String> = []
        for value in cases {
            let item = try #require(value.object?.fields)
            #expect(Set(item.keys) == ["id", "definition", "valid", "value"])
            let id = try #require(item["id"]?.text)
            let definition = try #require(item["definition"]?.text)
            #expect(definitions.contains(definition), Comment(rawValue: id))
            #expect(ids.insert(id).inserted, Comment(rawValue: id))
            let fixture = try #require(item["value"])
            let valid = item["valid"] == .bool(true)
            #expect(item["valid"] == .bool(valid))
            var accepted = false
            do {
                try schema.validate(fixture, definition: definition)
                accepted = true
            } catch {}
            #expect(accepted == valid, Comment(rawValue: id))
            coverage.insert(definition + (valid ? ":valid" : ":invalid"))
            if valid { try decodeProjection(fixture, definition: definition) }
        }
        #expect(ids.count == cases.count)
        for definition in definitions {
            #expect(coverage.contains(definition + ":valid"))
            #expect(coverage.contains(definition + ":invalid"))
        }
    }

    private func decodeProjection(_ value: FacetValue, definition: String) throws {
        if definition == "occurrenceSuccessors" {
            _ = try FacetFeatureProjection.decode(FacetOccurrenceSuccessors.self, from: value)
        } else if definition == "rollingMaintenancePlan" {
            _ = try FacetFeatureProjection.decode(FacetRollingMaintenancePlan.self, from: value)
        } else if definition == "generationFailuresPlan" {
            _ = try FacetFeatureProjection.decode(FacetGenerationFailuresPlan.self, from: value)
        } else {
            #expect(["command", "featureRequest"].contains(definition))
        }
    }
}
