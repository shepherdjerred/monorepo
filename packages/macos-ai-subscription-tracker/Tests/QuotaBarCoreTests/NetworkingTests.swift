import Foundation
import XCTest

@testable import QuotaBarCore

final class NetworkingTests: XCTestCase {
  func testRequestIsBoundedAndRedacted() async throws {
    let transport = StubTransport([
      .success(ProviderResponse(statusCode: 200, data: Data("ok".utf8)))
    ])
    let credentials = StubCredentialStore(tokens: ["secret-token-value"])
    let client = ProviderHTTPClient(transport: transport, credentials: credentials)
    let url = try XCTUnwrap(URL(string: "https://example.com/usage"))

    let data = try await client.get(
      provider: .codex,
      url: url,
      headers: ["x-client": "QuotaBar"],
      timeout: 7
    )

    XCTAssertEqual(String(data: data, encoding: .utf8), "ok")
    let capturedRequests = await transport.requests
    let request = try XCTUnwrap(capturedRequests.first)
    XCTAssertEqual(request.url, url)
    XCTAssertEqual(request.timeout, 7)
    XCTAssertEqual(request.headers["x-client"], "QuotaBar")
    XCTAssertFalse(request.description.contains("secret-token-value"))
    XCTAssertTrue(request.description.contains("<redacted>"))
  }

  func testUnauthorizedReloadsExactlyOnce() async throws {
    let transport = StubTransport([
      .success(ProviderResponse(statusCode: 401, data: Data())),
      .success(ProviderResponse(statusCode: 200, data: Data("fresh".utf8))),
    ])
    let credentials = StubCredentialStore(tokens: ["old-token", "new-token"])
    let client = ProviderHTTPClient(transport: transport, credentials: credentials)
    let url = try XCTUnwrap(URL(string: "https://example.com/usage"))

    let data = try await client.get(provider: .claudeCode, url: url)
    let reloads = await credentials.reloads
    let requests = await transport.requests
    XCTAssertEqual(data, Data("fresh".utf8))
    XCTAssertEqual(reloads, [false, true])
    XCTAssertEqual(requests.map(\.bearerToken), ["old-token", "new-token"])
  }

  func testSecondUnauthorizedAndRateLimitFailExplicitly() async throws {
    let url = try XCTUnwrap(URL(string: "https://example.com/usage"))
    let unauthorized = StubTransport([
      .success(ProviderResponse(statusCode: 401, data: Data())),
      .success(ProviderResponse(statusCode: 401, data: Data())),
    ])
    let retryClient = ProviderHTTPClient(
      transport: unauthorized,
      credentials: StubCredentialStore(tokens: ["old-token", "new-token"])
    )
    do {
      _ = try await retryClient.get(provider: .codex, url: url)
      XCTFail("Expected unauthorized")
    } catch {
      XCTAssertEqual(error as? QuotaError, .unauthorized(.codex))
    }

    let limited = StubTransport([.success(ProviderResponse(statusCode: 429, data: Data()))])
    let limitedClient = ProviderHTTPClient(
      transport: limited,
      credentials: StubCredentialStore(tokens: ["token"])
    )
    do {
      _ = try await limitedClient.get(provider: .grok, url: url)
      XCTFail("Expected rate limit")
    } catch {
      XCTAssertEqual(error as? QuotaError, .rateLimited(.grok))
    }
  }

  func testCredentialExpiryIsCheckedBeforeTransport() async throws {
    let expired = ExpiredCredentialStore()
    let transport = StubTransport([])
    let client = ProviderHTTPClient(transport: transport, credentials: expired)
    let url = try XCTUnwrap(URL(string: "https://example.com/usage"))
    do {
      _ = try await client.get(provider: .kimi, url: url)
      XCTFail("Expected expired credential")
    } catch {
      XCTAssertEqual(error as? QuotaError, .credentialsExpired(.kimi))
    }
    let reloads = await expired.reloads
    let requests = await transport.requests
    XCTAssertEqual(reloads, [false, true])
    XCTAssertTrue(requests.isEmpty)
  }

  func testExpiredCredentialReloadCanRecover() async throws {
    let credentials = RecoveringExpiredCredentialStore()
    let transport = StubTransport([
      .success(ProviderResponse(statusCode: 200, data: Data("fresh".utf8)))
    ])
    let client = ProviderHTTPClient(transport: transport, credentials: credentials)
    let url = try XCTUnwrap(URL(string: "https://example.com/usage"))

    let data = try await client.get(provider: .kimi, url: url)
    let reloads = await credentials.reloads
    let requests = await transport.requests
    XCTAssertEqual(data, Data("fresh".utf8))
    XCTAssertEqual(reloads, [false, true])
    XCTAssertEqual(requests.count, 1)
  }

