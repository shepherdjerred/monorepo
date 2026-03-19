import AppKit
import SwiftUI

/// Popover content shown when clicking the menu bar icon.
struct MenuBarPopover: View {
    // MARK: Internal

    @Bindable var appState: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            self.header
            Divider()
            self.serviceList
            Divider()
            self.footer
        }
        .padding()
        .frame(width: 360)
    }

    // MARK: Private

    @Environment(\.openWindow) private var openWindow

    private var statusSummary: String {
        let counts = Dictionary(
            grouping: appState.snapshots,
            by: \.status,
        ).mapValues(\.count)

        let errorCount = counts[.error, default: 0]
        let warningCount = counts[.warning, default: 0]
        let okCount = counts[.ok, default: 0]

        if errorCount > 0 {
            return "\(errorCount) error\(errorCount == 1 ? "" : "s"), \(warningCount) warning\(warningCount == 1 ? "" : "s")"
        } else if warningCount > 0 {
            return "\(warningCount) warning\(warningCount == 1 ? "" : "s"), \(okCount) healthy"
        } else if okCount > 0 {
            return "All \(okCount) services healthy"
        } else {
            return "No data"
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Image(systemName: self.appState.menuBarIcon)
                .font(.title2)
                .foregroundStyle(self.appState.overallHealth.color)

            VStack(alignment: .leading, spacing: 2) {
                Text("Glance")
                    .font(.headline)
                Text(self.statusSummary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            RefreshButton(isRefreshing: self.appState.isRefreshing) {
                Task { await self.appState.refreshNow() }
            }
        }
    }

    // MARK: - Service List

    private var serviceList: some View {
        VStack(spacing: 2) {
            ForEach(self.appState.snapshots) { snapshot in
                Button {
                    self.openDashboard(selectedService: snapshot.id)
                } label: {
                    ServiceGridItem(snapshot: snapshot)
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            if let lastRefresh = appState.lastRefresh {
                Text("Updated \(lastRefresh, style: .relative) ago")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Spacer()

            Button("Dashboard") {
                self.openDashboard(selectedService: nil)
            }

            Button("Quit") {
                NSApplication.shared.terminate(nil)
            }
        }
    }

    private func openDashboard(selectedService: String?) {
        if let selectedService {
            self.appState.selectedServiceId = selectedService
        }
        NSApplication.shared.setActivationPolicy(.regular)
        self.openWindow(id: "dashboard")
        NSApplication.shared.activate(ignoringOtherApps: true)
    }
}
