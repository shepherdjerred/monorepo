import XCTest

@testable import QuotaBarCore

@MainActor
final class LocalUsageModelTests: XCTestCase {
  func testRefreshStoresLocalUsageOutsideTheSnapshotCache() async {
    let usage = LocalDailyUsage(
      provider: .claudeCode,
      totalTokens: 1_200_000,
      estimatedCostUSD: decimal("4.20"),
      unpricedModels: [],
      unreadable: false,
      pricingUnavailable: false
    )
    let provider = FakeProvider(
      id: .claudeCode,
      results: [.success(quotaSnapshot(provider: .claudeCode))]
    )
    let store = MemorySnapshotStore()
    let settings = AppSettings(
      store: MemoryModelSettingsStore(enabled: [.claudeCode]),
      minimumPollingInterval: 60
    )
    let model = QuotaBarModel(
      providers: [provider],
      settings: settings,
      store: store,
      historyStore: MemoryHistoryStore(),
      refresh: QuotaBarRefresh(
        timeout: .seconds(1),
        localUsageScan: { _, _ in [.claudeCode: usage] }
      )
    )

    await model.refresh()

    XCTAssertEqual(model.localDailyUsage[.claudeCode], usage)
    XCTAssertEqual(model.localDailyUsage[.claudeCode]?.caption, "Today: 1.2M tok · ~$4.20 API")
    XCTAssertEqual(store.savedSnapshots[.claudeCode]?.provider, .claudeCode)
    XCTAssertEqual(store.savedSnapshots[.claudeCode]?.windows.count, 1)
    XCTAssertNil(store.savedSnapshots[.codex])
  }

  private func quotaSnapshot(provider: ProviderID) -> UsageSnapshot {
    UsageSnapshot(provider: provider, windows: [window(remaining: 40)], sourceTimestamp: .now)
  }
}
