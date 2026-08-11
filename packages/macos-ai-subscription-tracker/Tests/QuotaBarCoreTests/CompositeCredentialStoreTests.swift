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

  func testRejectedManualCredentialIsNotOfferedAgainAfterLaterRejection() async throws {
    let stores = try await makeStores()
    defer { try? FileManager.default.removeItem(at: stores.root) }

    let manualCredential = try await stores.composite.credential(for: .codex, rejecting: nil)
    XCTAssertEqual(manualCredential.accessToken, "manual-token")
    let localCredential = try await stores.composite.credential(
      for: .codex, rejecting: manualCredential)
    XCTAssertEqual(localCredential.accessToken, "local-token")

    // Once the local credential is also rejected, the composite store must not re-offer the
    // manual credential it already handed out and saw rejected earlier in this same sequence -
    // otherwise a caller retrying on 401 alternates between the two forever.
    do {
      _ = try await stores.composite.credential(for: .codex, rejecting: localCredential)
      XCTFail("Expected credentialsMissing once every known credential has been rejected")
    } catch {
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.codex))
    }
  }

  func testRejectionHistoryResetsOnFreshTopLevelResolution() async throws {
    let stores = try await makeStores()
    defer { try? FileManager.default.removeItem(at: stores.root) }

    let manualCredential = try await stores.composite.credential(for: .codex, rejecting: nil)
    XCTAssertEqual(manualCredential.accessToken, "manual-token")
    _ = try await stores.composite.credential(for: .codex, rejecting: manualCredential)

    // A transient rejection must not permanently suppress the manual override: the next
    // scheduled refresh (or a credential re-save, which also triggers a fresh top-level
    // resolution) starts a new replacement sequence and should see it again.
    let freshCredential = try await stores.composite.credential(for: .codex, rejecting: nil)
    XCTAssertEqual(freshCredential.accessToken, "manual-token")
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
