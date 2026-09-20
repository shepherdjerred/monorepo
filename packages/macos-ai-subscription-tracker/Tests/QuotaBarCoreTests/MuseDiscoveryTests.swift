import Foundation
import XCTest

@testable import QuotaBarCore

final class MuseDiscoveryTests: XCTestCase {
  func testMuseDiscoversInlineOAuthToken() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      #"{"schema_version":2,"providers":{"meta":{"mechanism":"oauth","access_token":"inline-token"}}}"#,
      to: root.appendingPathComponent(".config/muse/auth.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    let credential = try store.credential(for: .muse, rejecting: nil)
    XCTAssertEqual(credential.accessToken, "inline-token")
  }

  func testMuseApiKeyLoginCarriesNoSubscription() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      #"{"schema_version":2,"providers":{"meta":{"mechanism":"api_key","access_token":"key-token"}}}"#,
      to: root.appendingPathComponent(".config/muse/auth.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: nil)) { error in
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.muse))
    }
  }

  func testMuseKeychainLoginReadsStoredBundle() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      #"{"schema_version":2,"providers":{"meta":{"mechanism":"oauth","storage":"keychain"}}}"#,
      to: root.appendingPathComponent(".config/muse/auth.json")
    )
    let keychain = FakeKeychain()
    try keychain.write(
      Data(#"{"secret_schema_version":2,"access_token":"keychain-token"}"#.utf8),
      service: "ai.meta.dev.credentials",
      account: "meta"
    )
    let store = LocalCredentialStore(
      homeDirectory: root, claudeKeychain: FakeKeychain(), museKeychain: keychain)
    let credential = try store.credential(for: .muse, rejecting: nil)
    XCTAssertEqual(credential.accessToken, "keychain-token")
  }

  func testMuseMissingEverythingMeansSignIn() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: nil)) { error in
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.muse))
    }
  }

  func testMalformedMuseAuthFilePropagates() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      "truncated { not valid json",
      to: root.appendingPathComponent(".config/muse/auth.json"))
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: nil)) { error in
      XCTAssertEqual(error as? QuotaError, .malformedResponse(.muse))
    }
  }

  func testMuseAuthPathOverrideWins() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let override = root.appendingPathComponent("custom-auth.json")
    try write(
      #"{"schema_version":2,"providers":{"meta":{"mechanism":"oauth","access_token":"override-token"}}}"#,
      to: override
    )
    setenv("MUSE_AUTH_PATH", override.path, 1)
    defer { unsetenv("MUSE_AUTH_PATH") }
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    let credential = try store.credential(for: .muse, rejecting: nil)
    XCTAssertEqual(credential.accessToken, "override-token")
  }
}
