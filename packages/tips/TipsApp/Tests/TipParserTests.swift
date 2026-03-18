import XCTest

@testable import TipsApp

final class TipParserTests: XCTestCase {

    let singleTipMarkdown = """
        ---
        app: Test App
        icon: star
        color: "#FF0000"
        website: https://example.com
        category: Shortcuts
        ---

        - `⌘K` — Do something
        """

    let plainTipMarkdown = """
        ---
        app: Test App
        icon: star
        color: "#FF0000"
        website: https://example.com
        category: Features
        ---

        - A cool feature
        """

    func testParsesSingleTipFrontmatter() throws {
        let parsed = try TipParser.parseSingleTip(content: singleTipMarkdown)

        XCTAssertEqual(parsed.metadata.app, "Test App")
        XCTAssertEqual(parsed.metadata.icon, "star")
        XCTAssertEqual(parsed.metadata.category, "Shortcuts")
        XCTAssertEqual(parsed.metadata.website, "https://example.com")
    }

    func testParsesSingleTipShortcut() throws {
        let parsed = try TipParser.parseSingleTip(content: singleTipMarkdown)

        XCTAssertEqual(parsed.item.shortcut, "⌘K")
        XCTAssertEqual(parsed.item.text, "Do something")
    }

    func testParsesSingleTipPlainItem() throws {
        let parsed = try TipParser.parseSingleTip(content: plainTipMarkdown)

        XCTAssertNil(parsed.item.shortcut)
        XCTAssertEqual(parsed.item.text, "A cool feature")
    }

    func testThrowsOnMissingFrontmatter() {
        let badContent = "No frontmatter here"
        XCTAssertThrowsError(try TipParser.parseSingleTip(content: badContent))
    }

    func testHandlesMissingOptionals() throws {
        let minimal = """
            ---
            app: Minimal
            icon: circle
            ---

            - Just a tip
            """

        let parsed = try TipParser.parseSingleTip(content: minimal)

        XCTAssertEqual(parsed.metadata.app, "Minimal")
        XCTAssertNil(parsed.metadata.website)
        XCTAssertNil(parsed.metadata.category)
        XCTAssertEqual(parsed.item.text, "Just a tip")
    }

    func testLoadAllGroupsTipsByApp() throws {
        let temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)

        try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: temporaryDirectory)
        }

        // Write two tips for the same app in different categories
        let tip1 = temporaryDirectory.appendingPathComponent("tip1.md")
        try singleTipMarkdown.write(to: tip1, atomically: true, encoding: .utf8)

        let tip2 = temporaryDirectory.appendingPathComponent("tip2.md")
        try plainTipMarkdown.write(to: tip2, atomically: true, encoding: .utf8)

        // Write a non-markdown file that should be ignored
        let textFile = temporaryDirectory.appendingPathComponent("ignore.txt")
        try "ignore me".write(to: textFile, atomically: true, encoding: .utf8)

        let apps = try TipParser.loadAll(from: temporaryDirectory)

        XCTAssertEqual(apps.count, 1)
        XCTAssertEqual(apps.first?.name, "Test App")
        XCTAssertEqual(apps.first?.sections.count, 2)
        let headings = Set(apps.first?.sections.map(\.heading) ?? [])
        XCTAssert(headings.contains("Shortcuts"))
        XCTAssert(headings.contains("Features"))
    }

    func testLoadsBundledContentDirectoryFromSourceTree() throws {
        let contentDirectory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Resources/content", isDirectory: true)

        let apps = try TipParser.loadAll(from: contentDirectory)

        XCTAssertEqual(apps.count, 46)
        XCTAssert(apps.map(\.name).contains("Finder"))
        XCTAssert(apps.map(\.name).contains("Safari"))
        XCTAssert(apps.map(\.name).contains("Xcode"))

        // Verify sections are grouped correctly
        if let finder = apps.first(where: { $0.name == "Finder" }) {
            XCTAssertGreaterThan(finder.sections.count, 0)
            XCTAssertGreaterThan(finder.sections.flatMap(\.items).count, 10)
        }
    }
}
