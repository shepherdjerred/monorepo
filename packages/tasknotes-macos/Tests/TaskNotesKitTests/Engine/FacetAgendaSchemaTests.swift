import Foundation
import Testing

@testable import TaskNotesKit

@Suite("Shared agenda query and row contract")
struct FacetAgendaSchemaTests {
    @Test func positiveAndNegativeAgendaCorpus() throws {
        let schema = try FacetSchema.bundled()
        let packages = URL(filePath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let corpus = try FacetJSON.parse(
            Data(
                contentsOf: packages.appending(
                    path: "tasknotes-fixtures/vault/facet-agenda-contract.json")))
        let cases = try #require(corpus.object?.fields["cases"]?.array?.elements)
        #expect(cases.count == 22)
        var identifiers: Set<String> = []
        var definitions: Set<String> = []
        for item in cases {
            let fields = try #require(item.object?.fields)
            let identifier = try #require(fields["id"]?.text)
            let definition = try #require(fields["definition"]?.text)
            let value = try #require(fields["value"])
            let expected = fields["valid"] == .bool(true)
            #expect(identifiers.insert(identifier).inserted)
            definitions.insert(definition)
            var accepted = false
            do {
                try schema.validate(value, definition: definition)
                accepted = true
            } catch {}
            #expect(accepted == expected, Comment(rawValue: identifier))
            if accepted && definition == "task" {
                let data = Data(try FacetJSON.encode(value).utf8)
                _ = try JSONDecoder().decode(FacetTask.self, from: data)
            }
        }
        #expect(definitions == ["query", "task"])
    }
}
