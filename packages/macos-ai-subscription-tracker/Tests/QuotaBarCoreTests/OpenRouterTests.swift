import Foundation
import XCTest

@testable import QuotaBarCore

final class OpenRouterTests: XCTestCase {
  func testFetchSnapshotAggregatesAllWorkspacesAndKeys() async throws {
    let endpoints = testOpenRouterEndpoints()
    let transport = APIPlatformRoutingTransport(
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
      token: "management-secret",
      now: date("2026-08-16T12:00:00Z"),
      timeZone: utcTimeZone()
    )

    XCTAssertEqual(snapshot.platform, .openRouter)
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
    let endpoints = testOpenRouterEndpoints()
    let transport = APIPlatformRoutingTransport(
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
      token: "secret",
      now: date("2026-02-28T12:00:00Z"),
      timeZone: utcTimeZone()
    )

    XCTAssertEqual(snapshot.monthlySpend, Decimal(string: "28"))
    XCTAssertEqual(snapshot.projectedSpend, Decimal(string: "28"))
  }

  func testHTTPStatusesAndMalformedResponsesAreExplicit() async throws {
    let endpoints = testOpenRouterEndpoints()
    let unauthorized = OpenRouterAPIClient(
      transport: APIPlatformRoutingTransport(
        routes: [
          endpoints.credits().absoluteString: APIPlatformResponse(statusCode: 401, data: Data())
        ]
      ),
      endpoints: endpoints
    )
    do {
      _ = try await unauthorized.fetchSnapshot(token: "secret")
      XCTFail("Expected unauthorized error")
    } catch let error as APIPlatformError {
      XCTAssertEqual(error, .unauthorized(.openRouter))
    }

    let malformed = OpenRouterAPIClient(
      transport: APIPlatformRoutingTransport(
        routes: [endpoints.credits().absoluteString: response(fixture("openrouter-malformed"))]
      ),
      endpoints: endpoints
    )
    do {
      _ = try await malformed.fetchSnapshot(token: "secret")
      XCTFail("Expected malformed response")
    } catch let error as APIPlatformError {
      XCTAssertEqual(error, .malformedResponse(.openRouter))
    }
  }

  func testAPIPlatformCredentialsUseIsolatedKeychainAccounts() async throws {
    let keychain = FakeKeychain()
    let store = APIPlatformCredentialStore(keychain: keychain)

    try await store.save("  openrouter-secret  ", for: .openRouter)
    try await store.save("openai-secret", for: .openAI)
    let openRouterToken = try await store.token(for: .openRouter)
    let openAIToken = try await store.token(for: .openAI)
    let anthropicToken = try await store.token(for: .anthropic)
    XCTAssertEqual(openRouterToken, "openrouter-secret")
    XCTAssertEqual(openAIToken, "openai-secret")
    XCTAssertNil(anthropicToken)

    try await store.remove(for: .openRouter)
    let removedOpenRouter = try await store.token(for: .openRouter)
    let remainingOpenAI = try await store.token(for: .openAI)
    XCTAssertNil(removedOpenRouter)
    XCTAssertEqual(remainingOpenAI, "openai-secret")
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
    let snapshot = APIPlatformSnapshot(
      platform: .openRouter,
      workspaceNames: ["Default"],
      creditsRemaining: decimal("10"),
      monthlySpend: decimal("2.5"),
      projectedSpend: decimal("5"),
      sourceTimestamp: date("2026-08-16T12:00:00Z")
    )
    try JSONEncoder().encode(snapshot).write(to: url)

    XCTAssertEqual(try store.load(), [.openRouter: snapshot])

    try store.save([.openRouter: snapshot])
    let cached = try Data(contentsOf: url)
    XCTAssertFalse(String(data: cached, encoding: .utf8)?.contains("management-secret") == true)
    XCTAssertEqual(try store.load(), [.openRouter: snapshot])
    try store.remove()
    XCTAssertEqual(try store.load(), [:])
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

    guard case let .unauthenticated(message) = model.state(for: .openRouter) else {
      XCTFail("Expected missing-key state")
      return
    }
    XCTAssertEqual(message, APIPlatformError.credentialsMissing(.openRouter).localizedDescription)
    guard case .unauthenticated = model.state(for: .openAI) else {
      XCTFail("Expected OpenAI missing-key state")
      return
    }
    guard case .unauthenticated = model.state(for: .anthropic) else {
      XCTFail("Expected Anthropic missing-key state")
      return
    }
  }

