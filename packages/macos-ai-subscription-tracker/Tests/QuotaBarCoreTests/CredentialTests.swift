import Foundation
import SQLite3
import XCTest

@testable import QuotaBarCore

final class CredentialTests: XCTestCase {
  func testManualKeychainSaveLoadAndRemove() async throws {
    let keychain = FakeKeychain()
    let store = ManualCredentialStore(keychain: keychain)
    let initial = try await store.credentialIfPresent(for: .codex)
    XCTAssertNil(initial)
    try await store.save("  manual-token  ", for: .codex)
    let saved = try await store.credential(for: .codex, reload: false)
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
    let claude = try store.credential(for: .claudeCode, reload: false)
    let codex = try store.credential(for: .codex, reload: false)
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
    let credential = try store.credential(for: .claudeCode, reload: false)
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

    let credential = try store.credential(for: .claudeCode, reload: true)

    XCTAssertEqual(credential.accessToken, "current-keychain-token")
  }

  func testKimiLocalCredentialTakesPrecedenceOverOpenCode() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      #"{"access_token":"kimi-local-token","expires_at":9999999999999}"#,
      to: root.appendingPathComponent(".kimi-code/credentials/account.json")
    )
    try write(
      #"{"kimi-for-coding-oauth":{"access":"opencode-token","expires":9999999999999}}"#,
      to: root.appendingPathComponent(".local/share/opencode/auth.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    let credential = try store.credential(for: .kimi, reload: false)
    XCTAssertEqual(credential.accessToken, "kimi-local-token")
  }

  func testExpiredKimiLocalCredentialFallsBackToOpenCode() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      #"{"access_token":"expired-local-token","expires_at":1}"#,
      to: root.appendingPathComponent(".kimi-code/credentials/account.json")
    )
    try write(
      #"{"kimi-for-coding-oauth":{"access":"fresh-opencode-token","expires":9999999999999}}"#,
      to: root.appendingPathComponent(".local/share/opencode/auth.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())

    let credential = try store.credential(for: .kimi, reload: true)

    XCTAssertEqual(credential.accessToken, "fresh-opencode-token")
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

    let credential = try store.credential(for: .kimi, reload: true)

    XCTAssertEqual(credential.accessToken, "current-later-token")
  }

  func testOpenCodeDatabaseCredentialDiscovery() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let database = root.appendingPathComponent(".local/share/opencode/opencode.db")
    try createOpenCodeDatabase(
      at: database,
      label: "xai",
      value: #"{"access":"database-token","expires":9999999999999}"#
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())

    let credential = try store.credential(for: .grok, reload: false)

    XCTAssertEqual(credential.accessToken, "database-token")
  }

  func testOpenCodeKimiAndGrokFilesRemainUnchanged() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let authURL = root.appendingPathComponent(".local/share/opencode/auth.json")
    let kimiEntry =
      #"{"kimi-for-coding-oauth":{"access":"kimi-opencode","refresh":"never-write","expires":9999999999999},"#
    let grokEntry = #""xai":{"access":"grok-opencode","expires":9999999999999}}"#
    let original = Data((kimiEntry + grokEntry).utf8)
    try FileManager.default.createDirectory(
      at: authURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try original.write(to: authURL)
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    let kimi = try store.credential(for: .kimi, reload: false)
    let grok = try store.credential(for: .grok, reload: true)
    XCTAssertEqual(kimi.accessToken, "kimi-opencode")
    XCTAssertEqual(grok.accessToken, "grok-opencode")
    XCTAssertEqual(try Data(contentsOf: authURL), original)
  }

  func testExpiredOpenCodeCredentialRequiresOpenCodeRefresh() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      #"{"xai":{"access":"expired-grok","expires":1}}"#,
      to: root.appendingPathComponent(".config/opencode/auth.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    do {
      _ = try store.credential(for: .grok, reload: false)
      XCTFail("Expected expiry")
    } catch {
      XCTAssertEqual(error as? QuotaError, .credentialsExpired(.grok))
      XCTAssertTrue(error.localizedDescription.contains("OpenCode"))
    }
  }

  func testExpiredOpenCodeCandidateDoesNotMaskLaterCurrentCredential() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      #"{"xai":{"access":"expired-first-token","expires":1}}"#,
      to: root.appendingPathComponent(".local/share/opencode/auth.json")
    )
    try write(
      #"{"grok":{"access":"current-later-token","expires":9999999999999}}"#,
      to: root.appendingPathComponent(".config/opencode/auth.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())

    let credential = try store.credential(for: .grok, reload: true)

    XCTAssertEqual(credential.accessToken, "current-later-token")
  }

  func testExpiredOpenCodeDatabaseDoesNotMaskLaterCurrentDatabase() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try createOpenCodeDatabase(
      at: root.appendingPathComponent(".local/share/opencode/opencode.db"),
      label: "xai",
      value: #"{"access":"expired-database-token","expires":1}"#
    )
    try createOpenCodeDatabase(
      at: root.appendingPathComponent("Library/Application Support/opencode/opencode.db"),
      label: "grok",
      value: #"{"access":"current-database-token","expires":9999999999999}"#
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())

    let credential = try store.credential(for: .grok, reload: true)

    XCTAssertEqual(credential.accessToken, "current-database-token")
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
      _ = try store.credential(for: .codex, reload: false)
      XCTFail("Expected missing credentials")
    } catch {
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.codex))
    }

    try write("not-json", to: root.appendingPathComponent(".codex/auth.json"))
    XCTAssertThrowsError(try store.credential(for: .codex, reload: true))
  }

  func testManualCredentialPrecedesLocalDiscovery() async throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      #"{"tokens":{"access_token":"local-token"}}"#,
      to: root.appendingPathComponent(".codex/auth.json")
    )
    let manual = ManualCredentialStore(keychain: FakeKeychain())
    try await manual.save("manual-token", for: .codex)
    let composite = CompositeCredentialStore(
      manual: manual,
      local: LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    )
    let credential = try await composite.credential(for: .codex, reload: true)
    XCTAssertEqual(credential.accessToken, "manual-token")
  }

  private func write(_ value: String, to url: URL) throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data(value.utf8).write(to: url)
  }

  private func createOpenCodeDatabase(at url: URL, label: String, value: String) throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    var connection: OpaquePointer?
    guard sqlite3_open(url.path, &connection) == SQLITE_OK, let connection else {
      if let connection { sqlite3_close(connection) }
      throw QuotaError.commandFailed("SQLite test fixture")
    }
    defer { sqlite3_close(connection) }
    let create = "CREATE TABLE credential (label TEXT, value TEXT, active INTEGER);"
    guard sqlite3_exec(connection, create, nil, nil, nil) == SQLITE_OK else {
      throw QuotaError.commandFailed("SQLite test fixture")
    }
    let escapedLabel = label.replacingOccurrences(of: "'", with: "''")
    let escapedValue = value.replacingOccurrences(of: "'", with: "''")
    let insert =
      "INSERT INTO credential (label, value, active) VALUES "
      + "('\(escapedLabel)', '\(escapedValue)', 1);"
    guard sqlite3_exec(connection, insert, nil, nil, nil) == SQLITE_OK else {
      throw QuotaError.commandFailed("SQLite test fixture")
    }
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
