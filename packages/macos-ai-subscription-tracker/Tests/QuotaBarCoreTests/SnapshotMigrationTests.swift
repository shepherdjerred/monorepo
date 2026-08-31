import Foundation
import XCTest

@testable import QuotaBarCore

@MainActor final class SnapshotMigrationTests: XCTestCase {
  func testCachedStartupRemovesClaudeNimbusWindow() throws {
    let weekly = try UsageWindow.validated(
      id: "weekly",
      label: "Weekly",
      kind: .weekly,
      usedPercent: 30,
      resetAt: nil,
      sourceTimestamp: .now
    )
    let nimbus = try UsageWindow.validated(
      id: "provider-nimbus-quill",
      label: "Provider quota · Nimbus Quill",
      kind: .providerDefined,
      usedPercent: 0,
      resetAt: nil,
      sourceTimestamp: .now
    )
    let cached = UsageSnapshot(
      provider: .claudeCode,
      windows: [weekly, nimbus],
      sourceTimestamp: .now
    )
    let provider = FakeProvider(id: .claudeCode, results: [])
    let settings = AppSettings(
      store: SnapshotMigrationSettingsStore(),
      minimumPollingInterval: 60
    )
    let model = QuotaBarModel(
      providers: [provider],
      settings: settings,
      store: SnapshotMigrationStore(loaded: [.claudeCode: cached]),
      historyStore: MemoryHistoryStore(),
      providerTimeout: .seconds(1)
    )

    guard case let .available(value) = model.state(for: .claudeCode) else {
      XCTFail("Expected cached Claude state")
      return
    }
    XCTAssertEqual(value.windows.map(\.id), ["weekly"])
  }
}

private final class SnapshotMigrationStore: SnapshotPersisting, @unchecked Sendable {
  private let loaded: [ProviderID: UsageSnapshot]

  init(loaded: [ProviderID: UsageSnapshot]) {
    self.loaded = loaded
  }

  func load() throws -> [ProviderID: UsageSnapshot] { loaded }
  func save(_: [ProviderID: UsageSnapshot]) throws {}
}

private final class SnapshotMigrationSettingsStore: SettingsPersisting, @unchecked Sendable {
  func enabledProviders() -> Set<ProviderID>? { [.claudeCode] }
  func showsLegacyProviders() -> Bool? { false }
  func pollingInterval() -> TimeInterval? { nil }
  func save(
    enabledProviders _: Set<ProviderID>,
    showsLegacyProviders _: Bool,
    pollingInterval _: TimeInterval
  ) {}
}