  @MainActor
  func testAPIPlatformModelRetainsCachedSnapshotAsStale() async throws {
    let endpoints = testOpenRouterEndpoints()
    let keychain = FakeKeychain()
    let credentials = APIPlatformCredentialStore(keychain: keychain)
    try await credentials.save("secret", for: .openRouter)
    let cached = APIPlatformSnapshot(
      platform: .openRouter,
      workspaceNames: ["Default"],
      creditsRemaining: decimal("10"),
      monthlySpend: decimal("2"),
      projectedSpend: decimal("4"),
      sourceTimestamp: date("2026-08-16T11:00:00Z")
    )
    let store = MemoryAPIPlatformStore(loaded: [.openRouter: cached])
    let model = APIPlatformModel(
      settings: AppSettings(store: APISettingsStore()),
      openRouter: OpenRouterAPIClient(
        transport: APIPlatformRoutingTransport(
          routes: [
            endpoints.credits().absoluteString: APIPlatformResponse(statusCode: 401, data: Data())
          ]
        ),
        endpoints: endpoints
      ),
      credentials: credentials,
      store: store
    )

    await model.refresh()

    guard case let .stale(snapshot, reason) = model.state(for: .openRouter) else {
      XCTFail("Expected stale cached state")
      return
    }
    XCTAssertEqual(snapshot, cached)
    XCTAssertEqual(reason, APIPlatformError.unauthorized(.openRouter).localizedDescription)
  }
}

final class OpenAIAnthropicAPITests: XCTestCase {
  func testOpenAISumsCurrentMonthCostsAndProjects() async throws {
    let endpoints = testOpenAIEndpoints()
    let now = date("2026-09-07T12:00:00Z")
    let start = try APIPlatformProjection.monthStart(
      platform: .openAI, now: now, timeZone: utcTimeZone())
    let transport = APIPlatformRoutingTransport(
      routes: [
        endpoints.costs(
          startTime: Int(start.timeIntervalSince1970),
          endTime: Int(now.timeIntervalSince1970),
          page: nil
        ).absoluteString: response(fixture("openai-costs"))
      ]
    )
    let client = OpenAIAPIClient(transport: transport, endpoints: endpoints)
    let snapshot = try await client.fetchSnapshot(
      token: "openai-admin",
      now: now,
      timeZone: utcTimeZone()
    )

    XCTAssertEqual(snapshot.platform, .openAI)
    XCTAssertNil(snapshot.creditsRemaining)
    XCTAssertEqual(snapshot.monthlySpend, decimal("12.5"))
    XCTAssertEqual(snapshot.projectedSpend, decimal("12.5") / Decimal(7) * Decimal(30))
    let requests = await transport.requests
    XCTAssertEqual(requests.count, 1)
    XCTAssertTrue(requests.allSatisfy { !$0.description.contains("openai-admin") })
  }

