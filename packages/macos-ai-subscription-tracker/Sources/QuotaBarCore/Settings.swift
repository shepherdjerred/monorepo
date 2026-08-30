public import Foundation
public import Observation

public protocol SettingsPersisting: Sendable {
  func enabledProviders() throws -> Set<ProviderID>?
  func showsLegacyProviders() throws -> Bool?
  func pollingInterval() throws -> TimeInterval?
  func save(
    enabledProviders: Set<ProviderID>,
    showsLegacyProviders: Bool,
    pollingInterval: TimeInterval
  )
}

public final class UserDefaultsSettingsStore: SettingsPersisting, @unchecked Sendable {
  private static let standardProvidersVersion = 1
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
    let storedVersion = defaults.integer(forKey: "standardProvidersVersion")
    if storedVersion < Self.standardProvidersVersion {
      providers.formUnion([.antigravity, .cursor])
      defaults.set(providers.map(\.rawValue).sorted(), forKey: "enabledProviders")
      defaults.set(Self.standardProvidersVersion, forKey: "standardProvidersVersion")
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

  public func showsLegacyProviders() throws -> Bool? {
    guard let storedValue = defaults.object(forKey: "showsLegacyProviders") else { return nil }
    guard let value = storedValue as? Bool else { throw QuotaError.settingsCorrupt }
    return value
  }

  public func save(
    enabledProviders: Set<ProviderID>,
    showsLegacyProviders: Bool,
    pollingInterval: TimeInterval
  ) {
    let unknownIdentifiers = (defaults.stringArray(forKey: "enabledProviders") ?? [])
      .filter { ProviderID(rawValue: $0) == nil }
    let knownIdentifiers = enabledProviders.map(\.rawValue)
    defaults.set(Set(knownIdentifiers + unknownIdentifiers).sorted(), forKey: "enabledProviders")
    defaults.set(Self.standardProvidersVersion, forKey: "standardProvidersVersion")
    defaults.set(showsLegacyProviders, forKey: "showsLegacyProviders")
    defaults.set(pollingInterval, forKey: "pollingInterval")
  }
}

@MainActor @Observable
public final class AppSettings {
  public private(set) var enabledProviders: Set<ProviderID>
  public private(set) var showsLegacyProviders: Bool
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
      self.enabledProviders = try store.enabledProviders() ?? ProviderID.standard
    } catch {
      self.enabledProviders = ProviderID.standard
      corrupted = true
    }
    do {
      self.pollingInterval = max(minimumPollingInterval, try store.pollingInterval() ?? 300)
    } catch {
      self.pollingInterval = minimumPollingInterval
      corrupted = true
    }
    do {
      self.showsLegacyProviders = try store.showsLegacyProviders() ?? false
    } catch {
      self.showsLegacyProviders = false
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

  public func setShowsLegacyProviders(_ showsLegacyProviders: Bool) {
    self.showsLegacyProviders = showsLegacyProviders
    if showsLegacyProviders {
      enabledProviders.formUnion(ProviderID.legacy)
    }
    save()
  }

  public var visibleProviderIDs: Set<ProviderID> {
    ProviderID.standard.union(showsLegacyProviders ? ProviderID.legacy : [])
  }

  private func save() {
    store.save(
      enabledProviders: enabledProviders,
      showsLegacyProviders: showsLegacyProviders,
      pollingInterval: pollingInterval
    )
  }
}
