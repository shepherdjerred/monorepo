import Foundation
import TaskNotesKit
import Testing

@Suite("Rust-backed Markdown document projection")
struct FacetMarkdownDocumentTests {
    @Test(arguments: [
        "title: Exact title\nstatus: done",
        "title: 'Exact title'\nstatus: 'done'",
        "title: \"Exact title\"\nstatus: \"done\"",
        "title: \"Exact \\u0074itle\"\nstatus: \"d\\u006fne\"",
        "title: |-\n  Exact title\nstatus: >-\n  done",
    ])
    func scalarRepresentationDoesNotChangeIdentityOrStatus(_ properties: String) throws {
        let document = try parse("---\n\(properties)\n---\nPreserved body.\n")
        #expect(document.properties["title"] == .string("Exact title"))
        #expect(document.properties["status"] == .string("done"))
        #expect(document.body == "Preserved body.\n")
    }

    @Test func escapedTitleAndCRLFBOMKeepExactValues() throws {
        let document = try parse(
            "\u{feff}---\r\ntitle: 'Jerred''s \"task\"'\r\nstatus: \"open\"\r\n---\r\nBody.\r\n")
        #expect(document.properties["title"] == .string("Jerred's \"task\""))
        #expect(document.properties["status"] == .string("open"))
        #expect(document.body == "Body.\r\n")
    }

    @Test func bodyCannotSupplyOrOverrideFrontmatterIdentity() throws {
        let bodyOnly = try parse("title: Exact title\nstatus: done\n")
        #expect(bodyOnly.properties["title"] == nil)
        #expect(bodyOnly.properties["status"] == nil)
        let spoof = try parse(
            "---\ntitle: Other title\nstatus: open\n---\ntitle: Exact title\nstatus: done\n")
        #expect(spoof.properties["title"] == .string("Other title"))
        #expect(spoof.properties["status"] == .string("open"))
    }

    @Test(arguments: [
        "---\ntitle: A\ntitle: B\n---\n",
        "---\ntitle: A\nstatus: open\nstatus: done\n---\n",
        "---\ntitle: [broken\n---\n",
        "---\ntitle: Missing delimiter\n",
        "---\n- title\n- status\n---\n",
    ])
    func malformedFrontmatterFails(_ source: String) {
        #expect(throws: (any Error).self) { try parse(source) }
    }

    @Test func nonStringPropertiesStayTypedAndCannotMatchExpectedStrings() throws {
        let document = try parse("---\ntitle: 42\nstatus: [done]\n---\n")
        #expect(document.properties["title"] != .string("42"))
        #expect(document.properties["status"] != .string("done"))
    }

    @Test func invalidEncodingAndUnsafeLogicalPathFail() {
        #expect(throws: (any Error).self) {
            try FacetMarkdownDocument(path: "Tasks/Task.md", bytes: Data([0xFF]))
        }
        #expect(throws: (any Error).self) {
            try FacetMarkdownDocument(path: "../Task.md", bytes: Data("---\ntitle: A\n---\n".utf8))
        }
    }

    private func parse(_ source: String) throws -> FacetMarkdownDocument {
        try FacetMarkdownDocument(path: "Tasks/Task.md", bytes: Data(source.utf8))
    }
}
