import Foundation
import XCTest

@testable import QuotaBarCore

final class APIPlatformModelTests: XCTestCase {
  func testAPIPlatformCredentialsUseIsolatedKeychainAccounts() async throws {
    let keychain = FakeKeychain()
    let store = APIPlatformCredentialStore(keychain: keychain)

    try await store.save("  openai-secret  ", for: .openAI)
    try await store.save("anthropic-secret", for: .anthropic)
    let openAIToken = try await store.token(for: .openAI)
    let anthropicToken = try await store.token(for: .anthropic)
    XCTAssertEqual(openAIToken, "openai-secret")
    XCTAssertEqual(anthropicToken, "anthropic-secret")

    try await store.remove(for: .openAI)
    let removedOpenAI = try await store.token(for: .openAI)
    let remainingAnthropic = try await store.token(for: .anthropic)
    XCTAssertNil(removedOpenAI)
    XCTAssertEqual(remainingAnthropic, "anthropic-secret")
    XCTAssertNil(
      try keychain.read(
        service: ManualCredentialStore.service,
        account: ProviderID.codex.rawValue
      )
    )
  }

  func testAPIPlatformCacheMigratesLegacySingleSnapshotAndOmitsSecrets() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let url = root.appendingPathComponent("api-platform-snapshot.json")
    let store = JSONAPIPlatformSnapshotStore(url: url)
    let snapshot = openAISnapshot()
    try JSONEncoder().encode(snapshot).write(to: url)

    XCTAssertEqual(try store.load(), [.openAI: snapshot])

