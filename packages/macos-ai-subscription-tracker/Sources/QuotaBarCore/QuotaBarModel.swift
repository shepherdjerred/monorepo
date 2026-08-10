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

@MainActor @Observable
public final class QuotaBarModel {
  public let providers: [any UsageProvider]
  public let settings: AppSettings
  public private(set) var states: [ProviderID: ProviderDisplayState] = [:]
  public private(set) var isRefreshing = false
  public private(set) var cacheErrorMessage: String?

  private let store: any SnapshotPersisting
  private let providerTimeout: Duration
  private var lastSuccessful: [ProviderID: UsageSnapshot] = [:]
  private var pollingTask: Task<Void, Never>?
  private var activeRefresh: ActiveRefresh?
  private var nextRefreshID = 0
  private var providerRefreshAttempts: [ProviderID: Int] = [:]

  public init(
    providers: [any UsageProvider],
    settings: AppSettings,
    store: any SnapshotPersisting = JSONSnapshotStore(),
    providerTimeout: Duration = .seconds(25)
  ) {
    self.providers = providers
    self.settings = settings
    self.store = store
    self.providerTimeout = providerTimeout
    do {
      lastSuccessful = try store.load()
      for (provider, snapshot) in lastSuccessful {
        states[provider] = .available(
          snapshot.markedStale(reason: "Cached data; waiting for a provider refresh.")
        )
      }
    } catch {
      cacheErrorMessage = QuotaError.cacheCorrupt.localizedDescription
    }
  }

  public func state(for provider: ProviderID) -> ProviderDisplayState {
    guard settings.enabledProviders.contains(provider) else { return .disabled }
    return states[provider] ?? .loading
  }

  public var overallStatus: QuotaStatus {
    let enabledStates = ProviderID.allCases
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
    let wasPolling = pollingTask != nil
    stopPolling()
    if wasPolling { startPolling() }
  }

  public func setProvider(_ provider: ProviderID, enabled: Bool) {
    settings.setProvider(provider, enabled: enabled)
    if enabled {
      states[provider] =
        lastSuccessful[provider].map {
          .available($0.markedStale(reason: "Cached data; waiting for a provider refresh."))
        } ?? .loading
      let previousAttemptCount = providerRefreshAttempts[provider, default: 0]
      Task { [weak self] in
        guard let self else { return }
        await refresh()
        guard settings.enabledProviders.contains(provider),
          providerRefreshAttempts[provider, default: 0] == previousAttemptCount
        else { return }
        await refresh()
      }
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

  private func performRefresh() async {
    isRefreshing = true
    defer { isRefreshing = false }
    let enabled = providers.filter { settings.enabledProviders.contains($0.id) }
    for provider in enabled {
      providerRefreshAttempts[provider.id, default: 0] += 1
    }
    let didSucceed = await withTaskGroup(of: ProviderFetchResult.self) { group in
      for provider in enabled {
        group.addTask { [providerTimeout] in
          await Self.fetch(provider: provider, timeout: providerTimeout)
        }
      }
      var didSucceed = false
      for await result in group where apply(result) {
        didSucceed = true
      }
      return didSucceed
    }
    guard didSucceed else { return }
    do {
      try store.save(lastSuccessful)
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

  private func apply(_ result: ProviderFetchResult) -> Bool {
    switch result {
    case let .success(provider, snapshot):
      lastSuccessful[provider] = snapshot
      states[provider] = .available(snapshot)
      return true
    case let .failure(provider, error):
      if let snapshot = lastSuccessful[provider] {
        states[provider] = .available(snapshot.markedStale(reason: error.localizedDescription))
      } else if error.isAuthenticationError {
        states[provider] = .unauthenticated(message: error.localizedDescription)
      } else {
        states[provider] = .unavailable(message: error.localizedDescription)
      }
      return false
    }
  }

  nonisolated private static func fetch(
    provider: any UsageProvider,
    timeout: Duration
  ) async -> ProviderFetchResult {
    await withTaskGroup(of: ProviderFetchResult.self) { group in
      group.addTask {
        do {
          return .success(provider.id, try await provider.fetch())
        } catch let error as QuotaError {
          return .failure(provider.id, error)
        } catch {
          return .failure(provider.id, .network(provider.id))
        }
      }
      group.addTask {
        do {
          try await Task.sleep(for: timeout)
        } catch {
          return .failure(provider.id, .requestTimedOut(provider.id))
        }
        return .failure(provider.id, .requestTimedOut(provider.id))
      }
      let result = await group.next() ?? .failure(provider.id, .requestTimedOut(provider.id))
      group.cancelAll()
      return result
    }
  }
}
