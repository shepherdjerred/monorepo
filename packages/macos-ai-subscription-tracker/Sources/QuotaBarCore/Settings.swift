public import Foundation
public import Observation

public protocol SettingsPersisting: Sendable {
  func enabledProviders() throws -> Set<ProviderID>?
  func pollingInterval() throws -> TimeInterval?
  func save(enabledProviders: Set<ProviderID>, pollingInterval: TimeInterval)
}

public final class UserDefaultsSettingsStore: SettingsPersisting, @unchecked Sendable {
  private let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  public func enabledProviders() throws -> Set<ProviderID>? {
    guard let storedValue = defaults.object(forKey: "enabledProviders") else { return nil }
    guard let values = storedValue as? [String] else { throw QuotaError.settingsCorrupt }
    var providers: Set<ProviderID> = []
    for value in values {
      guard let provider = ProviderID(rawValue: value) else {
        throw QuotaError.settingsCorrupt
      }
      providers.insert(provider)
    }
    return providers
  }

  public func pollingInterval() throws -> TimeInterval? {
    guard let storedValue = defaults.object(forKey: "pollingInterval") else { return nil }
    guard let value = storedValue as? Double, value.isFinite else {
      throw QuotaError.settingsCorrupt
    }
    return value
  }

  public func save(enabledProviders: Set<ProviderID>, pollingInterval: TimeInterval) {
    let unknownIdentifiers = (defaults.stringArray(forKey: "enabledProviders") ?? [])
      .filter { ProviderID(rawValue: $0) == nil }
    let knownIdentifiers = enabledProviders.map(\.rawValue)
    defaults.set(Set(knownIdentifiers + unknownIdentifiers).sorted(), forKey: "enabledProviders")
    defaults.set(pollingInterval, forKey: "pollingInterval")
  }
}

@MainActor @Observable
public final class AppSettings {
  public private(set) var enabledProviders: Set<ProviderID>
  public private(set) var pollingInterval: TimeInterval
  public private(set) var validationErrorMessage: String?

  private let store: any SettingsPersisting
  private let minimumPollingInterval: TimeInterval

  public init(
    store: any SettingsPersisting = UserDefaultsSettingsStore(),
    minimumPollingInterval: TimeInterval = 60
  ) {
    self.store = store
    self.minimumPollingInterval = minimumPollingInterval
    var corrupted = false
    do {
      self.enabledProviders = try store.enabledProviders() ?? Set(ProviderID.allCases)
    } catch {
      self.enabledProviders = Set(ProviderID.allCases)
      corrupted = true
    }
    do {
      self.pollingInterval = max(minimumPollingInterval, try store.pollingInterval() ?? 300)
    } catch {
      self.pollingInterval = minimumPollingInterval
      corrupted = true
    }
    self.validationErrorMessage = corrupted ? QuotaError.settingsCorrupt.localizedDescription : nil
  }

  public func setProvider(_ provider: ProviderID, enabled: Bool) {
    if enabled {
      enabledProviders.insert(provider)
    } else {
      enabledProviders.remove(provider)
    }
    save()
  }

  public func setPollingInterval(_ interval: TimeInterval) {
    pollingInterval = max(minimumPollingInterval, interval)
    save()
  }

  private func save() {
    store.save(enabledProviders: enabledProviders, pollingInterval: pollingInterval)
  }
}