  func testProvidersUseExpectedSurfacesAndRetainPartialResults() async throws {
    let endpoints = try ProviderEndpoints.live(environment: [:])
    let transport = RoutingTransport(routes: [
      endpoints.codexUsage.absoluteString: .success(
        ProviderResponse(statusCode: 200, data: fixture("codex-success"))
      ),
      endpoints.codexResets.absoluteString: .success(
        ProviderResponse(statusCode: 429, data: Data())),
      endpoints.grokUser.absoluteString: .success(
        ProviderResponse(statusCode: 200, data: fixture("grok-user"))
      ),
      endpoints.grokBilling.absoluteString: .success(
        ProviderResponse(statusCode: 200, data: fixture("grok-billing"))
      ),
      endpoints.grokCredits.absoluteString: .success(
        ProviderResponse(statusCode: 500, data: Data())),
    ])
    let client = ProviderHTTPClient(
      transport: transport,
      credentials: StubCredentialStore(tokens: ["token"])
    )

    let codex = try await CodexProvider(
      client: client,
      usageEndpoint: endpoints.codexUsage,
      resetEndpoint: endpoints.codexResets
    ).fetch()
    XCTAssertNotNil(codex.resetErrorMessage)
    XCTAssertEqual(codex.windows.count, 3)

    let grok = try await GrokProvider(
      client: client,
      userEndpoint: endpoints.grokUser,
      billingEndpoint: endpoints.grokBilling,
      creditsEndpoint: endpoints.grokCredits
    ).fetch()
    XCTAssertEqual(grok.windows.map(\.label), ["Monthly"])
    XCTAssertFalse(grok.notes.isEmpty)
    let requests = await transport.requests
    XCTAssertEqual(requests.filter { $0.provider == .grok }.count, 3)
    XCTAssertTrue(requests.contains { $0.headers["x-userid"] == "user_quotabar_fixture" })
  }

  func testCodexRetainsUsageWhenResetShapeChanges() async throws {
    let endpoints = try ProviderEndpoints.live(environment: [:])
    let transport = RoutingTransport(routes: [
      endpoints.codexUsage.absoluteString: .success(
        ProviderResponse(statusCode: 200, data: fixture("codex-success"))
      ),
      endpoints.codexResets.absoluteString: .success(
        ProviderResponse(statusCode: 200, data: Data(#"{"credits":"changed"}"#.utf8))
      ),
    ])
    let provider = CodexProvider(
      client: ProviderHTTPClient(
        transport: transport,
        credentials: StubCredentialStore(tokens: ["token"])
      ),
      usageEndpoint: endpoints.codexUsage,
      resetEndpoint: endpoints.codexResets
    )

    let snapshot = try await provider.fetch()
    XCTAssertFalse(snapshot.windows.isEmpty)
    XCTAssertNotNil(snapshot.resetErrorMessage)
  }

  func testClaudeAndKimiFetchThroughAdapters() async throws {
    let endpoints = try ProviderEndpoints.live(environment: [:])
    let transport = RoutingTransport(routes: [
      endpoints.claudeUsage.absoluteString: .success(
        ProviderResponse(statusCode: 200, data: fixture("claude-success"))
      ),
      endpoints.kimiUsage.absoluteString: .success(
        ProviderResponse(statusCode: 200, data: fixture("kimi-success"))
      ),
    ])
    let client = ProviderHTTPClient(
      transport: transport,
      credentials: StubCredentialStore(tokens: ["token"])
    )
    let claude = try await ClaudeCodeProvider(client: client, endpoint: endpoints.claudeUsage)
      .fetch()
    let kimi = try await KimiProvider(client: client, endpoint: endpoints.kimiUsage).fetch()
    XCTAssertEqual(claude.provider, .claudeCode)
    XCTAssertEqual(kimi.provider, .kimi)
    let requests = await transport.requests
    XCTAssertEqual(requests.first?.headers["anthropic-beta"], "oauth-2025-04-20")
    XCTAssertTrue(requests.contains { $0.headers["User-Agent"] == "QuotaBar/1.0" })
  }

  func testEndpointValidationAndProviderFactory() throws {
    XCTAssertThrowsError(
      try ProviderEndpoints.live(environment: ["QUOTABAR_KIMI_USAGE_URL": "http://["]))
    let credentials = StubCredentialStore(tokens: ["token"])
    XCTAssertEqual(try Providers.live(credentials: credentials).map(\.id), ProviderID.allCases)
  }
}

private actor ExpiredCredentialStore: CredentialStore {
  private(set) var reloads: [Bool] = []

  func credential(for _: ProviderID, reload: Bool) throws -> ProviderCredential {
    reloads.append(reload)
    return try ProviderCredential(
      accessToken: "expired-token",
      expiresAt: Date(timeIntervalSince1970: 1),
      source: "test"
    )
  }
}

private actor RecoveringExpiredCredentialStore: CredentialStore {
  private(set) var reloads: [Bool] = []

  func credential(for _: ProviderID, reload: Bool) throws -> ProviderCredential {
    reloads.append(reload)
    return try ProviderCredential(
      accessToken: reload ? "fresh-token" : "expired-token",
      expiresAt: reload ? nil : Date(timeIntervalSince1970: 1),
      source: "test"
    )
  }
}
