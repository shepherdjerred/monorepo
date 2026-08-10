import Foundation
import XCTest

@testable import QuotaBarCore

@MainActor
final class ModelTests: XCTestCase {
  func testCachedStartupIsStaleAndCorruptCacheIsVisible() {
    let cached = snapshot(provider: .codex, remaining: 80)
    let provider = FakeProvider(id: .codex, results: [])
    let model = makeModel(
      providers: [provider],
      store: MemorySnapshotStore(loaded: [.codex: cached])
    )
    guard case let .available(value) = model.state(for: .codex) else {
      XCTFail("Expected cached state")
      return
    }
    XCTAssertNotEqual(value.freshness, .current)
    XCTAssertEqual(model.overallStatus, .unavailable)

    let corrupt = makeModel(providers: [], store: MemorySnapshotStore(loadError: .cacheCorrupt))
    XCTAssertNotNil(corrupt.cacheErrorMessage)
  }

  func testSuccessfulRefreshAndSave() async {
    let codex = FakeProvider(
      id: .codex, results: [.success(snapshot(provider: .codex, remaining: 60))])
    let store = MemorySnapshotStore()
    let model = makeModel(providers: [codex], store: store)
    await model.refresh()
    XCTAssertEqual(model.overallStatus, .healthy)
    XCTAssertEqual(store.savedSnapshots[.codex]?.provider, .codex)
    XCTAssertNil(model.cacheErrorMessage)
  }

  func testRateLimitRetainsLastSnapshotAsStale() async {
    let cached = snapshot(provider: .codex, remaining: 60)
    let codex = FakeProvider(id: .codex, results: [.failure(.rateLimited(.codex))])
    let store = MemorySnapshotStore(loaded: [.codex: cached])
    let model = makeModel(providers: [codex], store: store)
    await model.refresh()
    guard case let .available(value) = model.state(for: .codex) else {
      XCTFail("Expected stale snapshot")
      return
    }
    XCTAssertNotEqual(value.freshness, .current)
    XCTAssertEqual(store.saveCount, 0)
  }

  func testAuthenticationAndNetworkFailuresAreDistinct() async {
    let codex = FakeProvider(id: .codex, results: [.failure(.credentialsMissing(.codex))])
    let kimi = FakeProvider(id: .kimi, results: [.failure(.network(.kimi))])
    let model = makeModel(providers: [codex, kimi])
    await model.refresh()
    guard case .unauthenticated = model.state(for: .codex) else {
      XCTFail("Expected auth state")
      return
    }
    guard case .unavailable = model.state(for: .kimi) else {
      XCTFail("Expected unavailable state")
      return
    }
  }

  func testDisabledProvidersAreExcludedAndPrecedenceIsCorrect() async {
    let claude = FakeProvider(
      id: .claudeCode,
      results: [
        .success(snapshot(provider: .claudeCode, remaining: 10)),
        .success(snapshot(provider: .claudeCode, remaining: 10)),
      ]
    )
    let codex = FakeProvider(
      id: .codex,
      results: [.success(snapshot(provider: .codex, remaining: 2))]
    )
    let settingsStore = MemoryModelSettingsStore(enabled: [])
    let settings = AppSettings(store: settingsStore, minimumPollingInterval: 0.01)
    let model = QuotaBarModel(
      providers: [claude, codex],
      settings: settings,
      store: MemorySnapshotStore(),
      providerTimeout: .seconds(1)
    )
    XCTAssertEqual(model.overallStatus, .unavailable)

    model.setProvider(.claudeCode, enabled: true)
    await model.refresh()
    XCTAssertEqual(model.overallStatus, .warning)
    model.setProvider(.codex, enabled: true)
    XCTAssertEqual(model.overallStatus, .unavailable)
    await model.refresh()
    XCTAssertEqual(model.overallStatus, .critical)
    model.setProvider(.codex, enabled: false)
    XCTAssertEqual(model.overallStatus, .warning)
  }

  func testOverlappingRefreshesAreSuppressed() async {
    let provider = FakeProvider(
      id: .codex,
      results: [.success(snapshot(provider: .codex, remaining: 80))],
      delay: .milliseconds(50)
    )
    let model = makeModel(providers: [provider])
    let first = Task { await model.refresh() }
    await Task.yield()
    await model.refresh()
    await first.value
    let fetchCount = await provider.fetchCount
    XCTAssertEqual(fetchCount, 1)
  }

