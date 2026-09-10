import Foundation
import XCTest

@testable import QuotaBarCore

final class GrokNetworkingTests: XCTestCase {
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
      endpoints.grokResets.absoluteString: (
        rejectedToken: "token-a",
        response: .success(ProviderResponse(statusCode: 200, data: grokEmptyResets))
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
      creditsEndpoint: endpoints.grokCredits,
      resetEndpoint: endpoints.grokResets
    ).fetch()

    XCTAssertTrue(grok.windows.map(\.label).contains("Monthly"))
    let requests = await transport.requests
    XCTAssertEqual(
      requests.filter { $0.url == endpoints.grokUser }.map(\.bearerToken),
      ["token-a", "token-b"]
    )
    XCTAssertEqual(
      requests.filter { $0.url == endpoints.grokBilling }.map(\.bearerToken),
      ["token-a", "token-b"]
    )
    XCTAssertEqual(
      requests.filter { $0.url == endpoints.grokCredits }.map(\.bearerToken),
      ["token-a", "token-b"]
    )
    XCTAssertEqual(
      requests.filter { $0.url == endpoints.grokResets }.map(\.bearerToken),
      ["token-a", "token-b"]
    )
  }

  func testGrokPropagatesMalformedResetShapeInsteadOfMaskingIt() async throws {
    let endpoints = try ProviderEndpoints.live(environment: [:])
    let transport = RoutingTransport(routes: [
      endpoints.grokUser.absoluteString: .success(
        ProviderResponse(statusCode: 200, data: fixture("grok-user"))
      ),
      endpoints.grokBilling.absoluteString: .success(
        ProviderResponse(statusCode: 200, data: fixture("grok-billing"))
      ),
      endpoints.grokCredits.absoluteString: .success(
        ProviderResponse(statusCode: 200, data: fixture("grok-credits"))
      ),
      endpoints.grokResets.absoluteString: .success(
        ProviderResponse(statusCode: 200, data: Data("not-grpc-web".utf8))
      ),
    ])
    let provider = GrokProvider(
      client: ProviderHTTPClient(
        transport: transport,
        credentials: StubCredentialStore(tokens: ["token"])
      ),
      userEndpoint: endpoints.grokUser,
      billingEndpoint: endpoints.grokBilling,
      creditsEndpoint: endpoints.grokCredits,
      resetEndpoint: endpoints.grokResets
    )

    do {
      _ = try await provider.fetch()
      XCTFail("Expected malformedResponse for an unrecognized reset frame")
    } catch {
      XCTAssertEqual(error as? QuotaError, .malformedResponse(.grok))
    }
  }
}
