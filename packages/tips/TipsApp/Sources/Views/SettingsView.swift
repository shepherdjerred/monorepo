import ServiceManagement
import SwiftUI

/// App settings accessible via Cmd+, (macOS HIG-compliant).
struct SettingsView: View {
    // MARK: Internal

    var body: some View {
        Form {
            Toggle("Launch at login", isOn: self.$launchAtLogin)
                .onChange(of: self.launchAtLogin) { _, newValue in
                    self.updateLoginItem(enabled: newValue)
                }
        }
        .formStyle(.grouped)
        .frame(width: 300)
        .navigationTitle("Settings")
    }

    // MARK: Private

    @AppStorage("launchAtLogin") private var launchAtLogin = false

    private func updateLoginItem(enabled: Bool) {
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            print("Failed to update login item: \(error)")
        }
    }
}
