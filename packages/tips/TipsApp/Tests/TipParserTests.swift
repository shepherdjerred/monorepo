import XCTest

@testable import TipsApp

final class TipParserTests: XCTestCase {

    let sampleMarkdown = """
        ---
        app: Test App
        icon: star
        color: "#FF0000"
        website: https://example.com
        ---

        ## Shortcuts

        - `⌘K` — Do something
        - `⌘⇧C` — Do another thing

        ## Features

        - A cool feature
        - Another cool feature
        """

    func testParsesFrontmatter() throws {
        let app = try TipParser.parse(content: sampleMarkdown)

        XCTAssertEqual(app.name, "Test App")
        XCTAssertEqual(app.icon, "star")
        XCTAssertEqual(app.id, "test-app")
        XCTAssertEqual(app.website, "https://example.com")
    }

    func testParsesSections() throws {
        let app = try TipParser.parse(content: sampleMarkdown)

        XCTAssertEqual(app.sections.count, 2)
        XCTAssertEqual(app.sections[0].heading, "Shortcuts")
        XCTAssertEqual(app.sections[1].heading, "Features")
    }

    func testParsesShortcuts() throws {
        let app = try TipParser.parse(content: sampleMarkdown)
        let shortcuts = app.sections[0]

        XCTAssertEqual(shortcuts.items.count, 2)
        XCTAssertEqual(shortcuts.items[0].shortcut, "⌘K")
        XCTAssertEqual(shortcuts.items[0].text, "Do something")
        XCTAssertEqual(shortcuts.items[1].shortcut, "⌘⇧C")
        XCTAssertEqual(shortcuts.items[1].text, "Do another thing")
    }

    func testParsesPlainItems() throws {
        let app = try TipParser.parse(content: sampleMarkdown)
        let features = app.sections[1]

        XCTAssertEqual(features.items.count, 2)
        XCTAssertNil(features.items[0].shortcut)
        XCTAssertEqual(features.items[0].text, "A cool feature")
    }

    func testThrowsOnMissingFrontmatter() {
        let badContent = "No frontmatter here"
        XCTAssertThrowsError(try TipParser.parse(content: badContent))
    }

    func testHandlesMissingOptionals() throws {
        let minimal = """
            ---
            app: Minimal
            icon: circle
            ---

            ## Tips

            - Just a tip
            """

        let app = try TipParser.parse(content: minimal)

        XCTAssertEqual(app.name, "Minimal")
        XCTAssertNil(app.website)
    }

    func testLoadsAllMarkdownFilesFromDirectory() throws {
        let temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)

        try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: temporaryDirectory)
        }

        let markdownFile = temporaryDirectory.appendingPathComponent("sample.md")
        try sampleMarkdown.write(to: markdownFile, atomically: true, encoding: .utf8)

        let textFile = temporaryDirectory.appendingPathComponent("ignore.txt")
        try "ignore me".write(to: textFile, atomically: true, encoding: .utf8)

        let apps = try TipParser.loadAll(from: temporaryDirectory)

        XCTAssertEqual(apps.count, 1)
        XCTAssertEqual(apps.first?.name, "Test App")
    }

    func testLoadsBundledContentDirectoryFromSourceTree() throws {
        let contentDirectory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Resources/content", isDirectory: true)

        let apps = try TipParser.loadAll(from: contentDirectory)

        XCTAssertEqual(apps.count, 3)
        XCTAssertEqual(apps.map(\.name), ["Finder", "Safari", "Xcode"])
    }
}
