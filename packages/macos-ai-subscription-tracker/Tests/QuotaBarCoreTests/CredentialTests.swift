import Foundation
import XCTest

@testable import QuotaBarCore

final class CredentialTests: XCTestCase {
  func testManualKeychainSaveLoadAndRemove() async throws {
    let keychain = FakeKeychain()
    let store = ManualCredentialStore(keychain: keychain)
    let initial = try await store.credentialIfPresent(for: .codex)
    XCTAssertNil(initial)
    try await store.save("  manual-token  ", for: .codex)
    let saved = try await store.credential(for: .codex, rejecting: nil)
    XCTAssertEqual(saved.accessToken, "manual-token")
    try await store.remove(for: .codex)
    let removed = try await store.credentialIfPresent(for: .codex)
    XCTAssertNil(removed)
    await XCTAssertThrowsErrorAsync { try await store.save(" ", for: .codex) }
  }

  func testManualKeychainPropagatesSafeErrors() async {
    let keychain = FakeKeychain()
    keychain.failureStatus = -50
    let store = ManualCredentialStore(keychain: keychain)
    await XCTAssertThrowsErrorAsync { try await store.credentialIfPresent(for: .grok) }
  }

  func testTypedClaudeAndCodexDiscovery() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      #"{"claudeAiOauth":{"accessToken":"claude-exact-token","expiresAt":9999999999999},"unrelated":"wrong-token"}"#,
      to: root.appendingPathComponent(".claude/.credentials.json")
    )
    try write(
      #"{"tokens":{"access_token":"codex-exact-token"},"id_token":"wrong-token"}"#,
      to: root.appendingPathComponent(".codex/auth.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    let claude = try store.credential(for: .claudeCode, rejecting: nil)
    let codex = try store.credential(for: .codex, rejecting: nil)
    XCTAssertEqual(claude.accessToken, "claude-exact-token")
    XCTAssertEqual(codex.accessToken, "codex-exact-token")
  }

  func testClaudeKeychainFallbackIsTyped() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let keychain = FakeKeychain()
    keychain.seed(
      Data(#"{"claudeAiOauth":{"accessToken":"keychain-token"}}"#.utf8),
      service: "Claude Code-credentials"
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: keychain)
    let credential = try store.credential(for: .claudeCode, rejecting: nil)
    XCTAssertEqual(credential.accessToken, "keychain-token")
  }

  func testExpiredClaudeFileCredentialFallsBackToKeychain() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      #"{"claudeAiOauth":{"accessToken":"expired-file-token","expiresAt":1}}"#,
      to: root.appendingPathComponent(".claude/.credentials.json")
    )
    let keychain = FakeKeychain()
    keychain.seed(
      Data(#"{"claudeAiOauth":{"accessToken":"current-keychain-token"}}"#.utf8),
      service: "Claude Code-credentials"
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: keychain)

    let credential = try store.credential(for: .claudeCode, rejecting: nil)

    XCTAssertEqual(credential.accessToken, "current-keychain-token")
  }

  func testExpiredOAuthDoesNotMaskFreshTopLevelToken() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      #"{"claudeAiOauth":{"accessToken":"expired-oauth","expiresAt":1},"access_token":"current"}"#,
      to: root.appendingPathComponent(".claude/.credentials.json")
    )
    try write(
      #"{"oauth":{"access_token":"expired-oauth","expires_at":1},"access_token":"current","expires_at":9999999999999}"#,
      to: root.appendingPathComponent(".kimi-code/credentials/account.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    XCTAssertEqual(try store.credential(for: .claudeCode, rejecting: nil).accessToken, "current")
    XCTAssertEqual(try store.credential(for: .kimi, rejecting: nil).accessToken, "current")
  }

  func testExpiredKimiLocalCredentialReportsExpiry() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      #"{"access_token":"expired-local-token","expires_at":1}"#,
      to: root.appendingPathComponent(".kimi-code/credentials/account.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())

    do {
      _ = try store.credential(for: .kimi, rejecting: nil)
      XCTFail("Expected an expired Kimi credential")
    } catch {
      XCTAssertEqual(error as? QuotaError, .credentialsExpired(.kimi))
    }
  }

  func testExpiredKimiFileDoesNotMaskLaterCurrentFile() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      #"{"access_token":"expired-first-token","expires_at":1}"#,
      to: root.appendingPathComponent(".kimi-code/credentials/account-a.json")
    )
    try write(
      #"{"access_token":"current-later-token","expires_at":9999999999999}"#,
      to: root.appendingPathComponent(".kimi-code/credentials/account-b.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())

    let credential = try store.credential(for: .kimi, rejecting: nil)

    XCTAssertEqual(credential.accessToken, "current-later-token")
  }

  func testReloadSkipsRejectedKimiCredentialWithinOneSequence() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      #"{"access_token":"first-current-token","expires_at":9999999999999}"#,
      to: root.appendingPathComponent(".kimi-code/credentials/account-a.json")
    )
    try write(
      #"{"access_token":"fallback-token","expires_at":9999999999999}"#,
      to: root.appendingPathComponent(".kimi-code/credentials/account-b.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())

    let firstCredential = try store.credential(for: .kimi, rejecting: nil)
    XCTAssertEqual(firstCredential.accessToken, "first-current-token")
    XCTAssertEqual(
      try store.credential(for: .kimi, rejecting: firstCredential).accessToken,
      "fallback-token"
    )
    // A later bare rejecting: nil call marks a fresh top-level fetch (e.g. the next scheduled
    // refresh), not a continuation of this replacement sequence - it must not stay permanently
    // blocked by a rejection from an earlier sequence.
    XCTAssertEqual(
      try store.credential(for: .kimi, rejecting: nil).accessToken,
      "first-current-token"
    )
  }

  func testReloadAdvancesAcrossGrokCLISessions() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      grokCLIAuth(
        firstToken: "first-current-token",
        secondToken: "fallback-token"
      ),
      to: root.appendingPathComponent(".grok/auth.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())

    let firstCredential = try store.credential(for: .grok, rejecting: nil)
    XCTAssertEqual(firstCredential.accessToken, "first-current-token")
    XCTAssertEqual(
      try store.credential(for: .grok, rejecting: firstCredential).accessToken,
      "fallback-token"
    )
  }

  func testConcurrentRejectionsOnlyExcludeFailedCredential() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      grokCLIAuth(
        firstToken: "rejected-token",
        secondToken: "accepted-token"
      ),
      to: root.appendingPathComponent(".grok/auth.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    let firstRequest = try store.credential(for: .grok, rejecting: nil)
    let concurrentRequest = try store.credential(for: .grok, rejecting: nil)

    let firstRetry = try store.credential(for: .grok, rejecting: firstRequest)
    let concurrentRetry = try store.credential(for: .grok, rejecting: concurrentRequest)

    XCTAssertEqual(firstRetry.accessToken, "accepted-token")
    XCTAssertEqual(concurrentRetry.accessToken, "accepted-token")
    // A subsequent bare rejecting: nil call is a fresh top-level fetch, not a continuation of
    // this replacement sequence, so it re-offers the originally-discovered candidate rather
    // than staying permanently blocked by this sequence's rejection.
    XCTAssertEqual(
      try store.credential(for: .grok, rejecting: nil).accessToken,
      "rejected-token"
    )
  }

  func testUnauthorizedHTTPRetryUsesNextLocalCredential() async throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      grokCLIAuth(
        firstToken: "rejected-token",
        secondToken: "accepted-token"
      ),
      to: root.appendingPathComponent(".grok/auth.json")
    )
    let transport = StubTransport([
      .success(ProviderResponse(statusCode: 401, data: Data())),
      .success(ProviderResponse(statusCode: 200, data: Data("usage".utf8))),
    ])
    let credentials = LocalCredentialStore(
      homeDirectory: root,
      claudeKeychain: FakeKeychain()
    )
    let client = ProviderHTTPClient(transport: transport, credentials: credentials)
    let url = try XCTUnwrap(URL(string: "https://example.com/usage"))

    let data = try await client.get(provider: .grok, url: url)

    XCTAssertEqual(data, Data("usage".utf8))
    let requests = await transport.requests
    XCTAssertEqual(requests.map(\.bearerToken), ["rejected-token", "accepted-token"])
  }

  func testMalformedStoreFailsWithoutSearchingArbitraryFields() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      #"{"unrelated":"this-must-not-be-used-as-a-token"}"#,
      to: root.appendingPathComponent(".codex/auth.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    do {
      _ = try store.credential(for: .codex, rejecting: nil)
      XCTFail("Expected missing credentials")
    } catch {
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.codex))
    }

    try write("not-json", to: root.appendingPathComponent(".codex/auth.json"))
    XCTAssertThrowsError(try store.credential(for: .codex, rejecting: nil))
  }

  private func write(_ value: String, to url: URL) throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data(value.utf8).write(to: url)
  }
}

func XCTAssertThrowsErrorAsync<Value>(
  _ expression: () async throws -> Value,
  file: StaticString = #filePath,
  line: UInt = #line
) async {
  do {
    _ = try await expression()
    XCTFail("Expected error", file: file, line: line)
  } catch {
    return
  }
}
