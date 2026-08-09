import Testing

import struct Foundation.AttributedString

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

/// The note body's parse.
///
/// Nothing here tests markdown *syntax* — that is Foundation's cmark-gfm and
/// testing it would be testing Apple. What is tested is the reshaping:
/// Foundation reports block structure as a flat run list with a
/// `presentationIntent` per run, and turning that back into blocks a view can
/// lay out is the part that can be wrong.
@Suite("Markdown body")
struct MarkdownBodyTests {
    @Test("an empty body has no blocks", arguments: ["", "   ", "\n\n\t"])
    func emptyBody(source: String) throws {
        #expect(try MarkdownBody.of(source: source).isEmpty)
    }

    @Test("a heading keeps its level")
    func headingLevel() throws {
        let body = try MarkdownBody.of(source: "# One\n\n### Three\n")
        #expect(kinds(body) == [.heading(level: 1), .heading(level: 3)])
        #expect(plain(body) == ["One", "Three"])
    }

    /// Two paragraphs must stay two paragraphs.
    ///
    /// The subtle one. Foundation strips the blank line, so the *only* thing
    /// separating adjacent paragraphs is the `identity` inside their
    /// `PresentationIntent`. Grouping on the intent's kind instead of on the
    /// whole intent would glue every paragraph in a note into one — which is a
    /// mistake that reads as "the renderer lost the line breaks".
    @Test("adjacent paragraphs do not merge")
    func paragraphsDoNotMerge() throws {
        let body = try MarkdownBody.of(source: "First one.\n\nSecond one.\n")
        #expect(kinds(body) == [.paragraph, .paragraph])
        #expect(plain(body) == ["First one.", "Second one."])
    }

    @Test("a bullet list becomes one block per item")
    func bulletList() throws {
        let body = try MarkdownBody.of(source: "- alpha\n- beta\n")
        #expect(kinds(body) == [.bullet(depth: 0), .bullet(depth: 0)])
        #expect(plain(body) == ["alpha", "beta"])
    }

    @Test("an ordered list keeps its ordinals")
    func orderedList() throws {
        let body = try MarkdownBody.of(source: "1. alpha\n2. beta\n")
        #expect(
            kinds(body) == [.numbered(depth: 0, ordinal: 1), .numbered(depth: 0, ordinal: 2)]
        )
    }

    /// Nesting arrives as a depth, which is all a read-only renderer needs.
    @Test("a nested list is one level deeper")
    func nestedList() throws {
        let body = try MarkdownBody.of(source: "- outer\n    - inner\n")
        #expect(kinds(body) == [.bullet(depth: 0), .bullet(depth: 1)])
    }

    /// ⚠️ A bullet list is not an ordered list with the numbers hidden.
    ///
    /// Foundation numbers the items of a bullet list too — `- alpha` arrives as
    /// `paragraph | listItem 1 | unorderedList` — so a reshaping that decides
    /// "ordered" from the *presence of an ordinal* renders every bullet list as
    /// "1. 2. 3.". That is exactly what the first version of this parser did,
    /// and this pair of assertions is what found it. Orderedness comes from the
    /// list container and nowhere else.
    @Test("a bullet inside an ordered list is still a bullet")
    func orderednessComesFromTheContainer() throws {
        let body = try MarkdownBody.of(source: "1. outer\n    - inner\n")
        #expect(
            kinds(body) == [.numbered(depth: 0, ordinal: 1), .bullet(depth: 1)]
        )
    }

    @Test("a number inside a bullet list is still numbered")
    func numberedInsideBullet() throws {
        let body = try MarkdownBody.of(source: "- outer\n    1. inner\n")
        #expect(
            kinds(body) == [.bullet(depth: 0), .numbered(depth: 1, ordinal: 1)]
        )
    }

    /// A fenced block keeps its language hint and loses its trailing newline.
    ///
    /// Foundation hands the block back with the terminating newline attached,
    /// and a code view that keeps it draws a blank last line inside the box.
    @Test("a fenced code block keeps its language and drops its trailing newline")
    func codeBlock() throws {
        let body = try MarkdownBody.of(source: "```swift\nlet x = 1\n```\n")
        #expect(kinds(body) == [.code(language: "swift")])
        #expect(plain(body) == ["let x = 1"])
    }

    @Test("an unlabelled fence has no language")
    func codeBlockWithoutLanguage() throws {
        let body = try MarkdownBody.of(source: "```\nplain\n```\n")
        #expect(kinds(body) == [.code(language: nil)])
    }

    @Test("a block quote becomes a quote block")
    func blockQuote() throws {
        let body = try MarkdownBody.of(source: "> quoted\n")
        #expect(kinds(body) == [.quote(depth: 0)])
    }

    @Test("a thematic break becomes a rule")
    func thematicBreak() throws {
        let body = try MarkdownBody.of(source: "before\n\n---\n\nafter\n")
        #expect(kinds(body) == [.paragraph, .rule, .paragraph])
    }

    /// A table's cells are merged back into rows.
    ///
    /// Every cell arrives as its own run with its own column index, so without
    /// the merge a table renders as a column of stray words.
    @Test("a table becomes one block per row, with its cells together")
    func table() throws {
        let body = try MarkdownBody.of(
            source: "| a | b |\n| - | - |\n| 1 | 2 |\n")
        #expect(kinds(body) == [.tableRow(isHeader: true), .tableRow(isHeader: false)])
        #expect(body.blocks.map { $0.content.count } == [2, 2])
        #expect(body.blocks.first?.content.map { String($0.characters) } == ["a", "b"])
    }

    /// Inline styling survives into the block's text.
    ///
    /// It has to: `Text` is what renders emphasis, strong and strikethrough, and
    /// it reads them off the `AttributedString` this parse produces. A reshaping
    /// that flattened the runs would silently render every note as plain prose.
    @Test("inline styling survives the reshaping")
    func inlineStyling() throws {
        let body = try MarkdownBody.of(source: "plain *emphasis* **strong** `code`\n")
        let text = try #require(body.blocks.first?.text)
        let intents = text.runs.compactMap { $0.inlinePresentationIntent }
        #expect(intents.contains(.emphasized))
        #expect(intents.contains(.stronglyEmphasized))
        #expect(intents.contains(.code))
    }

    @Test("a link keeps its destination")
    func link() throws {
        let body = try MarkdownBody.of(source: "see [the site](https://example.com)\n")
        let text = try #require(body.blocks.first?.text)
        #expect(text.runs.contains { $0.link?.absoluteString == "https://example.com" })
    }

    /// Block ids are positions, and positions are unique.
    ///
    /// `ForEach` needs them to be: duplicated ids make SwiftUI reuse one view
    /// for two blocks, which draws the same paragraph twice.
    @Test("every block has a distinct id")
    func distinctIds() throws {
        let body = try MarkdownBody.of(source: "# H\n\none\n\ntwo\n\n- a\n- b\n")
        #expect(Set(body.blocks.map(\.id)).count == body.blocks.count)
    }

    private func kinds(_ body: MarkdownBody) -> [MarkdownBlock.Kind] {
        body.blocks.map(\.kind)
    }

    private func plain(_ body: MarkdownBody) -> [String] {
        body.blocks.map { String($0.text.characters) }
    }
}
