import ServiceManagement
import SwiftUI

// MARK: - SettingsView

/// Settings window with tabbed panes for app configuration.
struct SettingsView: View {
    @Bindable var settings: GlanceSettings

    var body: some View {
        TabView {
            GeneralSettingsPane(settings: self.settings)
                .tabItem {
                    Label("General", systemImage: "gear")
                }
            ServicesSettingsPane(settings: self.settings)
                .tabItem {
                    Label("Services", systemImage: "square.grid.2x2")
                }
            AppearanceSettingsPane(settings: self.settings)
                .tabItem {
                    Label("Appearance", systemImage: "paintbrush")
                }
            NotificationSettingsPane(settings: self.settings)
                .tabItem {
                    Label("Notifications", systemImage: "bell")
                }
            AdvancedSettingsPane(settings: self.settings)
                .tabItem {
                    Label("Advanced", systemImage: "gearshape.2")
                }
        }
        .frame(width: 500, height: 400)
    }
}

// MARK: - Provider display info

/// Display metadata for each provider, shared across settings panes.
private let providerDisplayInfo: [String: (displayName: String, iconName: String)] = [
    "alertmanager": ("Alertmanager", "bell.badge"),
    "anthropic-api": ("Anthropic API", "brain.head.profile"),
    "argocd": ("ArgoCD", "arrow.triangle.2.circlepath"),
    "buildkite": ("Buildkite", "hammer.fill"),
    "bugsink": ("Bugsink", "ladybug.fill"),
    "certmanager": ("Cert-Manager", "lock.shield"),
    "claude-code": ("Claude Code", "terminal.fill"),
    "cloudflare": ("Cloudflare", "cloud.fill"),
    "codex": ("Codex", "chevron.left.forwardslash.chevron.right"),
    "github": ("GitHub", "chevron.left.forwardslash.chevron.right"),
    "grafana": ("Grafana", "chart.bar.xaxis"),
    "kubernetes": ("Kubernetes", "server.rack"),
    "loki": ("Loki", "doc.text.magnifyingglass"),
    "openai-api": ("OpenAI API", "sparkles"),
    "pagerduty": ("PagerDuty", "phone.badge.waveform.fill"),
    "prometheus": ("Prometheus", "flame"),
    "talos": ("Talos", "cpu"),
    "velero": ("Velero", "arrow.clockwise.icloud"),
]

private func providerDisplayName(for providerId: String) -> String {
    providerDisplayInfo[providerId]?.displayName ?? providerId
}

private func providerIconName(for providerId: String) -> String {
    providerDisplayInfo[providerId]?.iconName ?? "questionmark.circle"
}

// MARK: - GeneralSettingsPane

private struct GeneralSettingsPane: View {
    // MARK: Internal

    @Bindable var settings: GlanceSettings

    var body: some View {
        Form {
            Picker("Poll interval:", selection: self.$settings.pollInterval) {
                Text("30 seconds").tag(TimeInterval(30))
                Text("60 seconds").tag(TimeInterval(60))
                Text("2 minutes").tag(TimeInterval(120))
                Text("5 minutes").tag(TimeInterval(300))
            }

            Toggle("Launch at login", isOn: self.$settings.launchAtLogin)
                .onChange(of: self.settings.launchAtLogin) { _, newValue in
                    self.updateLaunchAtLogin(enabled: newValue)
                }

            Toggle("Show in Dock", isOn: self.$settings.showInDock)
        }
        .padding()
    }

    // MARK: Private

    private func updateLaunchAtLogin(enabled: Bool) {
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            // Revert the toggle on failure
            self.settings.launchAtLogin = !enabled
        }
    }
}

// MARK: - ServicesSettingsPane

private struct ServicesSettingsPane: View {
    @Bindable var settings: GlanceSettings

    var body: some View {
        Form {
            ForEach(ServiceCategory.allCases, id: \.self) { category in
                Section(category.displayName) {
                    ForEach(category.providerIds.sorted(), id: \.self) { providerId in
                        let isEnabled = self.settings.enabledProviderIds.contains(providerId)
                        Toggle(isOn: Binding(
                            get: { isEnabled },
                            set: { newValue in
                                if newValue {
                                    self.settings.enabledProviderIds.insert(providerId)
                                } else {
                                    self.settings.enabledProviderIds.remove(providerId)
                                }
                            },
                        )) {
                            Label(
                                providerDisplayName(for: providerId),
                                systemImage: providerIconName(for: providerId),
                            )
                        }
                    }
                }
            }
        }
        .padding()
    }
}

// MARK: - AppearanceSettingsPane

private struct AppearanceSettingsPane: View {
    @Bindable var settings: GlanceSettings

    var body: some View {
        Form {
            Picker("Sidebar grouping:", selection: self.$settings.sidebarGrouping) {
                ForEach(SidebarGrouping.allCases, id: \.self) { grouping in
                    Text(grouping.rawValue).tag(grouping)
                }
            }
        }
        .padding()
    }
}

// MARK: - NotificationSettingsPane

private struct NotificationSettingsPane: View {
    @Bindable var settings: GlanceSettings

    var body: some View {
        Form {
            Toggle("Enable notifications", isOn: self.$settings.notificationsEnabled)

            if self.settings.notificationsEnabled {
                Section("Per-service notifications") {
                    ForEach(GlanceSettings.allProviderIds.sorted(), id: \.self) { providerId in
                        let isDisabled = self.settings.notificationDisabledProviderIds.contains(providerId)
                        Toggle(isOn: Binding(
                            get: { !isDisabled },
                            set: { enabled in
                                if enabled {
                                    self.settings.notificationDisabledProviderIds.remove(providerId)
                                } else {
                                    self.settings.notificationDisabledProviderIds.insert(providerId)
                                }
                            },
                        )) {
                            Text(providerDisplayName(for: providerId))
                        }
                    }
                }
            }
        }
        .padding()
    }
}

// MARK: - AdvancedSettingsPane

private struct AdvancedSettingsPane: View {
    // MARK: Internal

    @Bindable var settings: GlanceSettings

    var body: some View {
        Form {
            Picker("History retention:", selection: self.$settings.historyRetentionDays) {
                Text("1 day").tag(1)
                Text("3 days").tag(3)
                Text("7 days").tag(7)
                Text("14 days").tag(14)
                Text("30 days").tag(30)
            }

            Toggle("Debug logging", isOn: self.$settings.debugLogging)

            Button("Reset to Defaults") {
                self.showingResetConfirmation = true
            }
            .confirmationDialog(
                "Reset all settings to defaults?",
                isPresented: self.$showingResetConfirmation,
                titleVisibility: .visible,
            ) {
                Button("Reset", role: .destructive) {
                    self.settings.resetToDefaults()
                }
            }
        }
        .padding()
    }

    // MARK: Private

    @State private var showingResetConfirmation = false
}
