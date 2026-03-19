import SwiftUI

/// Sidebar listing all monitored services with their current status.
struct ServiceSidebar: View {
    // MARK: Internal

    @Bindable var appState: AppState
    @Binding var searchText: String

    var body: some View {
        List(self.filteredSnapshots, selection: self.$appState.selectedServiceId) { snapshot in
            ServiceRow(snapshot: snapshot)
                .tag(snapshot.id)
        }
        .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 280)
    }

    // MARK: Private

    private var filteredSnapshots: [ServiceSnapshot] {
        guard !self.searchText.isEmpty else {
            return self.appState.snapshots
        }
        return self.appState.snapshots.filter { snapshot in
            snapshot.displayName.localizedCaseInsensitiveContains(self.searchText)
                || snapshot.summary.localizedCaseInsensitiveContains(self.searchText)
        }
    }
}
