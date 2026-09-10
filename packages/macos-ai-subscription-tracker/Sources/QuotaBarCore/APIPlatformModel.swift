public import Foundation
public import Observation

@MainActor @Observable
public final class APIPlatformModel {
  public let settings: AppSettings
  public private(set) var states: [APIPlatformID: APIPlatformDisplayState]
  public private(set) var isRefreshing = false
  public private(set) var cacheErrorMessage: String?

  private let openRouter: OpenRouterAPIClient
  private let openAI: OpenAIAPIClient
  private let anthropic: AnthropicAPIClient
  private let credentials: APIPlatformCredentialStore
  private let store: any APIPlatformSnapshotPersisting
  private let providerTimeout: Duration
  private var lastSuccessful: [APIPlatformID: APIPlatformSnapshot] = [:]
  private var pollingTask: Task<Void, Never>?
  private var activeRefresh: Task<Void, Never>?

  public init(
    settings: AppSettings,
    openRouter: OpenRouterAPIClient = OpenRouterAPIClient(),
    openAI: OpenAIAPIClient = OpenAIAPIClient(),
    anthropic: AnthropicAPIClient = AnthropicAPIClient(),
    credentials: APIPlatformCredentialStore = APIPlatformCredentialStore(),
    store: any APIPlatformSnapshotPersisting = JSONAPIPlatformSnapshotStore(),
    providerTimeout: Duration = .seconds(25)
  ) {
    self.settings = settings
    self.openRouter = openRouter
    self.openAI = openAI
    self.anthropic = anthropic
    self.credentials = credentials
    self.store = store
    self.providerTimeout = providerTimeout
    var states = Dictionary(
      uniqueKeysWithValues: APIPlatformID.allCases.map { ($0, APIPlatformDisplayState.loading) }
    )
    do {
      let loaded = try store.load()
      lastSuccessful = loaded
      for (platform, snapshot) in loaded {
        states[platform] = .stale(
          snapshot, reason: "Cached data; waiting for a \(platform.displayName) refresh.")
      }
    } catch {
      cacheErrorMessage = APIPlatformError.cacheCorrupt.localizedDescription
    }
    self.states = states
  }

  public func state(for platform: APIPlatformID) -> APIPlatformDisplayState {
    states[platform] ?? .loading
  }

  public var lastUpdatedAt: Date? {
    states.values.compactMap { state -> Date? in
      switch state {
      case let .available(snapshot), let .stale(snapshot, _):
        snapshot.sourceTimestamp
      case .loading, .unavailable, .unauthenticated:
        nil
      }
    }.max()
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
      await self.performRefresh(platforms: Array(APIPlatformID.allCases))
    }
    activeRefresh = task
    await task.value
    activeRefresh = nil
  }

  public func handleCredentialChange(for platform: APIPlatformID) async {
    lastSuccessful[platform] = nil
    states[platform] = .loading
    var remaining = lastSuccessful
    remaining[platform] = nil
    do {
      try store.save(remaining)
      cacheErrorMessage = nil
    } catch {
      cacheErrorMessage = APIPlatformError.cacheWriteFailed.localizedDescription
    }
    await performRefresh(platforms: [platform])
  }

  private func performRefresh(platforms: [APIPlatformID]) async {
    isRefreshing = true
    defer { isRefreshing = false }

    await withTaskGroup(of: APIPlatformFetchResult.self) { group in
      for platform in platforms {
        group.addTask { [weak self] in
          guard let self else {
            return APIPlatformFetchResult(
              platform: platform,
              state: .unavailable(message: "Cancelled"),
              snapshot: nil
            )
          }
          return await self.fetchState(for: platform)
        }
      }
      for await result in group {
        states[result.platform] = result.state
        if let snapshot = result.snapshot {
          lastSuccessful[result.platform] = snapshot
        }
      }
    }

    do {
      try store.save(lastSuccessful)
      cacheErrorMessage = nil
    } catch {
      cacheErrorMessage = APIPlatformError.cacheWriteFailed.localizedDescription
    }
  }

  private func fetchState(for platform: APIPlatformID) async -> APIPlatformFetchResult {
    do {
      guard let token = try await credentials.token(for: platform) else {
        return APIPlatformFetchResult(
          platform: platform,
          state: .unauthenticated(
            message: APIPlatformError.credentialsMissing(platform).localizedDescription),
          snapshot: nil
        )
      }
      let snapshot = try await Self.fetch(
        platform: platform,
        openRouter: openRouter,
        openAI: openAI,
        anthropic: anthropic,
        token: token,
        timeout: providerTimeout
      )
      return APIPlatformFetchResult(
        platform: platform, state: .available(snapshot), snapshot: snapshot)
    } catch {
      let apiError = Self.classify(error: error, platform: platform)
      if let cached = lastSuccessful[platform] {
        return APIPlatformFetchResult(
          platform: platform,
          state: .stale(cached, reason: apiError.localizedDescription),
          snapshot: nil
        )
      }
      if apiError.isAuthenticationError {
        return APIPlatformFetchResult(
          platform: platform,
          state: .unauthenticated(message: apiError.localizedDescription),
          snapshot: nil
        )
      }
      return APIPlatformFetchResult(
        platform: platform,
        state: .unavailable(message: apiError.localizedDescription),
        snapshot: nil
      )
    }
  }

  nonisolated private static func fetch(
    platform: APIPlatformID,
    openRouter: OpenRouterAPIClient,
    openAI: OpenAIAPIClient,
    anthropic: AnthropicAPIClient,
    token: String,
    timeout: Duration
  ) async throws -> APIPlatformSnapshot {
    try await withThrowingTaskGroup(of: APIPlatformSnapshot.self) { group in
      group.addTask {
        switch platform {
        case .openRouter:
          try await openRouter.fetchSnapshot(token: token)
        case .openAI:
          try await openAI.fetchSnapshot(token: token)
        case .anthropic:
          try await anthropic.fetchSnapshot(token: token)
        }
      }
      group.addTask {
        try await Task.sleep(for: timeout)
        throw APIPlatformError.requestTimedOut(platform)
      }
      defer { group.cancelAll() }
      guard let result = try await group.next() else {
        throw APIPlatformError.requestTimedOut(platform)
      }
      return result
    }
  }

  nonisolated private static func classify(error: any Error, platform: APIPlatformID)
    -> APIPlatformError
  {
    if let apiError = error as? APIPlatformError { return apiError }
    if let quotaError = error as? QuotaError, case let .keychain(status) = quotaError {
      return .keychain(platform, status: status)
    }
    return .network(platform)
  }
}

private struct APIPlatformFetchResult: Sendable {
  let platform: APIPlatformID
  let state: APIPlatformDisplayState
  let snapshot: APIPlatformSnapshot?
}
