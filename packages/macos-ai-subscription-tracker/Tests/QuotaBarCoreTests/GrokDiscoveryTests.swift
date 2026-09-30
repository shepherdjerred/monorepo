import Foundation
import XCTest

@testable import QuotaBarCore

final class GrokDiscoveryTests: XCTestCase {
  func testGrokCLICredentialIsUsedWhenOpenCodeAlsoHasAToken() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      grokCLIAuth(token: "grok-cli-token", expiresAt: "2099-01-01T00:00:00Z"),
      to: root.appendingPathComponent(".grok/auth.json")
    )
    try write(
      #"{"xai":{"access":"opencode-token","expires":9999999999999}}"#,
      to: root.appendingPathComponent(".local/share/opencode/auth.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    let credential = try store.credential(for: .grok, rejecting: nil)
    XCTAssertEqual(credential.accessToken, "grok-cli-token")
  }

  func testOpenCodeGrokTokenIsIgnoredWhenGrokCLIIsMissing() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      #"{"xai":{"access":"opencode-token","expires":9999999999999}}"#,
      to: root.appendingPathComponent(".local/share/opencode/auth.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    do {
      _ = try store.credential(for: .grok, rejecting: nil)
      XCTFail("Expected missing credentials when only OpenCode Grok tokens exist")
    } catch {
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.grok))
    }
  }

  func testExpiredGrokCLICredentialDoesNotFallBackToOpenCode() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      grokCLIAuth(token: "expired-cli-token", expiresAt: "1970-01-01T00:00:01Z"),
      to: root.appendingPathComponent(".grok/auth.json")
    )
    try write(
      #"{"xai":{"access":"fresh-opencode-token","expires":9999999999999}}"#,
      to: root.appendingPathComponent(".local/share/opencode/auth.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    do {
      _ = try store.credential(for: .grok, rejecting: nil)
      XCTFail("Expected expiry from grok CLI, not an OpenCode fallback")
    } catch {
      XCTAssertEqual(error as? QuotaError, .credentialsExpired(.grok))
      XCTAssertTrue(error.localizedDescription.contains("grok login"))
    }
  }

  func testExpiredGrokCLISessionDoesNotMaskLaterCurrentSession() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let auth = """
      {
        "https://auth.x.ai::aaa": {
          "key": "expired-first-token",
          "expires_at": "1970-01-01T00:00:01Z"
        },
        "https://auth.x.ai::bbb": {
          "key": "current-later-token",
          "expires_at": "2099-01-01T00:00:00Z"
        }
      }
      """
    try write(auth, to: root.appendingPathComponent(".grok/auth.json"))
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    let credential = try store.credential(for: .grok, rejecting: nil)
    XCTAssertEqual(credential.accessToken, "current-later-token")
  }

  func testGrokCLIAuthFileRemainsUnchanged() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let authURL = root.appendingPathComponent(".grok/auth.json")
    let original = Data(
      grokCLIAuth(token: "grok-cli-token", expiresAt: "2099-01-01T00:00:00.544286Z").utf8)
    try FileManager.default.createDirectory(
      at: authURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try original.write(to: authURL)
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    let credential = try store.credential(for: .grok, rejecting: nil)
    XCTAssertEqual(credential.accessToken, "grok-cli-token")
    XCTAssertEqual(try Data(contentsOf: authURL), original)
  }

  func testGrokHomeRelocation() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let relocated = root.appendingPathComponent("custom-grok")
    try write(
      grokCLIAuth(token: "relocated-cli-token", expiresAt: "2099-01-01T00:00:00Z"),
      to: relocated.appendingPathComponent("auth.json")
    )
    try write(
      grokCLIAuth(token: "default-home-token", expiresAt: "2099-01-01T00:00:00Z"),
      to: root.appendingPathComponent(".grok/auth.json")
    )
    let store = LocalCredentialStore(
      homeDirectory: root,
      grokHome: relocated,
      claudeKeychain: FakeKeychain()
    )
    let credential = try store.credential(for: .grok, rejecting: nil)
    XCTAssertEqual(credential.accessToken, "relocated-cli-token")
  }

  func testMalformedGrokCLIAuthPropagates() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write("truncated { not valid json", to: root.appendingPathComponent(".grok/auth.json"))
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    do {
      _ = try store.credential(for: .grok, rejecting: nil)
      XCTFail("Expected malformedResponse for a corrupted grok CLI auth file")
    } catch {
      XCTAssertEqual(error as? QuotaError, .malformedResponse(.grok))
    }
  }

  func testRejectedGrokCLICredentialDoesNotFallBackToOpenCode() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      grokCLIAuth(token: "cli-token", expiresAt: "2099-01-01T00:00:00Z"),
      to: root.appendingPathComponent(".grok/auth.json")
    )
    try write(
      #"{"xai":{"access":"opencode-token","expires":9999999999999}}"#,
      to: root.appendingPathComponent(".local/share/opencode/auth.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    let first = try store.credential(for: .grok, rejecting: nil)
    XCTAssertEqual(first.accessToken, "cli-token")
    do {
      _ = try store.credential(for: .grok, rejecting: first)
      XCTFail("Expected missing credentials rather than an OpenCode fallback")
    } catch {
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.grok))
    }
  }

  func testRejectedGrokCLISessionAdvancesToLaterCurrentSession() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      """
      {
        "https://auth.x.ai::aaa": {
          "key": "first-current-token",
          "expires_at": "2099-01-01T00:00:00Z"
        },
        "https://auth.x.ai::bbb": {
          "key": "fallback-token",
          "expires_at": "2099-01-01T00:00:00Z"
        }
      }
      """,
      to: root.appendingPathComponent(".grok/auth.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    let first = try store.credential(for: .grok, rejecting: nil)
    XCTAssertEqual(first.accessToken, "first-current-token")
    XCTAssertEqual(
      try store.credential(for: .grok, rejecting: first).accessToken,
      "fallback-token"
    )
  }
}
