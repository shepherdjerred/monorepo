import AppKit
import SwiftUI

// MARK: - MenuBarPopover

/// Popover content shown when clicking the menu bar icon.
struct MenuBarPopover: View {
    // MARK: Internal

    @Bindable var appState: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            self.header
            Divider()
            self.banners
            self.serviceList
            Divider()
            self.footer
        }
        .padding()
        .frame(width: 360)
    }

    // MARK: Private

    @Environment(\.openWindow) private var openWindow

    /// Duration after which data is considered stale (5 minutes).
    private let staleThreshold: TimeInterval = 300

    /// Status counts for the summary header.
    private var statusCounts: [ServiceStatus: Int] {
        Dictionary(
            grouping: self.appState.snapshots,
            by: \.status,
        ).mapValues(\.count)
    }

    /// Whether most providers have errors, indicating a network-level issue.
    private var isNetworkDown: Bool {
        let total = self.appState.snapshots.count
        guard total > 0 else {
            return false
        }
        let errorCount = self.appState.snapshots.count(where: {
            $0.status == .unknown && $0.error != nil
        })
        // If more than 75% of providers report errors, likely a network issue.
        return Double(errorCount) / Double(total) > 0.75
    }

    /// Whether multiple providers show "Secret not loaded" errors, indicating
    /// 1Password CLI is unavailable.
    private var isSecretsUnavailable: Bool {
        let secretErrors = self.appState.snapshots.count(where: { snapshot in
            guard let error = snapshot.error?.lowercased() else {
                return false
            }
            return error.contains("secret not loaded") || error.contains("not loaded")
        })
        return secretErrors >= 3
    }

    /// Whether the data is stale (last refresh more than 5 minutes ago).
    private var isDataStale: Bool {
        guard let lastRefresh = appState.lastRefresh else {
            return false
        }
        return Date.now.timeIntervalSince(lastRefresh) > self.staleThreshold
    }

    /// Whether this is the initial loading state (no data yet).
    private var isInitialLoading: Bool {
        self.appState.snapshots.isEmpty && self.appState.isRefreshing
    }

    /// Human-readable status summary for accessibility.
    private var statusSummaryText: String {
        let counts = self.statusCounts
        let okCount = counts[.ok, default: 0]
        let warningCount = counts[.warning, default: 0]
        let errorCount = counts[.error, default: 0]

        if errorCount > 0 {
            let errorSuffix = errorCount == 1 ? "" : "s"
            let warnSuffix = warningCount == 1 ? "" : "s"
            return "\(errorCount) error\(errorSuffix), \(warningCount) warning\(warnSuffix)"
        } else if warningCount > 0 {
            return "\(warningCount) warning\(warningCount == 1 ? "" : "s"), \(okCount) healthy"
        } else if okCount > 0 {
            return "All \(okCount) services healthy"
        } else {
            return "No data"
        }
    }

    /// Snapshots grouped by category, in category display order.
    private var groupedSnapshots: [(category: ServiceCategory, snapshots: [ServiceSnapshot])] {
        ServiceCategory.allCases.compactMap { category in
            let matching = self.appState.snapshots.filter { snapshot in
                category.providerIds.contains(snapshot.id)
            }
            if matching.isEmpty {
                return nil
            }
            return (category: category, snapshots: matching)
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Image(systemName: self.appState.menuBarIcon)
                .font(.title2)
                .foregroundStyle(self.appState.overallHealth.color)

            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: "Glance")
                    .font(.headline)
                self.statusSummaryView
            }

            Spacer()

            RefreshButton(isRefreshing: self.appState.isRefreshing) {
                Task { await self.appState.refreshNow() }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(String(localized: "Glance status"))
        .accessibilityValue(self.statusSummaryText)
    }

    /// Colored status summary with counts.
    private var statusSummaryView: some View {
        HStack(spacing: 4) {
            let counts = self.statusCounts
            let okCount = counts[.ok, default: 0]
            let warningCount = counts[.warning, default: 0]
            let errorCount = counts[.error, default: 0]

            if self.appState.snapshots.isEmpty {
                Text(String(localized: "No data"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                if okCount > 0 {
                    HStack(spacing: 2) {
                        Text("\(okCount)")
                            .foregroundStyle(.green)
                        Text("OK")
                            .foregroundStyle(.secondary)
                    }
                }
                if warningCount > 0 {
                    HStack(spacing: 2) {
                        Text("\(warningCount)")
                            .foregroundStyle(.yellow)
                        Text(warningCount == 1 ? "Warning" : "Warnings")
                            .foregroundStyle(.secondary)
                    }
                }
                if errorCount > 0 {
                    HStack(spacing: 2) {
                        Text("\(errorCount)")
                            .foregroundStyle(.red)
                        Text(errorCount == 1 ? "Error" : "Errors")
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .font(.caption)
    }

    // MARK: - Banners

    @ViewBuilder
    private var banners: some View {
        if self.isNetworkDown {
            self.bannerView(
                icon: "wifi.slash",
                text: String(localized: "Cannot reach services"),
                color: .red,
            )
        }

        if self.isSecretsUnavailable {
            self.bannerView(
                icon: "key.slash",
                text: String(localized: "1Password secrets unavailable — check op CLI"),
                color: .orange,
            )
        }

        if self.isDataStale {
            self.bannerView(
                icon: "clock.badge.exclamationmark",
                text: String(localized: "Data may be stale"),
                color: .orange,
            )
        }
    }

    // MARK: - Service List

    @ViewBuilder
    private var serviceList: some View {
        if self.isInitialLoading {
            VStack(spacing: 12) {
                ProgressView()
                Text(String(localized: "Loading services..."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
        } else {
            VStack(spacing: 6) {
                ForEach(self.groupedSnapshots, id: \.category) { group in
                    self.categorySection(group.category, snapshots: group.snapshots)
                }
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

            Button(String(localized: "Dashboard")) {
                self.openDashboard(selectedService: nil)
            }
            .accessibilityHint(String(localized: "Opens the full dashboard window"))

            Button(String(localized: "Quit")) {
                NSApplication.shared.terminate(nil)
            }
        }
    }

    private func bannerView(
        icon: String,
        text: String,
        color: Color,
    ) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .accessibilityHidden(true)
                .foregroundStyle(color)
            Text(text)
                .font(.caption)
                .foregroundStyle(color)
            Spacer()
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
    }

    private func categorySection(
        _ category: ServiceCategory,
        snapshots: [ServiceSnapshot],
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(category.displayName)
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .textCase(.uppercase)
                .padding(.horizontal, 8)
                .padding(.top, 4)

            ForEach(snapshots) { snapshot in
                Button {
                    self.openDashboard(selectedService: snapshot.id)
                } label: {
                    ServiceGridItem(snapshot: snapshot)
                }
                .buttonStyle(.plain)
                .contextMenu {
                    ServiceContextMenu(snapshot: snapshot)
                }
            }
        }
    }

    private func openDashboard(selectedService: String?) {
        if let selectedService {
            self.appState.selectedServiceId = selectedService
        }
        NSApplication.shared.setActivationPolicy(.regular)
        self.openWindow(id: "dashboard")
        NSApplication.shared.activate()
    }
}

#if DEBUG
    #Preview("Popover — Mixed Status") {
        MenuBarPopover(appState: AppState(previewSnapshots: PreviewData.snapshots))
    }

    #Preview("Popover — All OK") {
        let okSnapshots = PreviewData.snapshots.map { snapshot in
            ServiceSnapshot(
                id: snapshot.id,
                displayName: snapshot.displayName,
                iconName: snapshot.iconName,
                status: .ok,
                summary: snapshot.summary,
                detail: .empty,
                error: nil,
                timestamp: .now,
                webURL: nil,
            )
        }
        MenuBarPopover(appState: AppState(previewSnapshots: okSnapshots))
    }

    #Preview("Popover — Empty") {
        MenuBarPopover(appState: AppState(previewSnapshots: []))
    }
#endif
