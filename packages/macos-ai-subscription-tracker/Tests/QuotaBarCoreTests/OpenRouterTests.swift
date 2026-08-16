import Foundation
import XCTest

@testable import QuotaBarCore

final class OpenRouterTests: XCTestCase {
  func testFetchSnapshotAggregatesAllWorkspacesAndKeys() async throws {
    let endpoints = testEndpoints()
    let transport = OpenRouterRoutingTransport(
      routes: [
        endpoints.credits().absoluteString: response(fixture("openrouter-credits")),
        endpoints.workspaces(offset: 0, limit: 100).absoluteString:
          response(fixture("openrouter-workspaces-page-0")),
        endpoints.workspaces(offset: 1, limit: 100).absoluteString:
          response(fixture("openrouter-workspaces-page-1")),
        endpoints.keys(workspaceID: "workspace-production", offset: 0).absoluteString:
          response(fixture("openrouter-keys-production")),
        endpoints.keys(workspaceID: "workspace-development", offset: 0).absoluteString:
          response(fixture("openrouter-keys-development")),
      ])
    let client = OpenRouterAPIClient(transport: transport, endpoints: endpoints)

    let snapshot = try await client.fetchSnapshot(
      managementKey: "management-secret",
      now: date("2026-08-16T12:00:00Z"),
      timeZone: utcTimeZone()
    )

    XCTAssertEqual(snapshot.workspaceNames, ["Development", "Production"])
    XCTAssertEqual(snapshot.creditsRemaining, Decimal(string: "60"))
    XCTAssertEqual(snapshot.monthlySpend, Decimal(string: "4.5"))
    XCTAssertEqual(snapshot.projectedSpend, Decimal(string: "8.71875"))
    XCTAssertEqual(snapshot.sourceTimestamp, date("2026-08-16T12:00:00Z"))

    let requests = await transport.requests
    XCTAssertEqual(requests.count, 5)
    XCTAssertTrue(requests.allSatisfy { $0.method == .get })
    XCTAssertTrue(requests.allSatisfy { !$0.description.contains("management-secret") })
    XCTAssertTrue(
      requests.contains {
        $0.url.query?.contains("include_disabled=true") == true
      }
    )
  }

