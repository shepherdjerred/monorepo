import SwiftUI

/// Represents an application with its associated tips, parsed from a markdown file.
struct TipApp: Identifiable, Sendable {
    let id: String
    let name: String
    let icon: String
    let color: Color
    let website: String?
    let sections: [TipSection]
}

/// YAML frontmatter metadata for a tip file.
struct TipAppMetadata: Codable, Sendable {
    let app: String
    let icon: String
    let color: String?
    let website: String?
}
