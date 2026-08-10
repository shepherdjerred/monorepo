import Foundation
import XCTest

@testable import QuotaBarCore

final class KimiDiscoveryTests: XCTestCase {
  func testKimiDiscoverySkipsNonCredentialDirectoryEntries() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write("junk", to: root.appendingPathComponent(".kimi-code/credentials/.DS_Store"))
    try FileManager.default.createDirectory(
      at: root.appendingPathComponent(".kimi-code/credentials/backup"),
      withIntermediateDirectories: true
    )
    try write(
      #"{"access_token":"current-token","expires_at":9999999999999}"#,
      to: root.appendingPathComponent(".kimi-code/credentials/zzz-account.json")
    )
    let store = LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
    let credential = try store.credential(for: .kimi, rejecting: nil)
    XCTAssertEqual(credential.accessToken, "current-token")
  }
}
