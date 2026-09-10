public import Foundation

public protocol APIPlatformSnapshotPersisting: Sendable {
  func load() throws -> [APIPlatformID: APIPlatformSnapshot]
  func save(_ snapshots: [APIPlatformID: APIPlatformSnapshot]) throws
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

  public func load() throws -> [APIPlatformID: APIPlatformSnapshot] {
    guard fileManager.fileExists(atPath: url.path) else { return [:] }
    let data: Data
    do {
      data = try Data(contentsOf: url)
    } catch {
      throw APIPlatformError.cacheCorrupt
    }
    if let cache = try? JSONDecoder().decode(APIPlatformCacheFile.self, from: data) {
      return try dictionary(from: cache.snapshots)
    }
    if let snapshot = try? JSONDecoder().decode(APIPlatformSnapshot.self, from: data) {
      return [snapshot.platform: snapshot]
    }
    throw APIPlatformError.cacheCorrupt
  }

  public func save(_ snapshots: [APIPlatformID: APIPlatformSnapshot]) throws {
    do {
      try fileManager.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      let cache = APIPlatformCacheFile(
        snapshots: snapshots.values.sorted { $0.platform.rawValue < $1.platform.rawValue })
      try JSONEncoder().encode(cache).write(to: url, options: .atomic)
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

  private func dictionary(from snapshots: [APIPlatformSnapshot]) throws -> [APIPlatformID:
    APIPlatformSnapshot]
  {
    var result: [APIPlatformID: APIPlatformSnapshot] = [:]
    for snapshot in snapshots {
      if result[snapshot.platform] != nil { throw APIPlatformError.cacheCorrupt }
      result[snapshot.platform] = snapshot
    }
    return result
  }
}

private struct APIPlatformCacheFile: Codable {
  let snapshots: [APIPlatformSnapshot]
}
