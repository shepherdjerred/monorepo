import SwiftUI

// MARK: - TipApp

/// Represents an application with its associated tips, parsed from a markdown file.
struct TipApp: Identifiable {
    let id: String
    let name: String
    let icon: String
    let color: Color
    let website: String?
    let sections: [TipSection]
}

// MARK: - TipAppMetadata

/// YAML frontmatter metadata for a tip file.
struct TipAppMetadata: Codable {
    let app: String
    let icon: String
    let color: String?
    let website: String?
    let category: String?
}
