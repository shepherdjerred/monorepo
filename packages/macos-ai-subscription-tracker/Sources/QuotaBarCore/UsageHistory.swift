public import Foundation

public struct UsageHistorySample: Identifiable, Equatable, Codable, Sendable {
  public let provider: ProviderID
  public let windowID: String
  public let label: String
  public let kind: WindowKind
  public let usedPercent: Double
  public let resetAt: Date?
  public let recordedAt: Date

  public var id: String {
    "\(provider.rawValue):\(windowID):\(recordedAt.timeIntervalSince1970)"
  }

  public init(
    provider: ProviderID,
    windowID: String,
    label: String,
    kind: WindowKind,
    usedPercent: Double,
    resetAt: Date?,
    recordedAt: Date
  ) throws {
    guard !windowID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      usedPercent.isFinite,
      0...100 ~= usedPercent
    else {
      throw QuotaValidationError.invalidPercentage
    }
    self.provider = provider
    self.windowID = windowID
    self.label = label
    self.kind = kind
    self.usedPercent = usedPercent
    self.resetAt = resetAt
    self.recordedAt = recordedAt
  }

  public static func samples(from snapshot: UsageSnapshot) -> [UsageHistorySample] {
    snapshot.windows.compactMap { window in
      guard let usedPercent = window.usedPercent else { return nil }
      return try? UsageHistorySample(
        provider: snapshot.provider,
        windowID: window.id,
        label: window.label,
        kind: window.kind,
        usedPercent: usedPercent,
        resetAt: window.resetAt,
        recordedAt: snapshot.sourceTimestamp
      )
    }
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self = try UsageHistorySample(
      provider: container.decode(ProviderID.self, forKey: .provider),
      windowID: container.decode(String.self, forKey: .windowID),
      label: container.decode(String.self, forKey: .label),
      kind: container.decode(WindowKind.self, forKey: .kind),
      usedPercent: container.decode(Double.self, forKey: .usedPercent),
      resetAt: container.decodeIfPresent(Date.self, forKey: .resetAt),
      recordedAt: container.decode(Date.self, forKey: .recordedAt)
    )
  }

  fileprivate var migratedForCurrentSchema: UsageHistorySample? {
    let removedClaudeNimbusWindowIDs = Set([
      "provider-nimbus-quill",
      "weekly-nimbus-quil",
      "weekly-nimbus-quill",
    ])
    if provider == .claudeCode, removedClaudeNimbusWindowIDs.contains(windowID) {
      return nil
    }
    guard provider == .codex, windowID == "codex-primary-window" else { return self }
    return UsageHistorySample(
      copying: self,
      windowID: "weekly",
      label: "Weekly",
      kind: .weekly
    )
  }

  private init(
    copying sample: UsageHistorySample,
    windowID: String,
    label: String,
    kind: WindowKind
  ) {
    self.provider = sample.provider
    self.windowID = windowID
    self.label = label
    self.kind = kind
    self.usedPercent = sample.usedPercent
    self.resetAt = sample.resetAt
    self.recordedAt = sample.recordedAt
  }
}

public protocol UsageHistoryPersisting: Sendable {
  func load() throws -> [UsageHistorySample]
  func save(_ samples: [UsageHistorySample]) throws
}

public final class JSONUsageHistoryStore: UsageHistoryPersisting, @unchecked Sendable {
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
      url: support.appendingPathComponent("QuotaBar/history.json"), fileManager: fileManager)
  }

  public func load() throws -> [UsageHistorySample] {
    guard fileManager.fileExists(atPath: url.path) else { return [] }
    do {
      return try JSONDecoder().decode([UsageHistorySample].self, from: Data(contentsOf: url))
    } catch {
      throw QuotaError.historyCorrupt
    }
  }

  public func save(_ samples: [UsageHistorySample]) throws {
    do {
      try fileManager.createDirectory(
        at: url.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      try JSONEncoder().encode(samples).write(to: url, options: .atomic)
    } catch {
      throw QuotaError.historyWriteFailed
    }
  }
}

public enum UsageHistory {
  public static let retention: TimeInterval = 30 * 24 * 60 * 60

  public static func compact(
    _ samples: [UsageHistorySample],
    at date: Date = .now,
    retention: TimeInterval = retention
  ) -> [UsageHistorySample] {
    let cutoff = date.addingTimeInterval(-retention)
    var unique: [String: UsageHistorySample] = [:]
    for original in samples where original.recordedAt >= cutoff {
      guard let sample = original.migratedForCurrentSchema else { continue }
      unique[sample.id] = sample
    }
    return unique.values.sorted { $0.recordedAt < $1.recordedAt }
  }

  public static func todayUsedPercent(
    provider: ProviderID,
    windowID: String,
    samples: [UsageHistorySample],
    at date: Date = .now,
    calendar: Calendar = .current
  ) -> Double? {
    let start = calendar.startOfDay(for: date)
    let today =
      samples
      .filter { $0.provider == provider && $0.windowID == windowID && $0.recordedAt >= start }
      .sorted { $0.recordedAt < $1.recordedAt }
    guard today.count >= 2 else { return nil }
    return zip(today, today.dropFirst()).reduce(0) { total, pair in
      let earlier = pair.0
      let later = pair.1
      let increase = later.usedPercent - earlier.usedPercent
      if increase >= 0 { return total + increase }
      return earlier.resetAt == later.resetAt ? total : total + later.usedPercent
    }
  }
}