  func testProjectionUsesLocalCalendarMonthLength() async throws {
    let endpoints = testEndpoints()
    let transport = OpenRouterRoutingTransport(
      routes: [
        endpoints.credits().absoluteString: response(
          Data(#"{ "data": { "total_credits": 20, "total_usage": 0 } }"#.utf8)
        ),
        endpoints.workspaces(offset: 0, limit: 100).absoluteString: response(
          Data(#"{ "data": [{ "id": "default", "name": "Default" }], "total_count": 1 }"#.utf8)
        ),
        endpoints.keys(workspaceID: "default", offset: 0).absoluteString: response(
          Data(#"{ "data": [{ "usage_monthly": 28, "byok_usage_monthly": 0 }] }"#.utf8)
        ),
      ])
    let client = OpenRouterAPIClient(transport: transport, endpoints: endpoints)
    let snapshot = try await client.fetchSnapshot(
      managementKey: "secret",
      now: date("2026-02-28T12:00:00Z"),
      timeZone: utcTimeZone()
    )

    XCTAssertEqual(snapshot.monthlySpend, Decimal(string: "28"))
    XCTAssertEqual(snapshot.projectedSpend, Decimal(string: "28"))
  }

  func testHTTPStatusesAndMalformedResponsesAreExplicit() async throws {
    let endpoints = testEndpoints()
    let unauthorized = OpenRouterAPIClient(
      transport: OpenRouterRoutingTransport(
        routes: [
          endpoints.credits().absoluteString: OpenRouterResponse(statusCode: 401, data: Data())
        ]
      ),
      endpoints: endpoints
    )
    do {
      _ = try await unauthorized.fetchSnapshot(managementKey: "secret")
      XCTFail("Expected unauthorized error")
    } catch let error as APIPlatformError {
      XCTAssertEqual(error, .unauthorized)
    }

    let malformed = OpenRouterAPIClient(
      transport: OpenRouterRoutingTransport(
        routes: [endpoints.credits().absoluteString: response(fixture("openrouter-malformed"))]
      ),
      endpoints: endpoints
    )
    do {
      _ = try await malformed.fetchSnapshot(managementKey: "secret")
      XCTFail("Expected malformed response error")
    } catch let error as APIPlatformError {
      XCTAssertEqual(error, .malformedResponse)
    }
  }

  func testOpenRouterCredentialUsesDedicatedKeychainEntry() async throws {
    let keychain = FakeKeychain()
    let store = OpenRouterCredentialStore(keychain: keychain)

    let initialToken = try await store.token()
    XCTAssertNil(initialToken)
    try await store.save("  management-secret  ")
    let savedToken = try await store.token()
    XCTAssertEqual(savedToken, "management-secret")
    try await store.remove()
    let removedToken = try await store.token()
    XCTAssertNil(removedToken)

    XCTAssertNil(
      try keychain.read(
        service: ManualCredentialStore.service,
        account: ProviderID.codex.rawValue
      )
    )
  }

  func testAPIPlatformCacheContainsNoCredential() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let url = root.appendingPathComponent("api-platform-snapshot.json")
    let store = JSONAPIPlatformSnapshotStore(url: url)
    let snapshot = APIPlatformSnapshot(
      workspaceNames: ["Default"],
      creditsRemaining: decimal("10"),
      monthlySpend: decimal("2.5"),
      projectedSpend: decimal("5"),
      sourceTimestamp: date("2026-08-16T12:00:00Z")
    )

    try store.save(snapshot)

    let cached = try Data(contentsOf: url)
    XCTAssertFalse(String(data: cached, encoding: .utf8)?.contains("management-secret") == true)
    XCTAssertEqual(try store.load(), snapshot)
    try store.remove()
    XCTAssertNil(try store.load())
  }

  @MainActor
  func testAPIPlatformModelReportsUnauthenticatedWithoutKey() async {
    let settings = AppSettings(store: APISettingsStore())
    let model = APIPlatformModel(
      settings: settings,
      credentials: OpenRouterCredentialStore(keychain: FakeKeychain()),
      store: MemoryAPIPlatformStore()
    )

    await model.refresh()

    guard case let .unauthenticated(message) = model.state else {
      XCTFail("Expected missing-key state")
      return
    }
    XCTAssertEqual(message, APIPlatformError.credentialsMissing.localizedDescription)
  }

  @MainActor
  func testAPIPlatformModelRetainsCachedSnapshotAsStale() async throws {
    let endpoints = testEndpoints()
    let keychain = FakeKeychain()
    let credentials = OpenRouterCredentialStore(keychain: keychain)
    try await credentials.save("secret")
    let cached = APIPlatformSnapshot(
      workspaceNames: ["Default"],
      creditsRemaining: decimal("10"),
      monthlySpend: decimal("2"),
      projectedSpend: decimal("4"),
      sourceTimestamp: date("2026-08-16T11:00:00Z")
    )
    let store = MemoryAPIPlatformStore(loaded: cached)
    let model = APIPlatformModel(
      settings: AppSettings(store: APISettingsStore()),
      client: OpenRouterAPIClient(
        transport: OpenRouterRoutingTransport(
          routes: [
            endpoints.credits().absoluteString: OpenRouterResponse(statusCode: 401, data: Data())
          ]
        ),
        endpoints: endpoints
      ),
      credentials: credentials,
      store: store
    )

    await model.refresh()

    guard case let .stale(snapshot, reason) = model.state else {
      XCTFail("Expected stale cached state")
      return
    }
    XCTAssertEqual(snapshot, cached)
    XCTAssertEqual(reason, APIPlatformError.unauthorized.localizedDescription)
  }

  private func response(_ data: Data) -> OpenRouterResponse {
    OpenRouterResponse(statusCode: 200, data: data)
  }
}

private func testEndpoints() -> OpenRouterEndpoints {
  guard let url = URL(string: "https://openrouter.test") else {
    preconditionFailure("Invalid test endpoint")
  }
  return OpenRouterEndpoints(baseURL: url)
}

private func utcTimeZone() -> TimeZone {
  guard let timeZone = TimeZone(secondsFromGMT: 0) else {
    preconditionFailure("Invalid UTC test time zone")
  }
  return timeZone
}

private func decimal(_ value: String) -> Decimal {
  guard let result = Decimal(string: value) else {
    preconditionFailure("Invalid test decimal")
  }
  return result
}

private final class APISettingsStore: SettingsPersisting, @unchecked Sendable {
  func enabledProviders() throws -> Set<ProviderID>? { Set(ProviderID.allCases) }
  func pollingInterval() throws -> TimeInterval? { 300 }
  func save(enabledProviders _: Set<ProviderID>, pollingInterval _: TimeInterval) {}
}

private final class MemoryAPIPlatformStore: APIPlatformSnapshotPersisting, @unchecked Sendable {
  private let lock = NSLock()
  private var snapshot: APIPlatformSnapshot?

  init(loaded: APIPlatformSnapshot? = nil) {
    snapshot = loaded
  }

  func load() throws -> APIPlatformSnapshot? {
    lock.withLock { snapshot }
  }

  func save(_ snapshot: APIPlatformSnapshot) throws {
    lock.withLock { self.snapshot = snapshot }
  }

  func remove() throws {
    lock.withLock { snapshot = nil }
  }
}

private actor OpenRouterRoutingTransport: OpenRouterTransport {
  private let routes: [String: OpenRouterResponse]
  private(set) var requests: [OpenRouterRequest] = []

  init(routes: [String: OpenRouterResponse]) {
    self.routes = routes
  }

  func send(_ request: OpenRouterRequest) throws -> OpenRouterResponse {
    requests.append(request)
    guard let response = routes[request.url.absoluteString] else {
      throw APIPlatformError.network
    }
    return response
  }
}
