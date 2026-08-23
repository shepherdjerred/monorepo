import Foundation

@testable import QuotaBarCore

actor FakeProvider: UsageProvider {
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

final class MemoryHistoryStore: UsageHistoryPersisting, @unchecked Sendable {
  private let loadError: QuotaError?
  private(set) var saved: [UsageHistorySample] = []

  init(saved: [UsageHistorySample] = [], loadError: QuotaError? = nil) {
    self.saved = saved
    self.loadError = loadError
  }

  func load() throws -> [UsageHistorySample] {
    if let loadError { throw loadError }
    return saved
  }

  func save(_ samples: [UsageHistorySample]) throws {
    saved = samples
  }
}
