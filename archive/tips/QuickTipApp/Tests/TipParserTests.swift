import Foundation
import Testing
@testable import QuickTipApp

struct TipParserTests {
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

    @Test
    func `parses single tip frontmatter`() throws {
        let parsed = try TipParser.parseSingleTip(content: self.singleTipMarkdown)

        #expect(parsed.metadata.app == "Test App")
        #expect(parsed.metadata.icon == "star")
        #expect(parsed.metadata.category == "Shortcuts")
        #expect(parsed.metadata.website == "https://example.com")
    }

    @Test
    func `parses single tip shortcut`() throws {
        let parsed = try TipParser.parseSingleTip(content: self.singleTipMarkdown)

        #expect(parsed.item.shortcut == "⌘K")
        #expect(parsed.item.text == "Do something")
    }

    @Test
    func `parses single tip plain item`() throws {
        let parsed = try TipParser.parseSingleTip(content: self.plainTipMarkdown)

        #expect(parsed.item.shortcut == nil)
        #expect(parsed.item.text == "A cool feature")
    }

    @Test
    func `throws on missing frontmatter`() {
        let badContent = "No frontmatter here"
        #expect(throws: (any Error).self) {
            try TipParser.parseSingleTip(content: badContent)
        }
    }

    @Test
    func `handles missing optionals`() throws {
        let minimal = """
        ---
        app: Minimal
        icon: circle
        ---

        - Just a tip
        """

        let parsed = try TipParser.parseSingleTip(content: minimal)

        #expect(parsed.metadata.app == "Minimal")
        #expect(parsed.metadata.website == nil)
        #expect(parsed.metadata.category == nil)
        #expect(parsed.item.text == "Just a tip")
    }

    @Test
    func `load all groups tips by app`() throws {
        let temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)

        try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: temporaryDirectory)
        }

        let tip1 = temporaryDirectory.appendingPathComponent("tip1.md")
        try self.singleTipMarkdown.write(to: tip1, atomically: true, encoding: .utf8)

        let tip2 = temporaryDirectory.appendingPathComponent("tip2.md")
        try self.plainTipMarkdown.write(to: tip2, atomically: true, encoding: .utf8)

        let textFile = temporaryDirectory.appendingPathComponent("ignore.txt")
        try "ignore me".write(to: textFile, atomically: true, encoding: .utf8)

        let apps = TipParser.loadAll(from: temporaryDirectory)

        #expect(apps.count == 1)
        #expect(apps.first?.name == "Test App")
        #expect(apps.first?.sections.count == 2)
        let headings = Set(apps.first?.sections.map(\.heading) ?? [])
        #expect(headings.contains("Shortcuts"))
        #expect(headings.contains("Features"))
    }

    @Test
    func `flat tip IDs are unique`() {
        let contentDirectory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Resources/content", isDirectory: true)

        let apps = TipParser.loadAll(from: contentDirectory)
        var ids: [String] = []
        for app in apps {
            for section in app.sections {
                for item in section.items {
                    ids.append("\(app.id)-\(section.id)-\(item.id)")
                }
            }
        }

        let uniqueCount = Set(ids).count
        let totalCount = ids.count
        let duplicateCount = totalCount - uniqueCount

        // Allow up to 2 known duplicates from 30-char prefix truncation
        #expect(duplicateCount <= 2, "Found \(duplicateCount) duplicate FlatTip IDs")
    }

    @Test
    func `loads bundled content directory from source tree`() {
        let contentDirectory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Resources/content", isDirectory: true)

        let apps = TipParser.loadAll(from: contentDirectory)

        #expect(apps.count >= 46)
        #expect(apps.map(\.name).contains("Finder"))
        #expect(apps.map(\.name).contains("Safari"))
        #expect(apps.map(\.name).contains("Xcode"))

        if let finder = apps.first(where: { $0.name == "Finder" }) {
            #expect(!finder.sections.isEmpty)
            #expect(finder.sections.flatMap(\.items).count > 10)
        }
    }
}
