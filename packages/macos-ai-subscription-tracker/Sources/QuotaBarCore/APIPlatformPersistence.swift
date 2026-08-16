public import Foundation

public protocol APIPlatformSnapshotPersisting: Sendable {
  func load() throws -> APIPlatformSnapshot?
  func save(_ snapshot: APIPlatformSnapshot) throws
  func remove() throws
}

public final class JSONAPIPlatformSnapshotStore: APIPlatformSnapshotPersisting, @unchecked Sendable
{
  public let url: URL
  private let fileManager: FileManager

  public init(url: URL, fileManager: FileManager = .default) {
    self.url = url
    self.fileManager = fileManager
  }

  public convenience init(fileManager: FileManager = .default) {
    let support =
      fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? fileManager.homeDirectoryForCurrentUser.appendingPathComponent(
        "Library/Application Support")
    self.init(
      url: support.appendingPathComponent("QuotaBar/api-platform-snapshot.json"),
      fileManager: fileManager
    )
  }

  public func load() throws -> APIPlatformSnapshot? {
    guard fileManager.fileExists(atPath: url.path) else { return nil }
    do {
      return try JSONDecoder().decode(APIPlatformSnapshot.self, from: Data(contentsOf: url))
    } catch {
      throw APIPlatformError.cacheCorrupt
    }
  }

  public func save(_ snapshot: APIPlatformSnapshot) throws {
    do {
      try fileManager.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try JSONEncoder().encode(snapshot).write(to: url, options: .atomic)
    } catch {
      throw APIPlatformError.cacheWriteFailed
    }
  }

  public func remove() throws {
    guard fileManager.fileExists(atPath: url.path) else { return }
    do {
      try fileManager.removeItem(at: url)
    } catch {
      throw APIPlatformError.cacheWriteFailed
    }
  }
}