  func testOpenAIPaginatesCostBuckets() async throws {
    let endpoints = testOpenAIEndpoints()
    let now = date("2026-09-07T12:00:00Z")
    let start = try APIPlatformProjection.monthStart(
      platform: .openAI, now: now, timeZone: utcTimeZone())
    let startTime = Int(start.timeIntervalSince1970)
    let endTime = Int(now.timeIntervalSince1970)
    let firstPage = endpoints.costs(startTime: startTime, endTime: endTime, page: nil)
    let secondPage = endpoints.costs(startTime: startTime, endTime: endTime, page: "page-2")
    let transport = APIPlatformRoutingTransport(
      routes: [
        firstPage.absoluteString: response(
          Data(
            #"""
            {
              "object": "page",
              "data": [{ "results": [{ "amount": { "value": 4.25, "currency": "usd" } }] }],
              "has_more": true,
              "next_page": "page-2"
            }
            """#.utf8)
        ),
        secondPage.absoluteString: response(
          Data(
            #"""
            {
              "object": "page",
              "data": [{ "results": [{ "amount": { "value": 8.25, "currency": "usd" } }] }],
              "has_more": false,
              "next_page": null
            }
            """#.utf8)
        ),
      ]
    )
    let snapshot = try await OpenAIAPIClient(transport: transport, endpoints: endpoints)
      .fetchSnapshot(token: "secret", now: now, timeZone: utcTimeZone())
    XCTAssertEqual(snapshot.monthlySpend, decimal("12.5"))
    let requests = await transport.requests
    XCTAssertEqual(
      requests.map(\.url.absoluteString),
      [
        firstPage.absoluteString, secondPage.absoluteString,
      ])
  }

  func testOpenAIRejectsNonUSDAndUnauthorized() async throws {
    let endpoints = testOpenAIEndpoints()
    let now = date("2026-09-07T12:00:00Z")
    let start = try APIPlatformProjection.monthStart(
      platform: .openAI, now: now, timeZone: utcTimeZone())
    let costsURL = endpoints.costs(
      startTime: Int(start.timeIntervalSince1970),
      endTime: Int(now.timeIntervalSince1970),
      page: nil
    ).absoluteString

    let nonUSD = OpenAIAPIClient(
      transport: APIPlatformRoutingTransport(
        routes: [costsURL: response(fixture("openai-costs-eur"))]
      ),
      endpoints: endpoints
    )
    do {
      _ = try await nonUSD.fetchSnapshot(token: "secret", now: now, timeZone: utcTimeZone())
      XCTFail("Expected malformed non-USD response")
    } catch let error as APIPlatformError {
      XCTAssertEqual(error, .malformedResponse(.openAI))
    }

    let unauthorized = OpenAIAPIClient(
      transport: APIPlatformRoutingTransport(
        routes: [costsURL: APIPlatformResponse(statusCode: 401, data: Data())]
      ),
      endpoints: endpoints
    )
    do {
      _ = try await unauthorized.fetchSnapshot(token: "secret", now: now, timeZone: utcTimeZone())
      XCTFail("Expected unauthorized")
    } catch let error as APIPlatformError {
      XCTAssertEqual(error, .unauthorized(.openAI))
    }
  }

  func testAnthropicConvertsCentsAndProjects() async throws {
    let endpoints = testAnthropicEndpoints()
    let now = date("2026-09-07T12:00:00Z")
    let start = try APIPlatformProjection.monthStart(
      platform: .anthropic, now: now, timeZone: utcTimeZone())
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    let reportURL = endpoints.costReport(
      startingAt: formatter.string(from: start),
      endingAt: formatter.string(from: now),
      page: nil
    ).absoluteString
    let transport = APIPlatformRoutingTransport(
      routes: [reportURL: response(fixture("anthropic-cost-report"))]
    )
    let client = AnthropicAPIClient(transport: transport, endpoints: endpoints)
    let snapshot = try await client.fetchSnapshot(
      token: "sk-ant-admin",
      now: now,
      timeZone: utcTimeZone()
    )

    XCTAssertEqual(snapshot.platform, .anthropic)
    XCTAssertNil(snapshot.creditsRemaining)
    XCTAssertEqual(snapshot.monthlySpend, decimal("8.5"))
    XCTAssertEqual(snapshot.projectedSpend, decimal("8.5") / Decimal(7) * Decimal(30))
    let requests = await transport.requests
    XCTAssertEqual(requests.count, 1)
    XCTAssertTrue(requests[0].headers["x-api-key"] == "sk-ant-admin")
    XCTAssertTrue(requests.allSatisfy { !$0.description.contains("sk-ant-admin") })
  }

  func testAnthropicRejectsNonUSD() async throws {
    let endpoints = testAnthropicEndpoints()
    let now = date("2026-09-07T12:00:00Z")
    let start = try APIPlatformProjection.monthStart(
      platform: .anthropic, now: now, timeZone: utcTimeZone())
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    let reportURL = endpoints.costReport(
      startingAt: formatter.string(from: start),
      endingAt: formatter.string(from: now),
      page: nil
    ).absoluteString
    let client = AnthropicAPIClient(
      transport: APIPlatformRoutingTransport(
        routes: [reportURL: response(fixture("anthropic-cost-report-eur"))]
      ),
      endpoints: endpoints
    )
    do {
      _ = try await client.fetchSnapshot(token: "secret", now: now, timeZone: utcTimeZone())
      XCTFail("Expected malformed non-USD response")
    } catch let error as APIPlatformError {
      XCTAssertEqual(error, .malformedResponse(.anthropic))
    }
  }
}

private func response(_ data: Data) -> APIPlatformResponse {
  APIPlatformResponse(statusCode: 200, data: data)
}

private func testOpenRouterEndpoints() -> OpenRouterEndpoints {
  guard let url = URL(string: "https://openrouter.test") else {
    preconditionFailure("Invalid test endpoint")
  }
  return OpenRouterEndpoints(baseURL: url)
}

private func testOpenAIEndpoints() -> OpenAIEndpoints {
  guard let url = URL(string: "https://openai.test") else {
    preconditionFailure("Invalid test endpoint")
  }
  return OpenAIEndpoints(baseURL: url)
}

private func testAnthropicEndpoints() -> AnthropicEndpoints {
  guard let url = URL(string: "https://anthropic.test") else {
    preconditionFailure("Invalid test endpoint")
  }
  return AnthropicEndpoints(baseURL: url)
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

private actor APIPlatformRoutingTransport: APIPlatformTransport {
  private let routes: [String: APIPlatformResponse]
  private(set) var requests: [APIPlatformRequest] = []

  init(routes: [String: APIPlatformResponse]) {
    self.routes = routes
  }

  func send(_ request: APIPlatformRequest) throws -> APIPlatformResponse {
    requests.append(request)
    guard let response = routes[request.url.absoluteString] else {
      throw APIPlatformError.network(request.platform)
    }
    return response
  }
}
