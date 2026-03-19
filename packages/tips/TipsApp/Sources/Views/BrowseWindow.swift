import SwiftUI

/// Full browsing window with sidebar and detail view.
struct BrowseWindow: View {
    // MARK: Internal

    @Bindable var appState: AppState

    var body: some View {
        NavigationSplitView {
            self.sidebar
        } detail: {
            self.detail
        }
        .searchable(text: self.$searchText, prompt: "Search tips")
        .navigationTitle("Tips")
    }

    // MARK: Private

    @State private var searchText = ""

    private let favoritesId = "___favorites___"

    // MARK: - Filtering

    private var filteredApps: [TipApp] {
        guard !self.searchText.isEmpty else {
            return self.appState.apps
        }
        return self.appState.apps.filter { app in
            app.name.localizedCaseInsensitiveContains(self.searchText)
                || app.sections.contains { section in
                    section.items.contains { item in
                        item.text.localizedCaseInsensitiveContains(self.searchText)
                            || (item.shortcut?.localizedCaseInsensitiveContains(self.searchText) ?? false)
                    }
                }
        }
    }

    private var selectedApp: TipApp? {
        guard let selectedId = appState.selectedAppId else {
            return nil
        }
        return self.appState.apps.first(where: { $0.id == selectedId })
    }

    // MARK: - Sidebar

    private var sidebar: some View {
        List(selection: self.$appState.selectedAppId) {
            if !self.appState.favoriteTips.isEmpty, self.searchText.isEmpty {
                Section {
                    Label {
                        Text("Favorites")
                    } icon: {
                        Image(systemName: "star.fill")
                            .foregroundStyle(.yellow)
                    }
                    .badge(self.appState.favoriteTips.count)
                    .tag(self.favoritesId)
                }
            }

            Section {
                ForEach(self.filteredApps) { app in
                    Label {
                        Text(app.name)
                    } icon: {
                        Image(systemName: app.icon)
                            .foregroundStyle(app.color)
                    }
                    .badge(app.sections.flatMap(\.items).count)
                    .tag(app.id)
                }
            }
        }
        .navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 260)
    }

    // MARK: - Detail

    @ViewBuilder
    private var detail: some View {
        if self.appState.selectedAppId == self.favoritesId {
            self.favoritesDetail
        } else if let app = selectedApp {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    self.detailHeader(app)
                    ForEach(self.filteredSections(for: app)) { section in
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
    private var favoritesDetail: some View {
        let grouped = Dictionary(grouping: appState.favoriteTips, by: \.appName)
        let sortedKeys = grouped.keys.sorted()

        if sortedKeys.isEmpty {
            ContentUnavailableView(
                "No Favorites",
                systemImage: "star",
                description: Text("Star tips to save them here.")
            )
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(spacing: 12) {
                        Image(systemName: "star.fill")
                            .font(.largeTitle)
                            .foregroundStyle(.yellow)
                        Text("Favorites")
                            .font(.title.bold())
                    }
                    .padding(.bottom, 4)

                    ForEach(sortedKeys, id: \.self) { appName in
                        let tips = grouped[appName] ?? []
                        let items = tips.map { TipItem(id: $0.id, text: $0.text, shortcut: $0.shortcut) }
                        TipSectionView(section: TipSection(id: appName, heading: appName, items: items))
                    }
                }
                .padding()
            }
        }
    }

    private func detailHeader(_ app: TipApp) -> some View {
        HStack(spacing: 12) {
            Image(systemName: app.icon)
                .font(.largeTitle)
                .foregroundStyle(app.color)
            VStack(alignment: .leading, spacing: 2) {
                Text(app.name)
                    .font(.title.bold())
                if let website = app.website, let url = URL(string: website) {
                    Link(website, destination: url)
                        .font(.caption)
                }
            }
        }
        .padding(.bottom, 4)
    }

    private func filteredSections(for app: TipApp) -> [TipSection] {
        guard !self.searchText.isEmpty else {
            return app.sections
        }
        return app.sections.compactMap { section in
            let matchingItems = section.items.filter { item in
                item.text.localizedCaseInsensitiveContains(self.searchText)
                    || (item.shortcut?.localizedCaseInsensitiveContains(self.searchText) ?? false)
            }
            guard !matchingItems.isEmpty else {
                return nil
            }
            return TipSection(id: section.id, heading: section.heading, items: matchingItems)
        }
    }
}
