public import Foundation
public import Observation

private enum ProviderFetchResult: Sendable {
  case success(ProviderID, UsageSnapshot)
  case failure(ProviderID, QuotaError)
}

private struct ActiveRefresh {
  let id: Int
  let task: Task<Void, Never>
}

public struct QuotaBarRefresh: Sendable {
  public var timeout: Duration
  public var collectionStatus: CollectionStatusStore?
  /// Reads today's usage and the active 5-hour blocks on each refresh.
  public var history: HistoryClient
  /// Defines "today" for the daily usage caption.
  public var calendar: Calendar

  public init(
    timeout: Duration = .seconds(25),
    history: HistoryClient = HistoryClient(),
    calendar: Calendar = .autoupdatingCurrent,
    collectionStatus: CollectionStatusStore? = nil
  ) {
    self.timeout = timeout
    self.history = history
    self.calendar = calendar
    self.collectionStatus = collectionStatus
  }
}

@MainActor @Observable
public final class QuotaBarModel {
  public private(set) var providers: [any UsageProvider]
  public let settings: AppSettings
  public private(set) var states: [ProviderID: ProviderDisplayState] = [:]
  public private(set) var isRefreshing = false
  public private(set) var isRecoveringMuse = false
  public private(set) var cacheErrorMessage: String?
  public private(set) var history: [UsageHistorySample] = []
  public private(set) var historyErrorMessage: String?
  /// Today's usage and active blocks from the history daemon, or why they
  /// could not be read; `nil` before the first refresh.
  public private(set) var historyUsage: Result<MenuHistoryUsage, HistoryAPIError>?

  private let store: any SnapshotPersisting
  private let historyStore: any UsageHistoryPersisting
  private let providerFactory: ((Set<ProviderID>) throws -> [any UsageProvider])?
  private let providerTimeout: Duration
  private let historyClient: HistoryClient
  private let calendar: Calendar
  private let collectionStatus: CollectionStatusStore?
  private var collectionFailures: [String: String] = [:]
  private var lastSuccessful: [ProviderID: UsageSnapshot] = [:]
  private var pollingTask: Task<Void, Never>?
  private var activeRefresh: ActiveRefresh?
  private var nextRefreshID = 0
  private var providerRefreshAttempts: [ProviderID: Int] = [:]

  public init(
    providers: [any UsageProvider],
    settings: AppSettings,
    store: any SnapshotPersisting,
    historyStore: any UsageHistoryPersisting,
    providerFactory: ((Set<ProviderID>) throws -> [any UsageProvider])? = nil,
    refresh: QuotaBarRefresh = QuotaBarRefresh()
  ) {
    self.providers = providers
    self.settings = settings
    self.store = store
    self.historyStore = historyStore
    self.providerFactory = providerFactory
    providerTimeout = refresh.timeout
    historyClient = refresh.history
    calendar = refresh.calendar
    collectionStatus = refresh.collectionStatus
    do {
      lastSuccessful = try store.load().mapValues(Self.migrateCachedSnapshot)
      for (provider, snapshot) in lastSuccessful {
        states[provider] = .available(
          snapshot.markedStale(reason: "Cached data; waiting for a provider refresh.")
        )
      }
    } catch {
      cacheErrorMessage = QuotaError.cacheCorrupt.localizedDescription
    }
    do {
      let loadedHistory = try historyStore.load()
      let compactedHistory = UsageHistory.compact(loadedHistory)
      history = compactedHistory
      if compactedHistory != loadedHistory {
        do {
          try historyStore.save(compactedHistory)
        } catch {
          historyErrorMessage = QuotaError.historyWriteFailed.localizedDescription
        }
      }
    } catch {
      historyErrorMessage = QuotaError.historyCorrupt.localizedDescription
    }
  }

  public func state(for provider: ProviderID) -> ProviderDisplayState {
    guard settings.visibleProviderIDs.contains(provider),
      settings.enabledProviders.contains(provider)
    else { return .disabled }
    return states[provider] ?? .loading
  }

  private static func migrateCachedSnapshot(_ snapshot: UsageSnapshot) -> UsageSnapshot {
    guard snapshot.provider == .claudeCode else { return snapshot }
    let removedWindowIDs = Set([
      "provider-iguana-necktie",
      "provider-nimbus-quill",
      "weekly-nimbus-quil",
      "weekly-nimbus-quill",
    ])
    let windows = snapshot.windows.filter { !removedWindowIDs.contains($0.id) }
    guard windows != snapshot.windows else { return snapshot }
    return snapshot.replacing(windows: windows)
  }

  /// The snapshot each provider shows now, for prices a provider reports itself.
  public var snapshots: [ProviderID: UsageSnapshot] {
    states.compactMapValues(\.snapshot)
  }

  public var overallStatus: QuotaStatus {
    let enabledStates = settings.visibleProviderIDs
      .filter(settings.enabledProviders.contains)
      .map(state(for:))
    guard !enabledStates.isEmpty else { return .unavailable }
    let statuses = enabledStates.map(\.quotaStatus)
    if statuses.contains(.critical) { return .critical }
    if statuses.contains(.unavailable) { return .unavailable }
    if statuses.contains(.warning) { return .warning }
    return .healthy
  }

