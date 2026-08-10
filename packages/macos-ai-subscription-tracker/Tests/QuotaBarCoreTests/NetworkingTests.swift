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
    let rejectionRequests = await credentials.rejectionRequests
    let requests = await transport.requests
    XCTAssertEqual(data, Data("fresh".utf8))
    XCTAssertEqual(rejectionRequests, [false, true])
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

  func testUnauthorizedPreservedWhenNoAlternativeCredentialExists() async throws {
    let transport = StubTransport([
      .success(ProviderResponse(statusCode: 401, data: Data()))
    ])
    let credentials = StubCredentialStore(tokens: ["only-token"])
    let client = ProviderHTTPClient(transport: transport, credentials: credentials)
    let url = try XCTUnwrap(URL(string: "https://example.com/usage"))
    do {
      _ = try await client.get(provider: .codex, url: url)
      XCTFail("Expected unauthorized")
    } catch {
      XCTAssertEqual(error as? QuotaError, .unauthorized(.codex))
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
    let rejectionRequests = await expired.rejectionRequests
    let requests = await transport.requests
    XCTAssertEqual(rejectionRequests, [false, true])
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
    let rejectionRequests = await credentials.rejectionRequests
    let requests = await transport.requests
    XCTAssertEqual(data, Data("fresh".utf8))
    XCTAssertEqual(rejectionRequests, [false, true])
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

  func testGrokUnauthorizedSurfaceRestartsCompleteFetchOnOneCredential() async throws {
    let endpoints = try ProviderEndpoints.live(environment: [:])
    let transport = TokenRoutingTransport(routes: [
      endpoints.grokUser.absoluteString: (
        rejectedToken: nil,
        response: .success(ProviderResponse(statusCode: 200, data: fixture("grok-user")))
      ),
      endpoints.grokBilling.absoluteString: (
        rejectedToken: "token-a",
        response: .success(ProviderResponse(statusCode: 200, data: fixture("grok-billing")))
      ),
      endpoints.grokCredits.absoluteString: (
        rejectedToken: "token-a",
        response: .success(ProviderResponse(statusCode: 200, data: fixture("grok-credits")))
      ),
    ])
    let client = ProviderHTTPClient(
      transport: transport,
      credentials: StubCredentialStore(tokens: ["token-a", "token-b"])
    )

    let grok = try await GrokProvider(
      client: client,
      userEndpoint: endpoints.grokUser,
      billingEndpoint: endpoints.grokBilling,
      creditsEndpoint: endpoints.grokCredits
    ).fetch()

    XCTAssertTrue(grok.windows.map(\.label).contains("Monthly"))
    let requests = await transport.requests
    XCTAssertEqual(
      requests.filter { $0.url == endpoints.grokUser }.map(\.bearerToken),
      [
        "token-a", "token-b",
      ])
    XCTAssertEqual(
      requests.filter { $0.url == endpoints.grokBilling }.map(\.bearerToken),
      [
        "token-a", "token-b",
      ])
    XCTAssertEqual(
      requests.filter { $0.url == endpoints.grokCredits }.map(\.bearerToken),
      [
        "token-a", "token-b",
      ])
  }

  func testCodexUnauthorizedSurfaceRestartsCompleteFetchOnOneCredential() async throws {
    let endpoints = try ProviderEndpoints.live(environment: [:])
    let transport = TokenRoutingTransport(routes: [
      endpoints.codexUsage.absoluteString: (
        rejectedToken: "token-a",
        response: .success(ProviderResponse(statusCode: 200, data: fixture("codex-success")))
      ),
      endpoints.codexResets.absoluteString: (
        rejectedToken: nil,
        response: .success(ProviderResponse(statusCode: 200, data: fixture("codex-resets")))
      ),
    ])
    let client = ProviderHTTPClient(
      transport: transport,
      credentials: StubCredentialStore(tokens: ["token-a", "token-b"])
    )

    let codex = try await CodexProvider(
      client: client,
      usageEndpoint: endpoints.codexUsage,
      resetEndpoint: endpoints.codexResets
    ).fetch()

    XCTAssertNil(codex.resetErrorMessage)
    XCTAssertFalse(codex.windows.isEmpty)
    let requests = await transport.requests
    XCTAssertEqual(
      requests.filter { $0.url == endpoints.codexUsage }.map(\.bearerToken),
      [
        "token-a", "token-b",
      ])
    XCTAssertEqual(
      requests.filter { $0.url == endpoints.codexResets }.map(\.bearerToken),
      [
        "token-a", "token-b",
      ])
  }

  func testCodexStopsAfterOneReplacementInsteadOfOscillatingBetweenCredentials() async throws {
    let endpoints = try ProviderEndpoints.live(environment: [:])
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let authFile = root.appendingPathComponent(".codex/auth.json")
    try FileManager.default.createDirectory(
      at: authFile.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data(#"{"tokens":{"access_token":"local-token"}}"#.utf8).write(to: authFile)
    let manual = ManualCredentialStore(keychain: FakeKeychain())
    try await manual.save("manual-token", for: .codex)
    let credentials = CompositeCredentialStore(
      manual: manual,
      local: LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    )
    // Both the manual override and the discovered local credential are rejected by the server;
    // without the fix, CompositeCredentialStore forgets the manual token was already rejected
    // and hands it out again, oscillating between the two forever instead of exhausting.
    let transport = StubTransport(
      Array(
        repeating: .success(ProviderResponse(statusCode: 401, data: Data())),
        count: 8
      ))
    let client = ProviderHTTPClient(transport: transport, credentials: credentials)

    do {
      _ = try await CodexProvider(
        client: client,
        usageEndpoint: endpoints.codexUsage,
        resetEndpoint: endpoints.codexResets
      ).fetch()
      XCTFail("Expected unauthorized once every known credential has been rejected")
    } catch {
      XCTAssertEqual(error as? QuotaError, .unauthorized(.codex))
    }
    // Exactly one replacement attempt: manual-token then local-token, each hitting both Codex
    // surfaces once (4 requests total) — never a third attempt re-offering manual-token.
    let requests = await transport.requests
    XCTAssertEqual(requests.count, 4)
  }

  func testCodexPropagatesMalformedResetShapeInsteadOfMaskingIt() async throws {
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

    // A changed reset shape signals a real API contract change, not a transient hiccup - it
    // must fail the whole fetch (so the model marks Codex unavailable/stale) rather than
    // publishing a snapshot with good usage windows and a silently empty reset list.
    do {
      _ = try await provider.fetch()
      XCTFail("Expected malformedResponse for an unrecognized reset shape")
    } catch {
      XCTAssertEqual(error as? QuotaError, .malformedResponse(.codex))
    }
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

  func testEndpointRejectsRelativeOverrideURL() throws {
    // Syntactically valid per URL(string:) but has no scheme or host - must not silently pass
    // through as a usable override.
    XCTAssertThrowsError(
      try ProviderEndpoints.live(
        environment: ["QUOTABAR_KIMI_USAGE_URL": "api.kimi.com/coding/v1/usages"])
    ) { error in
      XCTAssertEqual(error as? QuotaError, .invalidURL(.kimi))
    }
  }

  func testEndpointRejectsPlainHTTPOverrideExceptLoopback() throws {
    // The bearer token rides on every request to this URL, so a non-loopback http:// override
    // must be rejected rather than silently transmitting the credential in cleartext.
    XCTAssertThrowsError(
      try ProviderEndpoints.live(
        environment: ["QUOTABAR_KIMI_USAGE_URL": "http://api.kimi.com/coding/v1/usages"])
    ) { error in
      XCTAssertEqual(error as? QuotaError, .invalidURL(.kimi))
    }
    let loopback = try ProviderEndpoints.live(
      environment: ["QUOTABAR_KIMI_USAGE_URL": "http://127.0.0.1:8080/usages"])
    XCTAssertEqual(loopback.kimiUsage.host, "127.0.0.1")
  }
}

private actor ExpiredCredentialStore: CredentialStore {
  private(set) var rejectionRequests: [Bool] = []

  func credential(
    for _: ProviderID,
    rejecting rejectedCredential: ProviderCredential?
  ) throws -> ProviderCredential {
    rejectionRequests.append(rejectedCredential != nil)
    return try ProviderCredential(
      accessToken: "expired-token",
      expiresAt: Date(timeIntervalSince1970: 1),
      source: "test"
    )
  }
}

private actor RecoveringExpiredCredentialStore: CredentialStore {
  private(set) var rejectionRequests: [Bool] = []

  func credential(
    for _: ProviderID,
    rejecting rejectedCredential: ProviderCredential?
  ) throws -> ProviderCredential {
    rejectionRequests.append(rejectedCredential != nil)
    return try ProviderCredential(
      accessToken: rejectedCredential == nil ? "expired-token" : "fresh-token",
      expiresAt: rejectedCredential == nil ? Date(timeIntervalSince1970: 1) : nil,
      source: "test"
    )
  }
}
