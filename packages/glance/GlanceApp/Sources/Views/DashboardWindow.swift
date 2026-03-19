import SwiftUI

/// Full dashboard window with sidebar navigation and service detail.
struct DashboardWindow: View {
    // MARK: Internal

    @Bindable var appState: AppState

    var body: some View {
        NavigationSplitView {
            ServiceSidebar(appState: self.appState, searchText: self.$searchText)
        } detail: {
            self.detail
        }
        .searchable(text: self.$searchText, prompt: "Search services")
        .navigationTitle("Glance")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                RefreshButton(isRefreshing: self.appState.isRefreshing) {
                    Task { await self.appState.refreshNow() }
                }
            }
        }
    }

    // MARK: Private

    @State private var searchText = ""

    @ViewBuilder
    private var detail: some View {
        if let selectedId = appState.selectedServiceId,
           let snapshot = appState.snapshot(for: selectedId)
        {
            ServiceDetailView(snapshot: snapshot)
        } else {
            ContentUnavailableView(
                "Select a Service",
                systemImage: "sidebar.left",
                description: Text("Choose a service from the sidebar to view details."),
            )
        }
    }
}