  public func startPolling() {
    guard pollingTask == nil else { return }
    pollingTask = Task { [weak self] in
      guard let self else { return }
      await refresh()
      while !Task.isCancelled {
        do {
          try await Task.sleep(for: .seconds(settings.pollingInterval))
        } catch is CancellationError {
          return
        } catch {
          return
        }
        await refresh()
      }
    }
  }

  public func updatePollingInterval(_ interval: TimeInterval) {
    settings.setPollingInterval(interval)
    guard pollingTask != nil else { return }
    stopPolling()
    startPolling()
  }

  public func setProvider(_ provider: ProviderID, enabled: Bool) {
    settings.setProvider(provider, enabled: enabled)
    guard enabled else { return }
    states[provider] =
      lastSuccessful[provider].map {
        .available($0.markedStale(reason: "Cached data; waiting for a provider refresh."))
      } ?? .loading
    refreshAfterEnabling(provider)
  }

  public func setShowsLegacyProviders(_ showsLegacyProviders: Bool) {
    settings.setShowsLegacyProviders(showsLegacyProviders)
    guard let providerFactory else { return }
    do {
      providers = try providerFactory(settings.visibleProviderIDs)
      if showsLegacyProviders {
        for provider in ProviderID.legacy {
          states[provider] =
            lastSuccessful[provider].map {
              .available($0.markedStale(reason: "Cached data; waiting for a provider refresh."))
            } ?? .loading
        }
        Task { [weak self] in await self?.refresh() }
      }
    } catch {
      cacheErrorMessage = "Brim could not configure its provider URLs."
    }
  }

  public func refresh() async {
    if let activeRefresh {
      await activeRefresh.task.value
      clearRefresh(id: activeRefresh.id)
      return
    }
    nextRefreshID += 1
    let refreshID = nextRefreshID
    let task = Task { [weak self] in
      guard let self else { return }
      await performRefresh()
    }
    activeRefresh = ActiveRefresh(id: refreshID, task: task)
    await task.value
    clearRefresh(id: refreshID)
  }

  public func handleCredentialChange(for provider: ProviderID) async {
    let refreshAtCredentialBoundary = activeRefresh
    clearHistory(for: provider)
    invalidateCachedSnapshot(for: provider)
    if let refreshAtCredentialBoundary {
      await refreshAtCredentialBoundary.task.value
      clearRefresh(id: refreshAtCredentialBoundary.id)
      invalidateCachedSnapshot(for: provider)
    }
    await refreshEnsuringNewAttempt(for: provider)
  }

  private func performRefresh() async {
    isRefreshing = true
    defer { isRefreshing = false }
    let enabled = providers.filter {
      settings.enabledProviders.contains($0.id) && ($0.id != .muse || !isRecoveringMuse)
    }
    for provider in enabled {
      providerRefreshAttempts[provider.id, default: 0] += 1
    }
    let usageTask = Task.detached(priority: .utility) { [historyClient, calendar] in
      await Self.fetchHistoryUsage(client: historyClient, calendar: calendar, at: Date())
    }
    await withTaskGroup(of: ProviderFetchResult.self) { group in
      for provider in enabled {
        group.addTask { [providerTimeout] in
          await Self.fetch(provider: provider.id, timeout: providerTimeout) {
            try await provider.fetch()
          }
        }
      }
      for await result in group {
        apply(result)
      }
    }
    historyUsage = await usageTask.value
    // Persist even when every fetch failed: failure rounds are exactly when
    // the on-disk freshness markers change. History usage stays in memory.
    persistLastSuccessful()
  }

  private func invalidateCachedSnapshot(for provider: ProviderID) {
    lastSuccessful[provider] = nil
    states[provider] = .loading
    persistLastSuccessful()
  }

  private func persistLastSuccessful() {
    do {
      try store.save(lastSuccessful)
      let failures = Dictionary(
        uniqueKeysWithValues: ProviderID.allCases.compactMap { provider in
          let reason: String?
          switch state(for: provider) {
          case .disabled: reason = "Provider is disabled in Brim."
          case .loading: reason = "Brim has not collected this provider yet."
          default: reason = collectionFailures[provider.rawValue]
          }
          return reason.map { (provider.rawValue, $0) }
        }
      )
      try collectionStatus?.save(failures: failures, pollingInterval: settings.pollingInterval)
      cacheErrorMessage = nil
    } catch {
      cacheErrorMessage = QuotaError.cacheWriteFailed.localizedDescription
    }
  }

  public func stopPolling() {
    pollingTask?.cancel()
    pollingTask = nil
  }

  private func clearRefresh(id: Int) {
    guard activeRefresh?.id == id else { return }
    activeRefresh = nil
  }

  private func refreshAfterEnabling(_ provider: ProviderID) {
    Task { [weak self] in
      guard let self else { return }
      await refreshEnsuringNewAttempt(for: provider)
    }
  }

