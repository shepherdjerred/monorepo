import Foundation
import Markdown
import os
import SwiftUI
import Yams

// MARK: - TipParser

/// Parses markdown files with YAML frontmatter into `TipApp` models.
/// Each file contains a single tip with app metadata and category in frontmatter.
/// Tips are grouped by app name and category to build the `TipApp` hierarchy.
enum TipParser {
    // MARK: Internal

    /// Parsed representation of a single tip file.
    struct ParsedTip {
        let metadata: TipAppMetadata
        let item: TipItem
    }

    /// Parse a single tip file into its metadata and tip item.
    static func parseSingleTip(content: String) throws -> ParsedTip {
        let (metadata, body) = try splitFrontmatter(content)

        // Extract the tip text from the body (strip leading "- " if present)
        var tipText = body.trimmingCharacters(in: .whitespacesAndNewlines)
        if tipText.hasPrefix("- ") {
            tipText = String(tipText.dropFirst(2))
        }

        let (cleanText, shortcut) = self.extractShortcut(from: tipText)
        let category = metadata.category ?? "General"
        let item = TipItem(
            id: "\(category)-\(cleanText.prefix(30))",
            text: cleanText,
            shortcut: shortcut
        )

        return ParsedTip(metadata: metadata, item: item)
    }

    /// Load all tip files from a directory and group them into apps.
    static func loadAll(from directory: URL) -> [TipApp] {
        let fileManager = FileManager.default
        guard let enumerator = fileManager.enumerator(
            at: directory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }

        // Parse all individual tip files
        var tipsByApp: [String: (metadata: TipAppMetadata, tips: [(category: String, item: TipItem)])] = [:]
        var parseFailures = 0

        while let fileURL = enumerator.nextObject() as? URL {
            guard fileURL.pathExtension == "md" else {
                continue
            }
            do {
                let content = try String(contentsOf: fileURL, encoding: .utf8)
                let parsed = try parseSingleTip(content: content)
                let appName = parsed.metadata.app
                let category = parsed.metadata.category ?? "General"

                if tipsByApp[appName] == nil {
                    tipsByApp[appName] = (metadata: parsed.metadata, tips: [])
                }
                tipsByApp[appName]?.tips.append((category: category, item: parsed.item))
            } catch {
                parseFailures += 1
                let tipsError = TipsError.tipFileParseError(file: fileURL, underlying: error)
                Logger.parsing.error("\(tipsError.description)")
            }
        }

        if parseFailures > 0 {
            Logger.parsing.notice("\(parseFailures) tip file(s) failed to parse")
        }

        // Build TipApp objects from grouped tips
        let apps = tipsByApp.map { _, value -> TipApp in
            self.buildApp(from: value)
        }

        return apps.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    static func extractShortcut(from text: String) -> (String, String?) {
        let pattern = /`([^`]+)`\s*[—–-]\s*(.*)/
        if let match = text.firstMatch(of: pattern) {
            let shortcut = String(match.output.1)
            let description = String(match.output.2)
            return (description, shortcut)
        }
        return (text, nil)
    }

    // MARK: Private

    private static func buildApp(
        from value: (metadata: TipAppMetadata, tips: [(category: String, item: TipItem)])
    ) -> TipApp {
        let metadata = value.metadata
        let color = metadata.color.flatMap { self.parseHexColor($0) } ?? .accentColor

        // Group tips by category, preserving insertion order
        var sectionOrder: [String] = []
        var sectionItems: [String: [TipItem]] = [:]

        for (category, item) in value.tips {
            if sectionItems[category] == nil {
                sectionOrder.append(category)
            }
            sectionItems[category, default: []].append(item)
        }

        let sections = sectionOrder.map { heading in
            TipSection(
                id: heading.lowercased().replacingOccurrences(of: " ", with: "-"),
                heading: heading,
                items: sectionItems[heading] ?? []
            )
        }

        return TipApp(
            id: metadata.app.lowercased().replacingOccurrences(of: " ", with: "-"),
            name: metadata.app,
            icon: metadata.icon,
            color: color,
            website: metadata.website,
            sections: sections
        )
    }

    private static func splitFrontmatter(_ content: String) throws -> (TipAppMetadata, String) {
        let delimiter = "---"
        let lines = content.components(separatedBy: .newlines)

        guard let firstDelimiterIndex = lines
            .firstIndex(where: { $0.trimmingCharacters(in: .whitespaces) == delimiter })
        else {
            throw TipParserError.missingFrontmatter
        }

        let afterFirst = lines.index(after: firstDelimiterIndex)
        guard let secondDelimiterIndex = lines[afterFirst...].firstIndex(where: {
            $0.trimmingCharacters(in: .whitespaces) == delimiter
        }) else {
            throw TipParserError.missingFrontmatter
        }

        let yamlLines = lines[(firstDelimiterIndex + 1) ..< secondDelimiterIndex]
        let yamlString = yamlLines.joined(separator: "\n")
        let bodyLines = lines[(secondDelimiterIndex + 1)...]
        let bodyString = bodyLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)

        let decoder = YAMLDecoder()
        let metadata = try decoder.decode(TipAppMetadata.self, from: yamlString)

        return (metadata, bodyString)
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

// MARK: - TipParserError

/// Errors that can occur during tip file parsing.
enum TipParserError: Error, CustomStringConvertible {
    case missingFrontmatter

    // MARK: Internal

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
