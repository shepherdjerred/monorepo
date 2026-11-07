import Foundation
import XCTest

@testable import QuotaBarCore

final class AntigravityPlanSourceTests: XCTestCase {
  private let wrongID = "111111111111-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.apps.googleusercontent.com"
  private let rightID = "222222222222-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.apps.googleusercontent.com"
  private let secret = "GOCSPX-" + String(repeating: "S", count: 28)
  private let tokenEndpoint = testURL("https://oauth.example.test/token")
  private let codeAssistEndpoint = testURL("https://code-assist.example.test/load")

  func testFindsClientsWhereGoStringsRunTogether() {
    // A Go binary's strings sit back to back: the secret must stop at exactly 28 characters.
    let data = Data("junk\(wrongID)xx\(secret)clientid\(rightID)\u{0}".utf8)
    let clients = AntigravityPlanSource.oauthClients(in: data)
    XCTAssertEqual(Set(clients.map(\.id)), [wrongID, rightID])
    XCTAssertEqual(Set(clients.map(\.secret)), [secret])
  }

  func testRenewsWithTheIssuingClientThenCachesTheAccessToken() async throws {
    let fixture = try makeFixture()
    defer { try? FileManager.default.removeItem(at: fixture.root) }
    let before = try Data(contentsOf: fixture.tokenFile)
    let recorder = Recorder(rightID: rightID)
    let source = AntigravityPlanSource(
      tokenFile: fixture.tokenFile,
      executable: { fixture.binary },
      tokenEndpoint: tokenEndpoint,
      codeAssistEndpoint: codeAssistEndpoint,
      send: { try await recorder.send($0) }
    )

    let first = try await source.codeAssistData()
    _ = try await source.codeAssistData()

    XCTAssertEqual(try AntigravityProvider.parsePlan(data: first)?.name, "Google AI Pro")
    let requests = await recorder.requests
    let renewals = requests.filter { $0.url == tokenEndpoint }
    // At most one wrong client is tried, and the working token is reused for the second call.
    XCTAssertLessThanOrEqual(renewals.count, 2)
    XCTAssertEqual(requests.filter { $0.url == codeAssistEndpoint }.count, 2)
    let assist = try XCTUnwrap(requests.last)
    XCTAssertEqual(assist.value(forHTTPHeaderField: "User-Agent"), "antigravity")
    XCTAssertEqual(assist.value(forHTTPHeaderField: "Authorization"), "Bearer fresh-access")
    XCTAssertNil(renewals.first?.value(forHTTPHeaderField: "Authorization"))
    XCTAssertEqual(
      try Data(contentsOf: fixture.tokenFile), before, "agy's token file is never written")
  }

  func testRevokedRefreshTokenIsUnauthorized() async throws {
    let fixture = try makeFixture()
    defer { try? FileManager.default.removeItem(at: fixture.root) }
    let source = AntigravityPlanSource(
      tokenFile: fixture.tokenFile,
      executable: { fixture.binary },
      tokenEndpoint: tokenEndpoint,
      codeAssistEndpoint: codeAssistEndpoint,
      send: { _ in (400, Data(#"{"error":"invalid_grant"}"#.utf8)) }
    )
    do {
      _ = try await source.codeAssistData()
      XCTFail("Expected unauthorized")
    } catch {
      XCTAssertEqual(error as? QuotaError, .unauthorized(.antigravity))
    }
  }

  func testMissingTokenFileMeansSignedOut() async throws {
    let fixture = try makeFixture()
    defer { try? FileManager.default.removeItem(at: fixture.root) }
    try FileManager.default.removeItem(at: fixture.tokenFile)
    let source = AntigravityPlanSource(
      tokenFile: fixture.tokenFile,
      executable: { fixture.binary },
      tokenEndpoint: tokenEndpoint,
      codeAssistEndpoint: codeAssistEndpoint,
      send: { _ in
        XCTFail("No request without a token"); return (500, Data())
      }
    )
    do {
      _ = try await source.codeAssistData()
      XCTFail("Expected credentialsMissing")
    } catch {
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.antigravity))
    }
  }

  private func makeFixture() throws -> Fixture {
    let root = try temporaryDirectory()
    let binary = root.appendingPathComponent("agy")
    try Data("\(wrongID)\(secret)x\(rightID)".utf8).write(to: binary)
    let tokenFile = root.appendingPathComponent("antigravity-oauth-token")
    try Data(
      #"""
      {"token": {"access_token": "stale", "refresh_token": "fixture-refresh",
        "expiry": "2026-01-01T00:00:00Z"}, "auth_method": "consumer"}
      """#.utf8
    ).write(to: tokenFile)
    return Fixture(root: root, tokenFile: tokenFile, binary: binary)
  }
}

/// A URL literal for these tests; a typo stops the run instead of being force-unwrapped.
private func testURL(_ string: String) -> URL {
  guard let url = URL(string: string) else { preconditionFailure("Invalid test URL: \(string)") }
  return url
}

private struct Fixture {
  let root: URL
  let tokenFile: URL
  let binary: URL
}

private actor Recorder {
  let rightID: String
  private(set) var requests: [URLRequest] = []

  init(rightID: String) { self.rightID = rightID }

  func send(_ request: URLRequest) throws -> (status: Int, body: Data) {
    requests.append(request)
    if request.url?.host == "oauth.example.test" {
      let form = String(data: request.httpBody ?? Data(), encoding: .utf8) ?? ""
      let issued =
        form.contains("client_id=\(rightID)") && form.contains("refresh_token=fixture-refresh")
      return issued
        ? (200, Data(#"{"access_token":"fresh-access","expires_in":3599}"#.utf8))
        : (401, Data(#"{"error":"invalid_client"}"#.utf8))
    }
    return (200, fixture("antigravity-code-assist"))
  }
}
