import AppKit
import SwiftUI

// MARK: - ServiceSearchScope

/// Search scope for filtering services in the dashboard.
enum ServiceSearchScope: String, CaseIterable {
    case all = "All"
    case errorsOnly = "Errors Only"
    case infrastructure = "Infrastructure"
    case cicd = "CI/CD"
    case observability = "Observability"
    case usage = "Usage"
}

// MARK: - DashboardWindow

/// Full dashboard window with sidebar navigation and service detail.
struct DashboardWindow: View {
    // MARK: Internal

    @Bindable var appState: AppState

    var settings: GlanceSettings

    var selectedSnapshot: ServiceSnapshot? {
        guard let selectedId = appState.selectedServiceId else {
            return nil
        }
        return self.appState.snapshot(for: selectedId)
    }

    var body: some View {
        NavigationSplitView(columnVisibility: self.$columnVisibility) {
            ServiceSidebar(
                appState: self.appState,
                searchText: self.$searchText,
                searchScope: self.$searchScope,
            )
        } detail: {
            self.detail
                .inspector(isPresented: self.$showInspector) {
                    DebugInspector(
                        selectedServiceId: self.appState.selectedServiceId,
                        metricsCollector: self.appState.metricsCollector,
                    )
                    .inspectorColumnWidth(min: 280, ideal: 320, max: 420)
                }
        }
        .searchable(text: self.$searchText, prompt: Text("Search services"))
        .searchScopes(self.$searchScope) {
            ForEach(ServiceSearchScope.allCases, id: \.self) { scope in
                Text(scope.rawValue).tag(scope)
            }
        }
        .navigationTitle("Glance")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                RefreshButton(isRefreshing: self.appState.isRefreshing) {
                    Task { await self.appState.refreshNow() }
                }
            }
        }
        .focusedSceneValue(\.selectedService, self.selectedSnapshot)
        .onReceive(NotificationCenter.default.publisher(for: .glanceRefreshAll)) { _ in
            Task { await self.appState.refreshNow() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .glanceToggleSidebar)) { _ in
            switch self.columnVisibility {
            case .detailOnly:
                self.columnVisibility = .all
            default:
                self.columnVisibility = .detailOnly
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .glanceToggleInspector)) { _ in
            self.showInspector.toggle()
        }
        .onReceive(NotificationCenter.default.publisher(for: .glanceExportDiagnostics)) { _ in
            Task {
                await DiagnosticsExporter.exportDiagnostics(
                    metricsCollector: self.appState.metricsCollector,
                    snapshots: self.appState.snapshots,
                    settings: self.settings,
                )
            }
        }
        .onAppear {
            NSApplication.shared.setActivationPolicy(.regular)
            NSApplication.shared.activate()
            self.updateDockBadge()
            // Restore persisted state across launches.
            if let restoredId = restoredServiceId {
                self.appState.selectedServiceId = restoredId
            }
            if !self.restoredSearchText.isEmpty {
                self.searchText = self.restoredSearchText
            }
        }
        .onChange(of: self.appState.selectedServiceId) { _, newValue in
            self.restoredServiceId = newValue
        }
        .onChange(of: self.searchText) { _, newValue in
            self.restoredSearchText = newValue
        }
        .onDisappear {
            // Revert to accessory mode (removes Dock icon) when dashboard closes.
            NSApplication.shared.setActivationPolicy(.accessory)
            NSApplication.shared.dockTile.badgeLabel = nil
        }
        .onChange(of: self.errorCount) {
            self.updateDockBadge()
        }
    }

    // MARK: Private

    @State private var showInspector = false
    @State private var searchText = ""
    @State private var columnVisibility: NavigationSplitViewVisibility = .automatic
    @State private var searchScope: ServiceSearchScope = .all
    @SceneStorage("dashboard.selectedServiceId") private var restoredServiceId: String?
    @SceneStorage("dashboard.searchText") private var restoredSearchText: String = ""

    /// Count of services in error state, used to drive dock badge updates.
    private var errorCount: Int {
        self.appState.snapshots.count(where: { $0.status == .error })
    }

    @ViewBuilder
    private var detail: some View {
        if let selectedId = appState.selectedServiceId,
           let snapshot = appState.snapshot(for: selectedId)
        {
            ServiceDetailView(snapshot: snapshot, snapshotStore: self.appState.snapshotStore)
        } else {
            ContentUnavailableView(
                String(localized: "Select a Service"),
                systemImage: "sidebar.left",
                description: Text("Choose a service from the sidebar to view details."),
            )
        }
    }

    /// Update the dock tile badge with the current error count.
    private func updateDockBadge() {
        let errorCount = self.appState.snapshots.count(where: { $0.status == .error })
        if errorCount > 0 {
            NSApplication.shared.dockTile.badgeLabel = "\(errorCount)"
        } else {
            NSApplication.shared.dockTile.badgeLabel = nil
        }
    }
}

#if DEBUG
    #Preview("Dashboard") {
        DashboardWindow(
            appState: AppState(previewSnapshots: PreviewData.snapshots),
            settings: PreviewData.makeSettings(),
        )
        .frame(width: 900, height: 600)
    }
#endif
