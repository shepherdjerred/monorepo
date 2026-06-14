import SwiftUI

/// Sidebar listing all monitored services grouped by category with status.
struct ServiceSidebar: View {
    // MARK: Internal

    @Bindable var appState: AppState
    @Binding var searchText: String
    @Binding var searchScope: ServiceSearchScope

    var body: some View {
        if !self.searchText.isEmpty, self.filteredSnapshots.isEmpty {
            ContentUnavailableView.search(text: self.searchText)
        } else {
            List(selection: self.$appState.selectedServiceId) {
                ForEach(ServiceCategory.allCases, id: \.self) { category in
                    let snapshots = self.snapshots(for: category)
                    if !snapshots.isEmpty {
                        Section(category.displayName) {
                            ForEach(snapshots) { snapshot in
                                ServiceRow(snapshot: snapshot)
                                    .tag(snapshot.id)
                                    .contextMenu {
                                        ServiceContextMenu(snapshot: snapshot)
                                    }
                            }
                        }
                    }
                }

                let uncategorized = self.uncategorizedSnapshots
                if !uncategorized.isEmpty {
                    Section("Other") {
                        ForEach(uncategorized) { snapshot in
                            ServiceRow(snapshot: snapshot)
                                .tag(snapshot.id)
                                .contextMenu {
                                    ServiceContextMenu(snapshot: snapshot)
                                }
                        }
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 280)
        }
    }

    // MARK: Private

    private var filteredSnapshots: [ServiceSnapshot] {
        var snapshots = self.appState.snapshots

        switch self.searchScope {
        case .all:
            break
        case .errorsOnly:
            snapshots = snapshots.filter { $0.status == .error || $0.status == .warning }
        case .infrastructure:
            let ids = ServiceCategory.infrastructure.providerIds
            snapshots = snapshots.filter { ids.contains($0.id) }
        case .cicd:
            let ids = ServiceCategory.cicd.providerIds
            snapshots = snapshots.filter { ids.contains($0.id) }
        case .observability:
            let ids = ServiceCategory.observability.providerIds
            snapshots = snapshots.filter { ids.contains($0.id) }
        case .usage:
            let ids = ServiceCategory.usage.providerIds
            snapshots = snapshots.filter { ids.contains($0.id) }
        }

        guard !self.searchText.isEmpty else {
            return snapshots
        }
        return snapshots.filter { snapshot in
            snapshot.displayName.localizedCaseInsensitiveContains(self.searchText)
                || snapshot.summary.localizedCaseInsensitiveContains(self.searchText)
        }
    }

    private var uncategorizedSnapshots: [ServiceSnapshot] {
        let allCategorized = ServiceCategory.allCases.reduce(into: Set<String>()) { result, cat in
            result.formUnion(cat.providerIds)
        }
        return self.filteredSnapshots.filter { !allCategorized.contains($0.id) }
    }

    private func snapshots(for category: ServiceCategory) -> [ServiceSnapshot] {
        self.filteredSnapshots.filter { category.providerIds.contains($0.id) }
    }
}
