import Foundation
import Markdown
import SwiftUI
import Yams

/// Parses markdown files with YAML frontmatter into `TipApp` models.
enum TipParser {

    /// Parse a single markdown string into a `TipApp`.
    static func parse(content: String) throws -> TipApp {
        let (metadata, body) = try splitFrontmatter(content)
        let sections = parseSections(from: body)
        let color = metadata.color.flatMap { parseHexColor($0) } ?? .accentColor

        return TipApp(
            id: metadata.app.lowercased().replacingOccurrences(of: " ", with: "-"),
            name: metadata.app,
            icon: metadata.icon,
            color: color,
            website: metadata.website,
            sections: sections
        )
    }

    /// Load all tip files from a directory.
    static func loadAll(from directory: URL) throws -> [TipApp] {
        let fileManager = FileManager.default
        guard let enumerator = fileManager.enumerator(
            at: directory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }

        var apps: [TipApp] = []
        while let fileURL = enumerator.nextObject() as? URL {
            guard fileURL.pathExtension == "md" else { continue }
            let content = try String(contentsOf: fileURL, encoding: .utf8)
            let app = try parse(content: content)
            apps.append(app)
        }

        return apps.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    // MARK: - Private

    private static func splitFrontmatter(_ content: String) throws -> (TipAppMetadata, String) {
        let delimiter = "---"
        let lines = content.components(separatedBy: .newlines)

        guard let firstDelimiterIndex = lines.firstIndex(where: { $0.trimmingCharacters(in: .whitespaces) == delimiter }) else {
            throw TipParserError.missingFrontmatter
        }

        let afterFirst = lines.index(after: firstDelimiterIndex)
        guard let secondDelimiterIndex = lines[afterFirst...].firstIndex(where: {
            $0.trimmingCharacters(in: .whitespaces) == delimiter
        }) else {
            throw TipParserError.missingFrontmatter
        }

        let yamlLines = lines[(firstDelimiterIndex + 1)..<secondDelimiterIndex]
        let yamlString = yamlLines.joined(separator: "\n")
        let bodyLines = lines[(secondDelimiterIndex + 1)...]
        let bodyString = bodyLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)

        let decoder = YAMLDecoder()
        let metadata = try decoder.decode(TipAppMetadata.self, from: yamlString)

        return (metadata, bodyString)
    }

    private static func parseSections(from body: String) -> [TipSection] {
        let document = Document(parsing: body)
        var sections: [TipSection] = []
        var currentHeading: String?
        var currentItems: [TipItem] = []

        for child in document.children {
            if let heading = child as? Heading, heading.level == 2 {
                if let heading = currentHeading {
                    sections.append(makeSection(heading: heading, items: currentItems))
                }
                currentHeading = heading.plainText
                currentItems = []
            } else if let list = child as? UnorderedList {
                for listItem in list.listItems {
                    let text = listItem.plainText
                    let (cleanText, shortcut) = extractShortcut(from: text)
                    currentItems.append(TipItem(
                        id: "\(currentHeading ?? "unknown")-\(currentItems.count)",
                        text: cleanText,
                        shortcut: shortcut
                    ))
                }
            }
        }

        if let heading = currentHeading {
            sections.append(makeSection(heading: heading, items: currentItems))
        }

        return sections
    }

    private static func makeSection(heading: String, items: [TipItem]) -> TipSection {
        TipSection(
            id: heading.lowercased().replacingOccurrences(of: " ", with: "-"),
            heading: heading,
            items: items
        )
    }

    private static func extractShortcut(from text: String) -> (String, String?) {
        let pattern = /`([^`]+)`\s*[—–-]\s*(.*)/
        if let match = text.firstMatch(of: pattern) {
            let shortcut = String(match.output.1)
            let description = String(match.output.2)
            return (description, shortcut)
        }
        return (text, nil)
    }

    private static func parseHexColor(_ hex: String) -> Color? {
        var hexString = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if hexString.hasPrefix("#") {
            hexString.removeFirst()
        }
        guard hexString.count == 6, let hexValue = UInt64(hexString, radix: 16) else {
            return nil
        }
        let red = Double((hexValue >> 16) & 0xFF) / 255.0
        let green = Double((hexValue >> 8) & 0xFF) / 255.0
        let blue = Double(hexValue & 0xFF) / 255.0
        return Color(red: red, green: green, blue: blue)
    }
}

/// Errors that can occur during tip file parsing.
enum TipParserError: Error, CustomStringConvertible {
    case missingFrontmatter

    var description: String {
        switch self {
        case .missingFrontmatter:
            "Tip file is missing YAML frontmatter delimiters (---)"
        }
    }
}

// MARK: - Markup Extensions

extension Markup {
    /// Extract plain text from any markup node.
    var plainText: String {
        if let text = self as? Markdown.Text {
            return text.string
        }
        if let code = self as? InlineCode {
            return "`\(code.code)`"
        }
        return children.map(\.plainText).joined()
    }
}