  func testProviderTimeoutAndCacheSaveFailure() async {
    let provider = FakeProvider(
      id: .codex,
      results: [.success(snapshot(provider: .codex, remaining: 80))],
      delay: .seconds(1)
    )
    let timeoutModel = makeModel(providers: [provider], timeout: .milliseconds(10))
    await timeoutModel.refresh()
    guard case .unavailable = timeoutModel.state(for: .codex) else {
      XCTFail("Expected timeout state")
      return
    }

    let successful = FakeProvider(
      id: .codex,
      results: [.success(snapshot(provider: .codex, remaining: 80))]
    )
    let failingStore = MemorySnapshotStore(saveError: .cacheWriteFailed)
    let saveModel = makeModel(providers: [successful], store: failingStore)
    await saveModel.refresh()
    XCTAssertNotNil(saveModel.cacheErrorMessage)
  }

  func testPollingIntervalChangeRestartsPolling() async {
    let provider = FakeProvider(
      id: .codex,
      results: [
        .success(snapshot(provider: .codex, remaining: 80)),
        .success(snapshot(provider: .codex, remaining: 70)),
      ]
    )
    let model = makeModel(providers: [provider], minimumInterval: 0.01)
    model.startPolling()
    try? await Task.sleep(for: .milliseconds(20))
    model.updatePollingInterval(0.01)
    try? await Task.sleep(for: .milliseconds(40))
    model.stopPolling()
    let fetchCount = await provider.fetchCount
    XCTAssertGreaterThanOrEqual(fetchCount, 2)
  }

  private func makeModel(
    providers: [any UsageProvider],
    store: MemorySnapshotStore = MemorySnapshotStore(),
    timeout: Duration = .seconds(1),
    minimumInterval: TimeInterval = 60
  ) -> QuotaBarModel {
    let settings = AppSettings(
      store: MemoryModelSettingsStore(enabled: Set(providers.map(\.id))),
      minimumPollingInterval: minimumInterval
    )
    return QuotaBarModel(
      providers: providers,
      settings: settings,
      store: store,
      providerTimeout: timeout
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

private actor FakeProvider: UsageProvider {
  nonisolated let id: ProviderID
  private var results: [Result<UsageSnapshot, QuotaError>]
  private let delay: Duration
  private(set) var fetchCount = 0

  init(
    id: ProviderID,
    results: [Result<UsageSnapshot, QuotaError>],
    delay: Duration = .zero
  ) {
    self.id = id
    self.results = results
    self.delay = delay
  }

  func fetch() async throws -> UsageSnapshot {
    fetchCount += 1
    if delay != .zero { try await Task.sleep(for: delay) }
    guard !results.isEmpty else { throw QuotaError.network(id) }
    return try results.removeFirst().get()
  }
}

private final class MemorySnapshotStore: SnapshotPersisting, @unchecked Sendable {
  private let lock = NSLock()
  private let loaded: [ProviderID: UsageSnapshot]
  private let loadError: QuotaError?
  private let saveError: QuotaError?
  private(set) var savedSnapshots: [ProviderID: UsageSnapshot] = [:]
  private(set) var saveCount = 0

  init(
    loaded: [ProviderID: UsageSnapshot] = [:],
    loadError: QuotaError? = nil,
    saveError: QuotaError? = nil
  ) {
    self.loaded = loaded
    self.loadError = loadError
    self.saveError = saveError
  }

  func load() throws -> [ProviderID: UsageSnapshot] {
    if let loadError { throw loadError }
    return loaded
  }

  func save(_ snapshots: [ProviderID: UsageSnapshot]) throws {
    if let saveError { throw saveError }
    lock.withLock {
      savedSnapshots = snapshots
      saveCount += 1
    }
  }
}

private final class MemoryModelSettingsStore: SettingsPersisting, @unchecked Sendable {
  let enabled: Set<ProviderID>

  init(enabled: Set<ProviderID>) {
    self.enabled = enabled
  }

  func enabledProviders() -> Set<ProviderID>? { enabled }
  func pollingInterval() -> TimeInterval? { nil }
  func save(enabledProviders _: Set<ProviderID>, pollingInterval _: TimeInterval) {}
}
