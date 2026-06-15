import os
import ServiceManagement
import SwiftUI
import UserNotifications

/// App settings accessible via Cmd+, (macOS HIG-compliant).
struct SettingsView: View {
    // MARK: Internal

    var appState: AppState

    var body: some View {
        TabView {
            self.generalTab
                .tabItem { Label("General", systemImage: "gear") }

            self.notificationsTab
                .tabItem { Label("Notifications", systemImage: "bell") }

            self.dataTab
                .tabItem { Label("Data", systemImage: "chart.bar") }

            self.acknowledgmentsTab
                .tabItem { Label("Acknowledgments", systemImage: "heart") }

            #if DEBUG
                DebugView(appState: self.appState)
                    .tabItem { Label("Debug", systemImage: "ant") }
            #endif
        }
        .frame(width: 400)
    }

    // MARK: Private

    @AppStorage("launchAtLogin") private var launchAtLogin = false
    @AppStorage("notificationsEnabled") private var notificationsEnabled = false
    @AppStorage("notificationHour") private var notificationHour = 9
    @AppStorage("notificationMinute") private var notificationMinute = 0

    @State private var notificationAuthStatus: UNAuthorizationStatus = .notDetermined
    @State private var showResetConfirmation = false

    // MARK: - General Tab

    private var generalTab: some View {
        Form {
            Toggle("Launch at login", isOn: self.$launchAtLogin)
                .onChange(of: self.launchAtLogin) { _, newValue in
                    self.updateLoginItem(enabled: newValue)
                }
        }
        .formStyle(.grouped)
        .navigationTitle("General")
    }

    // MARK: - Notifications Tab

    private var notificationsTab: some View {
        Form {
            self.notificationControls
        }
        .formStyle(.grouped)
        .navigationTitle("Notifications")
        .onAppear { self.checkNotificationAuthStatus() }
    }

    private var notificationControls: some View {
        Group {
            self.notificationToggle

            if self.notificationsEnabled {
                self.notificationTimePicker
            }

            if self.notificationAuthStatus == .denied {
                Text("Notifications are disabled in System Settings.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var notificationToggle: some View {
        Toggle("Enable daily notification", isOn: self.$notificationsEnabled)
            .onChange(of: self.notificationsEnabled) { _, newValue in
                if newValue {
                    Task {
                        let granted = await NotificationManager.requestPermission()
                        if !granted {
                            self.notificationsEnabled = false
                        }
                        self.checkNotificationAuthStatus()
                    }
                }
                self.rescheduleNotification()
            }
    }

    private var notificationTimePicker: some View {
        DatePicker(
            "Notification time",
            selection: Binding(
                get: {
                    Calendar.current.date(
                        from: DateComponents(
                            hour: self.notificationHour,
                            minute: self.notificationMinute
                        )
                    ) ?? .now
                },
                set: { date in
                    let components = Calendar.current.dateComponents([.hour, .minute], from: date)
                    self.notificationHour = components.hour ?? 9
                    self.notificationMinute = components.minute ?? 0
                    self.rescheduleNotification()
                }
            ),
            displayedComponents: .hourAndMinute
        )
    }

    // MARK: - Data Tab

    private var dataTab: some View {
        Form {
            Section("Statistics") {
                LabeledContent("Tips loaded", value: "\(self.appState.allTips.count)")
                LabeledContent("Apps", value: "\(self.appState.apps.count)")
                LabeledContent("Learned", value: "\(self.appState.reviewManager.learnedCount)")
                LabeledContent("Favorites", value: "\(self.appState.reviewManager.favoriteIds.count)")
            }

            Section {
                Button("Reset Learned Tips", role: .destructive) {
                    self.showResetConfirmation = true
                }
                .alert("Reset Learned Tips?", isPresented: self.$showResetConfirmation) {
                    Button("Cancel", role: .cancel) {}
                    Button("Reset", role: .destructive) {
                        self.appState.reviewManager.resetLearnedTips()
                    }
                } message: {
                    Text("All tips will be returned to the rotation pool.")
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Data")
    }

    // MARK: - Acknowledgments Tab

    private var acknowledgmentsTab: some View {
        Form {
            Section("Open Source Libraries") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Yams")
                        .font(.headline)
                    Text("YAML parsing library")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("MIT License")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("swift-markdown")
                        .font(.headline)
                    Text("Markdown parsing library")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("Apache License 2.0")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Acknowledgments")
    }

    // MARK: - Helpers

    private func updateLoginItem(enabled: Bool) {
        let action = enabled ? "register" : "unregister"
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            let tipsError = TipsError.loginItemFailed(action: action, underlying: error)
            Logger.lifecycle.error("\(tipsError.description)")
        }
    }

    private func checkNotificationAuthStatus() {
        Task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            self.notificationAuthStatus = settings.authorizationStatus
        }
    }

    private func rescheduleNotification() {
        guard self.notificationsEnabled, let tip = self.appState.currentTip else {
            return
        }
        NotificationManager.scheduleDailyNotification(
            tip: tip, hour: self.notificationHour, minute: self.notificationMinute
        )
    }
}