    try store.save([.openAI: snapshot])
    let cached = try Data(contentsOf: url)
    XCTAssertFalse(String(data: cached, encoding: .utf8)?.contains("admin-secret") == true)
    XCTAssertEqual(try store.load(), [.openAI: snapshot])
    try store.remove()
    XCTAssertEqual(try store.load(), [:])
  }

  func testAPIPlatformCacheDropsRetiredOpenRouterSnapshots() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let url = root.appendingPathComponent("api-platform-snapshot.json")
    let store = JSONAPIPlatformSnapshotStore(url: url)
    let snapshot = openAISnapshot()
    try JSONEncoder().encode(snapshot).write(to: url)
    let current = try XCTUnwrap(String(data: Data(contentsOf: url), encoding: .utf8))
    let retired = current.replacingOccurrences(of: #""openai""#, with: #""openrouter""#)

    // A cache written while OpenRouter was supported is a known migration.
    try Data(#"{ "snapshots": [\#(retired), \#(current)] }"#.utf8).write(to: url)
    XCTAssertEqual(try store.load(), [.openAI: snapshot])
    try Data(retired.utf8).write(to: url)
    XCTAssertEqual(try store.load(), [:])

    // A platform Brim never supported is still corruption.
    let unknown = current.replacingOccurrences(of: #""openai""#, with: #""unknown""#)
    try Data(#"{ "snapshots": [\#(unknown)] }"#.utf8).write(to: url)
    XCTAssertThrowsError(try store.load()) { error in
      XCTAssertEqual(error as? APIPlatformError, .cacheCorrupt)
    }
  }

  @MainActor
  func testAPIPlatformModelReportsUnauthenticatedWithoutKey() async {
    let settings = AppSettings(store: APISettingsStore())
    let model = APIPlatformModel(
      settings: settings,
      credentials: APIPlatformCredentialStore(keychain: FakeKeychain()),
      store: MemoryAPIPlatformStore()
    )

    await model.refresh()

    guard case let .unauthenticated(message) = model.state(for: .openAI) else {
      XCTFail("Expected missing-key state")
      return
    }
    XCTAssertEqual(message, APIPlatformError.credentialsMissing(.openAI).localizedDescription)
    guard case .unauthenticated = model.state(for: .anthropic) else {
      XCTFail("Expected Anthropic missing-key state")
      return
    }
  }

  @MainActor
  func testAPIPlatformModelRetainsCachedSnapshotAsStale() async throws {
    let credentials = APIPlatformCredentialStore(keychain: FakeKeychain())
    try await credentials.save("secret", for: .openAI)
    let cached = openAISnapshot()
    let store = MemoryAPIPlatformStore(loaded: [.openAI: cached])
    let model = APIPlatformModel(
      settings: AppSettings(store: APISettingsStore()),
      openAI: OpenAIAPIClient(
        transport: APIPlatformFixedTransport(
          response: APIPlatformResponse(statusCode: 401, data: Data())),
        endpoints: testOpenAIEndpoints()
      ),
      credentials: credentials,
      store: store
    )

    await model.refresh()

    guard case let .stale(snapshot, reason) = model.state(for: .openAI) else {
      XCTFail("Expected stale cached state")
      return
    }
    XCTAssertEqual(snapshot, cached)
    XCTAssertEqual(reason, APIPlatformError.unauthorized(.openAI).localizedDescription)
  }

  @MainActor
  func testAPIPlatformCredentialChangeDiscardsActiveRefresh() async throws {
    let credentials = APIPlatformCredentialStore(keychain: FakeKeychain())
    try await credentials.save("secret", for: .openAI)
    let transport = APIPlatformFixedTransport(
      response: response(fixture("openai-costs")),
      delay: .milliseconds(80)
    )
    let store = MemoryAPIPlatformStore()
    let model = APIPlatformModel(
      settings: AppSettings(store: APISettingsStore()),
      openAI: OpenAIAPIClient(transport: transport, endpoints: testOpenAIEndpoints()),
      credentials: credentials,
      store: store
    )

    let activeRefresh = Task { await model.refresh() }
    for _ in 0..<50 {
      if await transport.requestCount >= 1 { break }
      try? await Task.sleep(for: .milliseconds(10))
    }
    try await credentials.remove(for: .openAI)
    await model.handleCredentialChange(for: .openAI)
    await activeRefresh.value

    guard case .unauthenticated = model.state(for: .openAI) else {
      XCTFail("Expected the in-flight snapshot to be discarded")
      return
    }
    XCTAssertNil(try store.load()[.openAI])
    XCTAssertFalse(model.isRefreshing)
  }
}

private func openAISnapshot() -> APIPlatformSnapshot {
  APIPlatformSnapshot(
    platform: .openAI,
    workspaceNames: ["Default"],
    creditsRemaining: nil,
    monthlySpend: decimal("2"),
    projectedSpend: decimal("4"),
    sourceTimestamp: date("2026-08-16T11:00:00Z")
  )
}

/// Answers every request with one response. The model fetches with the real
/// clock, so request URLs carry the current time and cannot be routed exactly.
private actor APIPlatformFixedTransport: APIPlatformTransport {
  private let response: APIPlatformResponse
  private let delay: Duration
  private(set) var requestCount = 0

  init(response: APIPlatformResponse, delay: Duration = .zero) {
    self.response = response
    self.delay = delay
  }

  func send(_: APIPlatformRequest) async throws -> APIPlatformResponse {
    requestCount += 1
    if delay > .zero {
      try await Task.sleep(for: delay)
    }
    return response
  }
}

private final class APISettingsStore: SettingsPersisting, Sendable {
  func enabledProviders() throws -> Set<ProviderID>? { Set(ProviderID.allCases) }
  func showsLegacyProviders() throws -> Bool? { true }
  func pollingInterval() throws -> TimeInterval? { 300 }
  func save(
    enabledProviders _: Set<ProviderID>,
    showsLegacyProviders _: Bool,
    pollingInterval _: TimeInterval
  ) {}
}

private final class MemoryAPIPlatformStore: APIPlatformSnapshotPersisting, @unchecked Sendable {
  private let lock = NSLock()
  private var snapshots: [APIPlatformID: APIPlatformSnapshot]

  init(loaded: [APIPlatformID: APIPlatformSnapshot] = [:]) {
    snapshots = loaded
  }

  func load() throws -> [APIPlatformID: APIPlatformSnapshot] {
    lock.withLock { snapshots }
  }

  func save(_ snapshots: [APIPlatformID: APIPlatformSnapshot]) throws {
    lock.withLock { self.snapshots = snapshots }
  }

  func remove() throws {
    lock.withLock { snapshots = [:] }
  }
}
