import Foundation
import XCTest

@testable import QuotaBarCore

final class CompositeCredentialStoreTests: XCTestCase {
  func testManualCredentialPrecedesLocalDiscovery() async throws {
    let stores = try await makeStores()
    defer { try? FileManager.default.removeItem(at: stores.root) }

    let credential = try await stores.composite.credential(for: .codex, rejecting: nil)
    XCTAssertEqual(credential.accessToken, "manual-token")
  }

  func testRejectedManualCredentialFallsBackToLocalDiscovery() async throws {
    let stores = try await makeStores()
    defer { try? FileManager.default.removeItem(at: stores.root) }

    let rejected = try await stores.composite.credential(for: .codex, rejecting: nil)
    let fallback = try await stores.composite.credential(for: .codex, rejecting: rejected)
    XCTAssertEqual(fallback.accessToken, "local-token")
  }

  private func makeStores() async throws -> (
    root: URL,
    composite: CompositeCredentialStore
  ) {
    let root = try temporaryDirectory()
    let authFile = root.appendingPathComponent(".codex/auth.json")
    try FileManager.default.createDirectory(
      at: authFile.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data(#"{"tokens":{"access_token":"local-token"}}"#.utf8).write(to: authFile)

    let manual = ManualCredentialStore(keychain: FakeKeychain())
    try await manual.save("manual-token", for: .codex)
    return (
      root,
      CompositeCredentialStore(
        manual: manual,
        local: LocalCredentialStore(homeDirectory: root, claudeKeychain: FakeKeychain())
      )
    )
  }
}
