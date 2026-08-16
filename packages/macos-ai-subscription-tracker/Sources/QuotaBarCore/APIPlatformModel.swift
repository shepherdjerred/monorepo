public import Foundation
public import Observation

@MainActor @Observable
public final class APIPlatformModel {
  public let settings: AppSettings
  public private(set) var state: APIPlatformDisplayState = .loading
  public private(set) var isRefreshing = false
  public private(set) var cacheErrorMessage: String?

  private let client: OpenRouterAPIClient
  private let credentials: OpenRouterCredentialStore
  private let store: any APIPlatformSnapshotPersisting
  private let providerTimeout: Duration
  private var lastSuccessful: APIPlatformSnapshot?
  private var pollingTask: Task<Void, Never>?
  private var activeRefresh: Task<Void, Never>?

  public init(
    settings: AppSettings,
    client: OpenRouterAPIClient = OpenRouterAPIClient(),
    credentials: OpenRouterCredentialStore = OpenRouterCredentialStore(),
    store: any APIPlatformSnapshotPersisting = JSONAPIPlatformSnapshotStore(),
    providerTimeout: Duration = .seconds(25)
  ) {
    self.settings = settings
    self.client = client
    self.credentials = credentials
    self.store = store
    self.providerTimeout = providerTimeout
    do {
      if let snapshot = try store.load() {
        lastSuccessful = snapshot
        state = .stale(snapshot, reason: "Cached data; waiting for an OpenRouter refresh.")
      }
    } catch {
      cacheErrorMessage = APIPlatformError.cacheCorrupt.localizedDescription
    }
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

  public func stopPolling() {
    pollingTask?.cancel()
    pollingTask = nil
  }

  public func updatePollingInterval(_ interval: TimeInterval) {
    settings.setPollingInterval(interval)
    guard pollingTask != nil else { return }
    stopPolling()
    startPolling()
  }

  public func refresh() async {
    if let activeRefresh {
      await activeRefresh.value
      return
    }
    let task = Task { [weak self] in
      guard let self else { return }
      await self.performRefresh()
    }
    activeRefresh = task
    await task.value
    activeRefresh = nil
  }

  public func handleCredentialChange() async {
    lastSuccessful = nil
    state = .loading
    do {
      try store.remove()
      cacheErrorMessage = nil
    } catch {
      cacheErrorMessage = APIPlatformError.cacheWriteFailed.localizedDescription
    }
    await refresh()
  }

  private func performRefresh() async {
    isRefreshing = true
    defer { isRefreshing = false }

    do {
      guard let token = try await credentials.token() else {
        state = .unauthenticated(message: APIPlatformError.credentialsMissing.localizedDescription)
        return
      }
      let snapshot = try await Self.fetch(
        client: client,
        managementKey: token,
        timeout: providerTimeout
      )
      lastSuccessful = snapshot
      state = .available(snapshot)
      do {
        try store.save(snapshot)
        cacheErrorMessage = nil
      } catch {
        cacheErrorMessage = APIPlatformError.cacheWriteFailed.localizedDescription
      }
    } catch {
      let apiError = Self.classify(error: error)
      if let lastSuccessful {
        state = .stale(lastSuccessful, reason: apiError.localizedDescription)
      } else if apiError.isAuthenticationError {
        state = .unauthenticated(message: apiError.localizedDescription)
      } else {
        state = .unavailable(message: apiError.localizedDescription)
      }
    }
  }

  nonisolated private static func fetch(
    client: OpenRouterAPIClient,
    managementKey: String,
    timeout: Duration
  ) async throws -> APIPlatformSnapshot {
    try await withThrowingTaskGroup(of: APIPlatformSnapshot.self) { group in
      group.addTask {
        try await client.fetchSnapshot(managementKey: managementKey)
      }
      group.addTask {
        try await Task.sleep(for: timeout)
        throw APIPlatformError.requestTimedOut
      }
      defer { group.cancelAll() }
      guard let result = try await group.next() else {
        throw APIPlatformError.requestTimedOut
      }
      return result
    }
  }

  nonisolated private static func classify(error: any Error) -> APIPlatformError {
    if let apiError = error as? APIPlatformError { return apiError }
    if let quotaError = error as? QuotaError, case let .keychain(status) = quotaError {
      return .keychain(status: status)
    }
    return .network
  }
}
