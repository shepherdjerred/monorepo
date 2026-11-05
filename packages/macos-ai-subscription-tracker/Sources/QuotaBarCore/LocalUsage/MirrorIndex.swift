import Foundation

/// Other machines' Claude Code and Codex logs pulled by `brim sync pull`.
///
/// Decodes `~/.toolkit/brim-sync/mirror/index.json`. The language-neutral
/// contract is `packages/toolkit/schemas/brim-sync-mirror-index.schema.json`;
/// the toolkit writer and this reader are tested against the same fixture.
/// Only the fields Brim needs are decoded.
struct MirrorIndex: Decodable, Equatable {
  static let supportedSchemaVersion = 1

  let schemaVersion: Int
  let machines: [MirrorMachine]

  static func location(home: URL) -> URL {
    home.appendingPathComponent(".toolkit/brim-sync/mirror/index.json")
  }

  /// `nil` when nothing has been pulled; throws for an unreadable index.
  static func load(home: URL, fileManager: FileManager) throws -> Self? {
    let url = location(home: home)
    guard fileManager.fileExists(atPath: url.path) else { return nil }
    return try decode(Data(contentsOf: url))
  }

  static func decode(_ data: Data) throws -> Self {
    let index = try JSONDecoder().decode(Self.self, from: data)
    guard index.schemaVersion == supportedSchemaVersion else {
      throw MirrorIndexError.unsupportedSchemaVersion(index.schemaVersion)
    }
    return index
  }
}

struct MirrorMachine: Decodable, Equatable {
  let machineId: String
  let displayName: String
  let platform: String
  let claudeProjectsDirs: [String]
  let codexSessionsDirs: [String]
}

enum MirrorIndexError: Error, Equatable {
  case unsupportedSchemaVersion(Int)
}
