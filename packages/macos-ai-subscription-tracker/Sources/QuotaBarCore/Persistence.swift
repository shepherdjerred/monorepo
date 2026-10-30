public import Foundation

public protocol SnapshotPersisting: Sendable {
  func load() throws -> [ProviderID: UsageSnapshot]
  func save(_ snapshots: [ProviderID: UsageSnapshot]) throws
}

public final class JSONSnapshotStore: SnapshotPersisting, @unchecked Sendable {
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
      url: support.appendingPathComponent("QuotaBar/snapshots.json"), fileManager: fileManager)
  }

  /// The cache is also the status feed external readers (such as `toolkit brim`)
  /// consume, so entries carry their true freshness: a provider whose latest
  /// fetch failed is stored stale-marked instead of leaving its last good
  /// numbers labeled current indefinitely. Loading still distrusts every
  /// entry until a fresh fetch lands; the stored marker only stops other
  /// readers from mistaking frozen data for live quota.
  public func load() throws -> [ProviderID: UsageSnapshot] {
    guard fileManager.fileExists(atPath: url.path) else { return [:] }
    do {
      let snapshots = try JSONDecoder().decode([UsageSnapshot].self, from: Data(contentsOf: url))
      var result: [ProviderID: UsageSnapshot] = [:]
      for snapshot in snapshots {
        guard result[snapshot.provider] == nil else {
          throw QuotaError.cacheCorrupt
        }
        result[snapshot.provider] = snapshot
      }
      return result
    } catch let error as QuotaError {
      throw error
    } catch {
      throw QuotaError.cacheCorrupt
    }
  }

  public func save(_ snapshots: [ProviderID: UsageSnapshot]) throws {
    do {
      try fileManager.createDirectory(
        at: url.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      let values = snapshots.values.sorted { $0.provider.rawValue < $1.provider.rawValue }
      try JSONEncoder().encode(values).write(to: url, options: .atomic)
    } catch {
      throw QuotaError.cacheWriteFailed
    }
  }
}
