public import Foundation
public import Observation

public protocol SettingsPersisting: Sendable {
  func enabledProviders() -> Set<ProviderID>?
  func pollingInterval() -> TimeInterval?
  func save(enabledProviders: Set<ProviderID>, pollingInterval: TimeInterval)
}

public final class UserDefaultsSettingsStore: SettingsPersisting, @unchecked Sendable {
  private let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  public func enabledProviders() -> Set<ProviderID>? {
    guard let values = defaults.array(forKey: "enabledProviders") as? [String] else { return nil }
    return Set(values.compactMap(ProviderID.init(rawValue:)))
  }

  public func pollingInterval() -> TimeInterval? {
    guard defaults.object(forKey: "pollingInterval") != nil else { return nil }
    return defaults.double(forKey: "pollingInterval")
  }

  public func save(enabledProviders: Set<ProviderID>, pollingInterval: TimeInterval) {
    defaults.set(enabledProviders.map(\.rawValue).sorted(), forKey: "enabledProviders")
    defaults.set(pollingInterval, forKey: "pollingInterval")
  }
}

@MainActor @Observable
public final class AppSettings {
  public private(set) var enabledProviders: Set<ProviderID>
  public private(set) var pollingInterval: TimeInterval

  private let store: any SettingsPersisting
  private let minimumPollingInterval: TimeInterval

  public init(
    store: any SettingsPersisting = UserDefaultsSettingsStore(),
    minimumPollingInterval: TimeInterval = 60
  ) {
    self.store = store
    self.minimumPollingInterval = minimumPollingInterval
    self.enabledProviders = store.enabledProviders() ?? Set(ProviderID.allCases)
    self.pollingInterval = max(minimumPollingInterval, store.pollingInterval() ?? 300)
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
