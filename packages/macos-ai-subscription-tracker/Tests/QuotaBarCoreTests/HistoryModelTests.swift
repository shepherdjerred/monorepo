import Foundation
import XCTest

@testable import QuotaBarCore

@MainActor final class HistoryModelTests: XCTestCase {
  func testStartupCompactsAndPersistsExpiredHistory() throws {
    let current = Date.now
    let retained = try historySample(provider: .codex, usedPercent: 30, at: current)
    let expired = try historySample(
      provider: .codex,
      usedPercent: 20,
      at: current.addingTimeInterval(-UsageHistory.retention - 1)
    )
    let historyStore = MemoryHistoryStore(saved: [expired, retained])

    let model = makeModel(providers: [], historyStore: historyStore)

    XCTAssertEqual(model.history, [retained])
    XCTAssertEqual(historyStore.saved, [retained])
  }

  func testCredentialChangeClearsOnlyThatProvidersHistory() async throws {
    let current = Date.now
    let oldCodex = try historySample(provider: .codex, usedPercent: 80, at: current)
    let claude = try historySample(provider: .claudeCode, usedPercent: 30, at: current)
    let provider = FakeProvider(
      id: .codex,
      results: [.success(snapshot(provider: .codex, remaining: 60))]
    )
    let model = makeModel(
      providers: [provider],
      historyStore: MemoryHistoryStore(saved: [oldCodex, claude])
    )

    await model.handleCredentialChange(for: .codex)

    XCTAssertFalse(model.history.contains(oldCodex))
    XCTAssertTrue(model.history.contains(claude))
  }

  private func historySample(provider: ProviderID, usedPercent: Double, at date: Date) throws
    -> UsageHistorySample
  {
    try UsageHistorySample(
      provider: provider,
      windowID: "weekly",
      label: "Weekly",
      kind: .weekly,
      usedPercent: usedPercent,
      resetAt: nil,
      recordedAt: date
    )
  }

  private func makeModel(
    providers: [any UsageProvider],
    historyStore: MemoryHistoryStore
  ) -> QuotaBarModel {
    let settings = AppSettings(
      store: HistoryModelSettingsStore(enabled: Set(providers.map(\.id))),
      minimumPollingInterval: 60
    )
    return QuotaBarModel(
      providers: providers,
      settings: settings,
      historyStore: historyStore,
      providerTimeout: .seconds(1)
    )
  }

  private func snapshot(provider: ProviderID, remaining: Double) -> UsageSnapshot {
    UsageSnapshot(
      provider: provider,
      windows: [window(remaining: remaining)],
      sourceTimestamp: .now
    )
  }
}

private final class HistoryModelSettingsStore: SettingsPersisting, @unchecked Sendable {
  private let enabled: Set<ProviderID>

  init(enabled: Set<ProviderID>) {
    self.enabled = enabled
  }

  func enabledProviders() -> Set<ProviderID>? { enabled }
  func showsLegacyProviders() -> Bool? { false }
  func pollingInterval() -> TimeInterval? { nil }
  func save(
    enabledProviders _: Set<ProviderID>,
    showsLegacyProviders _: Bool,
    pollingInterval _: TimeInterval
  ) {}
}
