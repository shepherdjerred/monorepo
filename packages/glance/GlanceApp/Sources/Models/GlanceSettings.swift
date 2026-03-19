import Foundation
import Observation

// MARK: - SidebarGrouping

/// How services are grouped in the sidebar.
enum SidebarGrouping: String, CaseIterable {
    case alphabetical = "Alphabetical"
    case byCategory = "By Category"
    case byStatus = "By Status"
}

// MARK: - GlanceSettings

/// Persistent settings backed by UserDefaults.
@MainActor @Observable
final class GlanceSettings {
    // MARK: Lifecycle

    init() {
        let defaults = UserDefaults.standard
        defaults.register(defaults: Self.defaultValues)
        self.pollInterval = defaults.double(forKey: "pollInterval")
        self.launchAtLogin = defaults.bool(forKey: "launchAtLogin")
        self.showInDock = defaults.bool(forKey: "showInDock")
        self.notificationsEnabled = defaults.bool(forKey: "notificationsEnabled")
        self.historyRetentionDays = defaults.integer(forKey: "historyRetentionDays")
        self.debugLogging = defaults.bool(forKey: "debugLogging")
        self.hasCompletedOnboarding = defaults.bool(forKey: "hasCompletedOnboarding")
        if let stored = defaults.array(forKey: "enabledProviderIds") as? [String] {
            self.enabledProviderIds = Set(stored)
        } else {
            self.enabledProviderIds = Self.allProviderIds
        }
        if let stored = defaults.array(forKey: "notificationDisabledProviderIds") as? [String] {
            self.notificationDisabledProviderIds = Set(stored)
        } else {
            self.notificationDisabledProviderIds = []
        }
        if let raw = defaults.string(forKey: "sidebarGrouping"),
           let grouping = SidebarGrouping(rawValue: raw)
        {
            self.sidebarGrouping = grouping
        } else {
            self.sidebarGrouping = .alphabetical
        }
    }

    // MARK: Internal

    /// All known provider IDs for default selection.
    static let allProviderIds: Set<String> = ServiceCategory.allCases.reduce(into: Set<String>()) { result, category in
        result.formUnion(category.providerIds)
    }

    var pollInterval: TimeInterval {
        didSet { UserDefaults.standard.set(self.pollInterval, forKey: "pollInterval") }
    }

    var launchAtLogin: Bool {
        didSet { UserDefaults.standard.set(self.launchAtLogin, forKey: "launchAtLogin") }
    }

    var showInDock: Bool {
        didSet { UserDefaults.standard.set(self.showInDock, forKey: "showInDock") }
    }

    var notificationsEnabled: Bool {
        didSet { UserDefaults.standard.set(self.notificationsEnabled, forKey: "notificationsEnabled") }
    }

    var historyRetentionDays: Int {
        didSet { UserDefaults.standard.set(self.historyRetentionDays, forKey: "historyRetentionDays") }
    }

    var debugLogging: Bool {
        didSet { UserDefaults.standard.set(self.debugLogging, forKey: "debugLogging") }
    }

    var hasCompletedOnboarding: Bool {
        didSet { UserDefaults.standard.set(self.hasCompletedOnboarding, forKey: "hasCompletedOnboarding") }
    }

    var enabledProviderIds: Set<String> {
        didSet { UserDefaults.standard.set(Array(self.enabledProviderIds), forKey: "enabledProviderIds") }
    }

    var notificationDisabledProviderIds: Set<String> {
        didSet {
            UserDefaults.standard.set(
                Array(self.notificationDisabledProviderIds),
                forKey: "notificationDisabledProviderIds",
            )
        }
    }

    var sidebarGrouping: SidebarGrouping {
        didSet { UserDefaults.standard.set(self.sidebarGrouping.rawValue, forKey: "sidebarGrouping") }
    }

    /// Check whether notifications are enabled for a specific provider.
    func notificationsEnabled(for providerId: String) -> Bool {
        self.notificationsEnabled && !self.notificationDisabledProviderIds.contains(providerId)
    }

    /// Reset all settings to their default values.
    func resetToDefaults() {
        let defaults = UserDefaults.standard
        for key in Self.defaultValues.keys {
            defaults.removeObject(forKey: key)
        }
        defaults.register(defaults: Self.defaultValues)
        self.pollInterval = Self.defaultValues["pollInterval"] as? TimeInterval ?? 60.0
        self.launchAtLogin = Self.defaultValues["launchAtLogin"] as? Bool ?? false
        self.showInDock = Self.defaultValues["showInDock"] as? Bool ?? false
        self.notificationsEnabled = Self.defaultValues["notificationsEnabled"] as? Bool ?? true
        self.historyRetentionDays = Self.defaultValues["historyRetentionDays"] as? Int ?? 7
        self.debugLogging = Self.defaultValues["debugLogging"] as? Bool ?? false
        self.hasCompletedOnboarding = Self.defaultValues["hasCompletedOnboarding"] as? Bool ?? false
        self.enabledProviderIds = Self.allProviderIds
        self.notificationDisabledProviderIds = []
        self.sidebarGrouping = .alphabetical
    }

    // MARK: Private

    private static let defaultValues: [String: Any] = [
        "pollInterval": 60.0,
        "launchAtLogin": false,
        "showInDock": false,
        "notificationsEnabled": true,
        "historyRetentionDays": 7,
        "debugLogging": false,
        "hasCompletedOnboarding": false,
    ]
}
