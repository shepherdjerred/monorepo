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

  func testMuseApiKeyLoginWithKeychainStorageCarriesNoSubscription() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try write(
      #"{"schema_version":2,"providers":{"meta":{"mechanism":"api_key","storage":"keychain"}}}"#,
      to: root.appendingPathComponent(".config/muse/auth.json")
    )
    let keychain = FakeKeychain()
    try keychain.write(
      Data(#"{"secret_schema_version":2,"access_token":"model-api-key"}"#.utf8),
      service: "ai.meta.dev.credentials",
      account: "meta"
    )
    let store = LocalCredentialStore(
      homeDirectory: root, claudeKeychain: FakeKeychain(), museKeychain: keychain)
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: nil)) { error in
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.muse))
    }
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

  func testMuseKeychainTokenIsCachedAcrossReads() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let authURL = root.appendingPathComponent(".config/muse/auth.json")
    try write(museKeychainModeAuth, to: authURL)
    try setMTime(museFileMTime, for: authURL)
    let keychain = CountingKeychain(data: museBundle(token: "cached-token"))
    let clock = ManualClock(now: museNow)
    let store = LocalCredentialStore(
      homeDirectory: root, museKeychain: keychain, dateProvider: { clock.now })
    let first = try store.credential(for: .muse, rejecting: nil)
    let second = try store.credential(for: .muse, rejecting: nil)
    XCTAssertEqual(first.accessToken, "cached-token")
    XCTAssertEqual(second.accessToken, "cached-token")
    XCTAssertEqual(keychain.reads, 1)
  }

  func testMuseKeychainRereadsWhenAuthFileChanges() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let authURL = root.appendingPathComponent(".config/muse/auth.json")
    try write(museKeychainModeAuth, to: authURL)
    try setMTime(museFileMTime, for: authURL)
    let keychain = CountingKeychain(data: museBundle(token: "old-token"))
    let clock = ManualClock(now: museNow)
    let store = LocalCredentialStore(
      homeDirectory: root, museKeychain: keychain, dateProvider: { clock.now })
    let first = try store.credential(for: .muse, rejecting: nil)
    XCTAssertEqual(first.accessToken, "old-token")
    keychain.data = museBundle(token: "rotated-token")
    try setMTime(museFileMTime.addingTimeInterval(60), for: authURL)
    let second = try store.credential(for: .muse, rejecting: nil)
    XCTAssertEqual(second.accessToken, "rotated-token")
    XCTAssertEqual(keychain.reads, 2)
  }

  func testMuseRejectingCachedTokenBypassesCache() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let authURL = root.appendingPathComponent(".config/muse/auth.json")
    try write(museKeychainModeAuth, to: authURL)
    try setMTime(museFileMTime, for: authURL)
    let keychain = CountingKeychain(data: museBundle(token: "stale-token"))
    let clock = ManualClock(now: museNow)
    let store = LocalCredentialStore(
      homeDirectory: root, museKeychain: keychain, dateProvider: { clock.now })
    let first = try store.credential(for: .muse, rejecting: nil)
    keychain.data = museBundle(token: "fresh-token")
    let second = try store.credential(for: .muse, rejecting: first)
    XCTAssertEqual(second.accessToken, "fresh-token")
    XCTAssertEqual(keychain.reads, 2)
  }

  func testMuseKeychainFailureBacksOff() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let authURL = root.appendingPathComponent(".config/muse/auth.json")
    try write(museKeychainModeAuth, to: authURL)
    try setMTime(museFileMTime, for: authURL)
    let keychain = CountingKeychain()
    keychain.error = QuotaError.commandFailed("security")
    let clock = ManualClock(now: museNow)
    let store = LocalCredentialStore(
      homeDirectory: root, museKeychain: keychain, dateProvider: { clock.now })
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: nil)) { error in
      XCTAssertEqual(error as? QuotaError, .commandFailed("security"))
    }
    XCTAssertEqual(keychain.reads, 1)
    clock.advance(by: 600)
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: nil)) { error in
      XCTAssertEqual(error as? QuotaError, .commandFailed("security"))
    }
    XCTAssertEqual(keychain.reads, 1)
    // A rotation lifts the backoff immediately.
    try setMTime(museFileMTime.addingTimeInterval(60), for: authURL)
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: nil)) { error in
      XCTAssertEqual(error as? QuotaError, .commandFailed("security"))
    }
    XCTAssertEqual(keychain.reads, 2)
    // The cooldown expiring lifts it too.
    clock.advance(by: MuseKeychainCredentialCache.failureCooldown + 1)
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: nil)) { error in
      XCTAssertEqual(error as? QuotaError, .commandFailed("security"))
    }
    XCTAssertEqual(keychain.reads, 3)
    // A clean read after a rotation clears the failure.
    try setMTime(museFileMTime.addingTimeInterval(120), for: authURL)
    keychain.error = nil
    keychain.data = museBundle(token: "recovered-token")
    let recovered = try store.credential(for: .muse, rejecting: nil)
    XCTAssertEqual(recovered.accessToken, "recovered-token")
    XCTAssertEqual(keychain.reads, 4)
    keychain.error = QuotaError.commandFailed("security")
    let served = try store.credential(for: .muse, rejecting: nil)
    XCTAssertEqual(served.accessToken, "recovered-token")
    XCTAssertEqual(keychain.reads, 4)
    // Bypassing the cache replays the failure instead of tripping suppression.
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: recovered)) { error in
      XCTAssertEqual(error as? QuotaError, .commandFailed("security"))
    }
    XCTAssertEqual(keychain.reads, 5)
  }

  func testMuseCacheIgnoredWhenAuthModeChanges() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let authURL = root.appendingPathComponent(".config/muse/auth.json")
    try write(museKeychainModeAuth, to: authURL)
    try setMTime(museFileMTime, for: authURL)
    let keychain = CountingKeychain(data: museBundle(token: "cached-token"))
    let clock = ManualClock(now: museNow)
    let store = LocalCredentialStore(
      homeDirectory: root, museKeychain: keychain, dateProvider: { clock.now })
    let first = try store.credential(for: .muse, rejecting: nil)
    XCTAssertEqual(first.accessToken, "cached-token")
    try write(museApiKeyAuth, to: authURL)
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: nil)) { error in
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.muse))
    }
  }

  func testMuseMissingKeychainItemDoesNotBackOff() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let authURL = root.appendingPathComponent(".config/muse/auth.json")
    try write(museKeychainModeAuth, to: authURL)
    try setMTime(museFileMTime, for: authURL)
    let keychain = CountingKeychain()
    let clock = ManualClock(now: museNow)
    let store = LocalCredentialStore(
      homeDirectory: root, museKeychain: keychain, dateProvider: { clock.now })
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: nil)) { error in
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.muse))
    }
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: nil)) { error in
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.muse))
    }
    XCTAssertEqual(keychain.reads, 2)
  }

  func testMuseRejectedUnchangedTokenSuppressesRereads() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let authURL = root.appendingPathComponent(".config/muse/auth.json")
    try write(museKeychainModeAuth, to: authURL)
    try setMTime(museFileMTime, for: authURL)
    let keychain = CountingKeychain(data: museBundle(token: "revoked-token"))
    let clock = ManualClock(now: museNow)
    let store = LocalCredentialStore(
      homeDirectory: root, museKeychain: keychain, dateProvider: { clock.now })
    let first = try store.credential(for: .muse, rejecting: nil)
    XCTAssertEqual(first.accessToken, "revoked-token")
    // The 401 retry re-reads the same unusable token: no replacement exists.
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: first)) { error in
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.muse))
    }
    XCTAssertEqual(keychain.reads, 2)
    // Further bypassing reads are suppressed instead of prompting again.
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: first)) { error in
      XCTAssertEqual(error as? QuotaError, .commandFailed("security"))
    }
    XCTAssertEqual(keychain.reads, 2)
    // A rotation lifts the suppression.
    keychain.data = museBundle(token: "rotated-token")
    try setMTime(museFileMTime.addingTimeInterval(60), for: authURL)
    let rotated = try store.credential(for: .muse, rejecting: first)
    XCTAssertEqual(rotated.accessToken, "rotated-token")
    XCTAssertEqual(keychain.reads, 3)
  }

  func testMuseMalformedKeychainBundleBacksOff() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let authURL = root.appendingPathComponent(".config/muse/auth.json")
    try write(museKeychainModeAuth, to: authURL)
    try setMTime(museFileMTime, for: authURL)
    let keychain = CountingKeychain(data: Data("truncated { not valid json".utf8))
    let clock = ManualClock(now: museNow)
    let store = LocalCredentialStore(
      homeDirectory: root, museKeychain: keychain, dateProvider: { clock.now })
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: nil)) { error in
      XCTAssertEqual(error as? QuotaError, .malformedResponse(.muse))
    }
    XCTAssertEqual(keychain.reads, 1)
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: nil)) { error in
      XCTAssertEqual(error as? QuotaError, .commandFailed("security"))
    }
    XCTAssertEqual(keychain.reads, 1)
    try setMTime(museFileMTime.addingTimeInterval(60), for: authURL)
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: nil)) { error in
      XCTAssertEqual(error as? QuotaError, .malformedResponse(.muse))
    }
    XCTAssertEqual(keychain.reads, 2)
  }

  func testMuseTokenlessKeychainBundleBacksOff() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let authURL = root.appendingPathComponent(".config/muse/auth.json")
    try write(museKeychainModeAuth, to: authURL)
    try setMTime(museFileMTime, for: authURL)
    let keychain = CountingKeychain(data: Data(#"{"secret_schema_version":2}"#.utf8))
    let clock = ManualClock(now: museNow)
    let store = LocalCredentialStore(
      homeDirectory: root, museKeychain: keychain, dateProvider: { clock.now })
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: nil)) { error in
      XCTAssertEqual(error as? QuotaError, .credentialsMissing(.muse))
    }
    XCTAssertEqual(keychain.reads, 1)
    XCTAssertThrowsError(try store.credential(for: .muse, rejecting: nil)) { error in
      XCTAssertEqual(error as? QuotaError, .commandFailed("security"))
    }
    XCTAssertEqual(keychain.reads, 1)
  }
}