  private func refreshEnsuringNewAttempt(for provider: ProviderID) async {
    let previousAttemptCount = providerRefreshAttempts[provider, default: 0]
    await refresh()
    guard settings.enabledProviders.contains(provider),
      providerRefreshAttempts[provider, default: 0] == previousAttemptCount
    else { return }
    await refresh()
  }

  @discardableResult
  private func apply(_ result: ProviderFetchResult) -> Bool {
    switch result {
    case let .success(provider, snapshot):
      collectionFailures[provider.rawValue] = nil
      lastSuccessful[provider] = snapshot
      states[provider] = .available(snapshot)
      recordHistory(snapshot)
      return true
    case let .failure(provider, error):
      collectionFailures[provider.rawValue] = error.localizedDescription
      if let snapshot = lastSuccessful[provider] {
        // Publish the stale marker alongside the retained windows so the
        // persisted cache stops presenting this provider's frozen numbers
        // as current to external readers.
        let stale = snapshot.markedStale(reason: error.localizedDescription)
        lastSuccessful[provider] = stale
        states[provider] = .available(stale)
      } else if error.isAuthenticationError {
        states[provider] = .unauthenticated(message: error.localizedDescription)
      } else {
        states[provider] = .unavailable(message: error.localizedDescription)
      }
      return false
    }
  }

  private func recordHistory(_ snapshot: UsageSnapshot) {
    let samples = UsageHistorySample.samples(from: snapshot)
    guard !samples.isEmpty else { return }
    history = UsageHistory.compact(history + samples)
    do {
      try historyStore.save(history)
      historyErrorMessage = nil
    } catch {
      historyErrorMessage = QuotaError.historyWriteFailed.localizedDescription
    }
  }

  private func clearHistory(for provider: ProviderID) {
    let clearedHistory = history.filter { $0.provider != provider }
    guard clearedHistory.count != history.count else { return }
    history = clearedHistory
    do {
      try historyStore.save(history)
      historyErrorMessage = nil
    } catch {
      historyErrorMessage = QuotaError.historyWriteFailed.localizedDescription
    }
  }

  nonisolated private static func fetchHistoryUsage(
    client: HistoryClient, calendar: Calendar, at date: Date
  ) async -> Result<MenuHistoryUsage, HistoryAPIError> {
    async let report = capture { () async throws(HistoryAPIError) in
      try await client.usageReport(
        .today(breakdown: DailyUsageSummary.breakdown, at: date, calendar: calendar))
    }
    async let blocks = capture { () async throws(HistoryAPIError) in
      try await client.blocks(HistoryBlocksQuery(activeOnly: true, scope: .allMachines))
    }
    let (reportResult, blocksResult) = await (report, blocks)
    return reportResult.flatMap { report in
      blocksResult.map { blocks in
        MenuHistoryUsage(
          today: DailyUsageSummary(report), activeBlocks: blocks.activeByProvider)
      }
    }
  }

  nonisolated private static func capture<Value: Sendable>(
    _ operation: () async throws(HistoryAPIError) -> Value
  ) async -> Result<Value, HistoryAPIError> {
    do {
      return .success(try await operation())
    } catch {
      return .failure(error)
    }
  }

  nonisolated private static func fetch(
    provider: ProviderID,
    timeout: Duration,
    operation: @Sendable @escaping () async throws -> UsageSnapshot
  ) async -> ProviderFetchResult {
    await withTaskGroup(of: ProviderFetchResult.self) { group in
      group.addTask {
        do {
          return .success(provider, try await operation())
        } catch {
          return .failure(provider, classify(error: error, provider: provider))
        }
      }
      group.addTask {
        do {
          try await Task.sleep(for: timeout)
        } catch {
          return .failure(provider, .requestTimedOut(provider))
        }
        return .failure(provider, .requestTimedOut(provider))
      }
      let result = await group.next() ?? .failure(provider, .requestTimedOut(provider))
      group.cancelAll()
      return result
    }
  }

  nonisolated private static func classify(error: any Error, provider: ProviderID) -> QuotaError {
    if let quotaError = error as? QuotaError { return quotaError }
    if error is QuotaValidationError { return .malformedResponse(provider) }
    return .network(provider)
  }
}

extension QuotaBarModel {
  /// Called only by the confirmed Settings action.
  public func recoverMuseSignIn() async -> String? {
    guard !isRecoveringMuse, settings.enabledProviders.contains(.muse),
      let muse = providers.first(where: { $0.id == .muse }) as? MuseProvider
    else { return "Enable Muse in Brim before refreshing its sign-in." }
    isRecoveringMuse = true
    defer { isRecoveringMuse = false }
    if let activeRefresh {
      await activeRefresh.task.value
      clearRefresh(id: activeRefresh.id)
    }
    let result = await Self.fetch(provider: .muse, timeout: .seconds(80)) {
      try await muse.recoverSignIn()
    }
    apply(result)
    persistLastSuccessful()
    if case let .failure(_, error) = result { return error.localizedDescription }
    return nil
  }
}
