import Foundation
import XCTest

@testable import QuotaBarCore

final class PersistenceSettingsTests: XCTestCase {
  func testCacheRoundTripAndMissingCache() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = JSONSnapshotStore(url: root.appendingPathComponent("cache/snapshots.json"))
    XCTAssertTrue(try store.load().isEmpty)
    let value = snapshot(provider: .codex, remaining: 80)
    try store.save([.codex: value])
    XCTAssertEqual(try store.load(), [.codex: value])
  }

  func testCorruptDuplicateAndStaleCachesFail() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let url = root.appendingPathComponent("snapshots.json")
    try Data("not-json".utf8).write(to: url)
    XCTAssertThrowsError(try JSONSnapshotStore(url: url).load())

    let value = snapshot(provider: .codex, remaining: 80)
    try JSONEncoder().encode([value, value]).write(to: url)
    XCTAssertThrowsError(try JSONSnapshotStore(url: url).load())
    XCTAssertThrowsError(
      try JSONSnapshotStore(url: url).save([.codex: value.markedStale(reason: "old")])
    )
  }

  func testCacheWriteFailureIsObservable() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let blockingFile = root.appendingPathComponent("blocked")
    try Data("file".utf8).write(to: blockingFile)
    let store = JSONSnapshotStore(url: blockingFile.appendingPathComponent("snapshots.json"))
    XCTAssertThrowsError(try store.save([.codex: snapshot(provider: .codex, remaining: 80)]))
  }

  @MainActor
  func testSettingsLoadClampAndPersist() {
    let store = MemorySettingsStore(enabled: [.codex], interval: 5)
    let settings = AppSettings(store: store, minimumPollingInterval: 60)
    XCTAssertEqual(settings.enabledProviders, [.codex])
    XCTAssertEqual(settings.pollingInterval, 60)
    settings.setProvider(.grok, enabled: true)
    settings.setProvider(.codex, enabled: false)
    settings.setPollingInterval(900)
    XCTAssertEqual(settings.enabledProviders, [.grok])
    XCTAssertEqual(settings.pollingInterval, 900)
    XCTAssertEqual(store.savedEnabled, [.grok])
    XCTAssertEqual(store.savedInterval, 900)
  }

  @MainActor
  func testUnknownPersistedProviderIsRejectedAndPreserved() throws {
    let suiteName = "QuotaBarTests.\(UUID().uuidString)"
    guard let defaults = UserDefaults(suiteName: suiteName) else {
      XCTFail("Expected isolated defaults")
      return
    }
    defer { defaults.removePersistentDomain(forName: suiteName) }
    defaults.set([ProviderID.codex.rawValue, "future-provider"], forKey: "enabledProviders")
    let settings = AppSettings(store: UserDefaultsSettingsStore(defaults: defaults))

    XCTAssertEqual(settings.enabledProviders, Set(ProviderID.allCases))
    XCTAssertEqual(
      settings.validationErrorMessage,
      QuotaError.settingsCorrupt.localizedDescription
    )

    settings.setProvider(.grok, enabled: false)
    let savedIdentifiers = try XCTUnwrap(defaults.stringArray(forKey: "enabledProviders"))
    XCTAssertTrue(savedIdentifiers.contains("future-provider"))
    XCTAssertFalse(savedIdentifiers.contains(ProviderID.grok.rawValue))
  }

  @MainActor
  func testLaunchAtLoginReflectsServiceAndRollsBackErrors() {
    let service = FakeLoginItemService(status: .disabled)
    let controller = LaunchAtLoginController(service: service)
    XCTAssertFalse(controller.isEnabled)
    controller.setEnabled(true)
    XCTAssertTrue(controller.isEnabled)
    service.status = .requiresApproval
    controller.refresh()
    XCTAssertEqual(controller.status, .requiresApproval)
    service.shouldFail = true
    controller.setEnabled(false)
    XCTAssertEqual(controller.status, .requiresApproval)
    XCTAssertNotNil(controller.errorMessage)
  }

  private func snapshot(provider: ProviderID, remaining: Double) -> UsageSnapshot {
    UsageSnapshot(
      provider: provider,
      windows: [window(remaining: remaining)],
      sourceTimestamp: date("2026-08-09T00:00:00Z")
    )
  }
}

private final class MemorySettingsStore: SettingsPersisting, @unchecked Sendable {
  private let lock = NSLock()
  private let initialEnabled: Set<ProviderID>?
  private let initialInterval: TimeInterval?
  private(set) var savedEnabled: Set<ProviderID> = []
  private(set) var savedInterval: TimeInterval = 0

  init(enabled: Set<ProviderID>?, interval: TimeInterval?) {
    self.initialEnabled = enabled
    self.initialInterval = interval
  }

  func enabledProviders() -> Set<ProviderID>? { initialEnabled }
  func pollingInterval() -> TimeInterval? { initialInterval }

  func save(enabledProviders: Set<ProviderID>, pollingInterval: TimeInterval) {
    lock.withLock {
      savedEnabled = enabledProviders
      savedInterval = pollingInterval
    }
  }
}

@MainActor
private final class FakeLoginItemService: LoginItemService {
  var status: LoginItemStatus
  var shouldFail = false

  init(status: LoginItemStatus) {
    self.status = status
  }

  func register() throws {
    if shouldFail { throw QuotaError.network(.codex) }
    status = .enabled
  }

  func unregister() throws {
    if shouldFail { throw QuotaError.network(.codex) }
    status = .disabled
  }
}