private let museKeychainModeAuth =
  #"{"schema_version":2,"providers":{"meta":{"mechanism":"oauth","storage":"keychain"}}}"#
private let museApiKeyAuth =
  #"{"schema_version":2,"providers":{"meta":{"mechanism":"api_key","access_token":"key-token"}}}"#
private let museFileMTime = Date(timeIntervalSince1970: 1_800_000_000)
private let museNow = Date(timeIntervalSince1970: 1_800_000_100)

private func museBundle(token: String) -> Data {
  Data(#"{"secret_schema_version":2,"access_token":"\#(token)"}"#.utf8)
}

private func setMTime(_ date: Date, for url: URL) throws {
  try FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: url.path)
}

private final class CountingKeychain: KeychainReading, @unchecked Sendable {
  private let lock = NSLock()
  private var storedData: Data?
  private var storedError: (any Error)?
  private var storedReads = 0

  init(data: Data? = nil) {
    storedData = data
  }

  var data: Data? {
    get { lock.withLock { storedData } }
    set { lock.withLock { storedData = newValue } }
  }

  var error: (any Error)? {
    get { lock.withLock { storedError } }
    set { lock.withLock { storedError = newValue } }
  }

  var reads: Int { lock.withLock { storedReads } }

  func read(service _: String, account _: String?) throws -> Data? {
    lock.withLock { storedReads += 1 }
    let snapshot = lock.withLock { (storedError, storedData) }
    if let error = snapshot.0 { throw error }
    return snapshot.1
  }
}

private final class ManualClock: @unchecked Sendable {
  private let lock = NSLock()
  private var storedNow: Date

  init(now: Date) {
    storedNow = now
  }

  var now: Date {
    lock.withLock { storedNow }
  }

  func advance(by interval: TimeInterval) {
    lock.withLock { storedNow = storedNow.addingTimeInterval(interval) }
  }
}
