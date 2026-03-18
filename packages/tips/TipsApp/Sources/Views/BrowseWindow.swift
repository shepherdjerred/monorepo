import SwiftUI

/// Full browsing window with sidebar and detail view.
struct BrowseWindow: View {
    @Bindable var appState: AppState
    @State private var searchText = ""

    var body: some View {
        NavigationSplitView {
            sidebar
        } detail: {
            detail
        }
        .searchable(text: $searchText, prompt: "Search tips")
        .navigationTitle("Tips")
    }

    // MARK: - Sidebar

    private var sidebar: some View {
        List(filteredApps, selection: $appState.selectedAppId) { app in
            Label {
                Text(app.name)
            } icon: {
                Image(systemName: app.icon)
                    .foregroundStyle(app.color)
            }
            .tag(app.id)
        }
        .navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 260)
    }

    // MARK: - Detail

    @ViewBuilder
    private var detail: some View {
        if let selectedId = appState.selectedAppId,
           let app = appState.apps.first(where: { $0.id == selectedId })
        {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    detailHeader(app)
                    ForEach(filteredSections(for: app)) { section in
                        TipSectionView(section: section)
                    }
                }
                .padding()
            }
        } else {
            ContentUnavailableView(
                "Select an App",
                systemImage: "sidebar.left",
                description: Text("Choose an app from the sidebar to view its tips.")
            )
        }
    }

    @ViewBuilder
    private func detailHeader(_ app: TipApp) -> some View {
        HStack(spacing: 12) {
            Image(systemName: app.icon)
                .font(.largeTitle)
                .foregroundStyle(app.color)
            VStack(alignment: .leading, spacing: 2) {
                Text(app.name)
                    .font(.title.bold())
                if let website = app.website {
                    Text(website)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.bottom, 4)
    }

    // MARK: - Filtering

    private var filteredApps: [TipApp] {
        guard !searchText.isEmpty else { return appState.apps }
        return appState.apps.filter { app in
            app.name.localizedCaseInsensitiveContains(searchText)
                || app.sections.contains { section in
                    section.items.contains { item in
                        item.text.localizedCaseInsensitiveContains(searchText)
                            || (item.shortcut?.localizedCaseInsensitiveContains(searchText) ?? false)
                    }
                }
        }
    }

    private func filteredSections(for app: TipApp) -> [TipSection] {
        guard !searchText.isEmpty else { return app.sections }
        return app.sections.compactMap { section in
            let matchingItems = section.items.filter { item in
                item.text.localizedCaseInsensitiveContains(searchText)
                    || (item.shortcut?.localizedCaseInsensitiveContains(searchText) ?? false)
            }
            guard !matchingItems.isEmpty else { return nil }
            return TipSection(id: section.id, heading: section.heading, items: matchingItems)
        }
    }
}
