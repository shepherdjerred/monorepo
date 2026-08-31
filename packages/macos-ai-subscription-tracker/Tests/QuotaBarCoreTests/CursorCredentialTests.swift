import Foundation
import SQLite3
import XCTest

@testable import QuotaBarCore

final class CursorCredentialTests: XCTestCase {
  func testCursorReadsOnlyTheLocalApplicationAccessToken() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let database = root.appendingPathComponent("cursor-state.vscdb")
    try createCursorDatabase(at: database, accessToken: "cursor-session-token")
    let original = try Data(contentsOf: database)
    let store = LocalCredentialStore(
      homeDirectory: root,
      cursorStateDatabase: database,
      claudeKeychain: FakeKeychain()
    )

    let credential = try store.credential(for: .cursor, rejecting: nil)

    XCTAssertEqual(credential.accessToken, "cursor-session-token")
    XCTAssertEqual(try Data(contentsOf: database), original)
    do {
      _ = try store.credential(for: .cursor, rejecting: credential)
      XCTFail("Expected the rejected local session not to be offered again")
    } catch {
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.cursor))
    }
  }

  func testCursorMissingSessionIsExplicitlyUnauthenticated() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())

    XCTAssertThrowsError(try store.credential(for: .cursor, rejecting: nil)) { error in
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.cursor))
    }
  }

  private func createCursorDatabase(at url: URL, accessToken: String) throws {
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
    guard
      sqlite3_exec(connection, "CREATE TABLE ItemTable (key TEXT, value TEXT);", nil, nil, nil)
        == SQLITE_OK
    else {
      throw QuotaError.commandFailed("SQLite test fixture")
    }
    let escapedToken = accessToken.replacingOccurrences(of: "'", with: "''")
    let insert =
      "INSERT INTO ItemTable (key, value) VALUES "
      + "('cursorAuth/accessToken', '\(escapedToken)'), "
      + "('cursorAuth/refreshToken', 'must-not-be-read');"
    guard sqlite3_exec(connection, insert, nil, nil, nil) == SQLITE_OK else {
      throw QuotaError.commandFailed("SQLite test fixture")
    }
  }
}
