import Foundation
import Testing

@testable import QuotaBarCore

@Suite
struct BrimCollectorTests {
  @Test func collectionDistinguishesAuthenticationFailureFromUnavailability() async {
    let now = Date.now
    let codex = UsageSnapshot(provider: .codex, windows: [], sourceTimestamp: now)
    let result = await BrimCollector.collect(
      providers: [
        StubQuota(id: .codex, result: .success(codex)),
        StubQuota(id: .claudeCode, result: .failure(.credentialsMissing(.claudeCode))),
        StubQuota(id: .kimi, result: .failure(.network(.kimi))),
        StubQuota(id: .muse, result: .failure(.credentialsMissing(.muse))),
      ],
      enabled: [.codex, .claudeCode, .kimi]
    ) { platform async throws(APIPlatformError) in
      if platform == .anthropic { throw .credentialsMissing(platform) }
      return APIPlatformSnapshot(
        platform: platform, workspaceNames: [], creditsRemaining: nil, monthlySpend: 1,
        projectedSpend: 10, sourceTimestamp: now)
    }

    #expect(result.quotas.map(\.status) == [.signInRequired, .current, .unavailable, .disabled])
    #expect(result.quotas.compactMap(\.snapshot) == [codex])
    #expect(result.billing.map(\.status) == [.signInRequired, .current])
    #expect(result.billing.compactMap(\.snapshot).map(\.platform) == [.openAI])
  }

  @Test func failedCollectionRetainsPendingHistoryAndImportsLegacyOnlyOnce() async throws {
    let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let legacy = JSONUsageHistoryStore(url: directory.appending(path: "history.json"))
    let history = BrimCollectorHistory(
      legacy: legacy, stateURL: directory.appending(path: "collector/pending.json"))
    let now = Date.now
    let existing = try UsageHistorySample(
      provider: .codex, windowID: "weekly", label: "Weekly", kind: .weekly, usedPercent: 8,
      resetAt: nil, recordedAt: now.addingTimeInterval(-60))
    try legacy.save([existing])

    let current = try UsageWindow.validated(
      id: "weekly", label: "Weekly", kind: .weekly, usedPercent: 11,
      resetAt: nil, sourceTimestamp: now)
    let collection = BrimCollection(
      collectedAt: now,
      quotas: [
        BrimQuotaObservation(
          provider: .codex, status: .current,
          snapshot: UsageSnapshot(provider: .codex, windows: [current], sourceTimestamp: now))
      ],
      billing: [])

    await #expect(throws: DemoFailure.self) {
      try await BrimCollector.send(collection, history: history) { _, samples in
        #expect(samples.map(\.usedPercent) == [8, 11])
        throw DemoFailure.unacknowledged
      }
    }
    let retry = BrimCollection(collectedAt: now, quotas: [], billing: [])
    try await BrimCollector.send(retry, history: history) { _, samples in
      #expect(samples.map(\.usedPercent) == [8, 11])
    }
    try await BrimCollector.send(retry, history: history) { _, samples in
      #expect(samples.isEmpty)
    }
  }

  @Test func publisherRejectsCredentialsInURLsAndUnsecuredURLs() {
    #expect(throws: (any Error).self) {
      try BrimCollectorPublisher(baseURL: "http://brim.example.test", token: "fixture")
    }
    #expect(throws: (any Error).self) {
      try BrimCollectorPublisher(baseURL: "https://fixture@brim.example.test", token: "fixture")
    }
    #expect(throws: (any Error).self) {
      try BrimCollectorPublisher(baseURL: "https://brim.example.test", token: "injected\nheader")
    }
  }
}

private struct StubQuota: UsageProvider {
  let id: ProviderID
  let result: Result<UsageSnapshot, QuotaError>

  func fetch() async throws -> UsageSnapshot { try result.get() }
}

private enum DemoFailure: Error {
  case unacknowledged
}
