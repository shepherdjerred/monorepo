#if os(macOS)
    import Foundation
    import SwiftUI
    import TaskNotesKit

    internal struct FacetNativeSidebar: View {
        let store: FacetStore
        let onPresentModal: (FacetPresentedEntityModal) -> Void

        var body: some View {
            List {
                Button {
                    store.showsCapture = true
                } label: {
                    Label("Add Task", systemImage: "plus.circle.fill")
                        .foregroundStyle(FacetNativeStyle.brand)
                        .fontWeight(.semibold)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.newTask)
                Button {
                    store.searchFocusedRequest &+= 1
                } label: {
                    Label("Search", systemImage: "magnifyingglass")
                }
                .buttonStyle(.plain)
                SwiftUI.Section {
                    sidebarSectionRow(.inbox, badge: store.inboxCount)
                    sidebarSectionRow(.today, badge: store.todayCount)
                    sidebarSectionRow(.upcoming, badge: 0)
                }

                if !store.favoriteProjects.isEmpty || !store.favoriteFilters.isEmpty
                    || !store.favoriteLabels.isEmpty
                {
                    SwiftUI.Section("Favorites") {
                        ForEach(store.favoriteProjects) { proj in
                            projectRow(proj)
                        }
                        ForEach(store.favoriteLabels) { item in
                            labelRow(item)
                        }
                        ForEach(store.favoriteFilters) { filterItem in
                            filterRow(filterItem)
                        }
                    }
                }

                SwiftUI.Section {
                    ForEach(store.userProjects) { proj in
                        projectRow(proj)
                            .padding(.leading, CGFloat(store.projectPath(proj).count - 1) * 12)
                    }
                    FacetArchivedProjects(store: store)
                } header: {
                    sectionHeader("Projects") {
                        onPresentModal(.addProject)
                    }
                }

                SwiftUI.Section {
                    ForEach(store.activeLabels) { item in
                        labelRow(item)
                    }
                } header: {
                    sectionHeader("Labels") {
                        onPresentModal(.addLabel)
                    }
                }

                SwiftUI.Section {
                    ForEach(store.activeFilters) { filterItem in
                        filterRow(filterItem)
                    }
                } header: {
                    sectionHeader("Filters") {
                        onPresentModal(.addFilter)
                    }
                }

                SwiftUI.Section("Browse") {
                    sidebarSectionRow(.completed, badge: 0)
                    sidebarDestinationButton(.board) { _ in
                        Label("Priority Board", systemImage: "rectangle.split.3x1")
                    }
                    .accessibilityIdentifier(AccessibilityIdentifier.sidebarDestination(.board))
                }
            }
            .listStyle(.sidebar)
            .onKeyPress(keys: ["q"]) { press in
                guard press.modifiers.isEmpty else { return .ignored }
                store.showsCapture = true
                return .handled
            }
            .safeAreaInset(edge: .bottom) {
                sidebarSyncFooter
            }
            .accessibilityIdentifier(AccessibilityIdentifier.sidebar)
        }

        private func sidebarDestinationButton<Content: View>(
            _ destination: FacetDestination,
            @ViewBuilder content: (Bool) -> Content
        ) -> some View {
            let isSelected = store.destination == destination
            return Button {
                store.destination = destination
            } label: {
                content(isSelected)
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        isSelected ? FacetNativeStyle.brand.opacity(0.16) : Color.clear,
                        in: .rect(cornerRadius: 7)
                    )
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .listRowInsets(EdgeInsets(top: 1, leading: 4, bottom: 1, trailing: 4))
        }

        private func sidebarSectionRow(_ section: FacetSection, badge: Int) -> some View {
            sidebarDestinationButton(.section(section)) { isSelected in
                HStack(spacing: 8) {
                    Image(systemName: section.systemImage)
                        .foregroundStyle(
                            isSelected
                                ? FacetNativeStyle.brand : Color(nsColor: .secondaryLabelColor))
                    Text(section.title)
                        .fontWeight(isSelected ? .semibold : .regular)
                    Spacer()
                    if badge > 0 {
                        Text("\(badge)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(isSelected ? FacetNativeStyle.brand : .secondary)
                    }
                }
            }
            .accessibilityIdentifier(AccessibilityIdentifier.sidebarSection(section))
        }

        private func projectRow(_ proj: Project) -> some View {
            let count = store.openTaskCount(inProject: proj.id)
            return sidebarDestinationButton(.project(id: proj.id)) { isSelected in
                HStack(spacing: 8) {
                    Circle()
                        .fill(FacetNativeStyle.swatchColor(proj.color))
                        .frame(width: 8, height: 8)
                    Text(proj.name)
                        .fontWeight(isSelected ? .semibold : .regular)
                        .lineLimit(1)
                    Spacer()
                    if count > 0 {
                        Text("\(count)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(isSelected ? FacetNativeStyle.brand : .secondary)
                    }
                }
            }
            .contextMenu {
                Button("Edit Project…") {
                    onPresentModal(.editProject(proj))
                }
                Button(proj.is_favorite ? "Remove from Favorites" : "Add to Favorites") {
                    store.toggleProjectFavorite(proj)
                }
                Divider()
                Button("Delete Project", role: .destructive) {
                    store.deleteProject(id: proj.id)
                }
            }
            .accessibilityIdentifier(
                AccessibilityIdentifier.sidebarDestination(.project(id: proj.id))
            )
        }

        private func labelRow(_ item: TaskNotesKit.Label) -> some View {
            sidebarDestinationButton(.label(id: item.id)) { isSelected in
                HStack(spacing: 8) {
                    Image(systemName: "tag.fill")
                        .font(.caption)
                        .foregroundStyle(FacetNativeStyle.swatchColor(item.color))
                    Text("@\(item.name)")
                        .fontWeight(isSelected ? .semibold : .regular)
                        .lineLimit(1)
                    Spacer()
                }
            }
            .contextMenu {
                Button("Edit Label…") { onPresentModal(.editLabel(item)) }
                Button("Delete Label", role: .destructive) {
                    store.deleteLabel(id: item.id)
                }
            }
            .accessibilityIdentifier(
                AccessibilityIdentifier.sidebarDestination(.label(id: item.id))
            )
        }

        private func filterRow(_ filterItem: Filter) -> some View {
            sidebarDestinationButton(.filter(id: filterItem.id)) { isSelected in
                HStack(spacing: 8) {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                        .font(.caption)
                        .foregroundStyle(FacetNativeStyle.swatchColor(filterItem.color))
                    Text(filterItem.name)
                        .fontWeight(isSelected ? .semibold : .regular)
                        .lineLimit(1)
                    Spacer()
                }
            }
            .contextMenu {
                Button("Edit Filter…") { onPresentModal(.editFilter(filterItem)) }
                Button("Delete Filter", role: .destructive) {
                    store.deleteFilter(id: filterItem.id)
                }
            }
            .accessibilityIdentifier(
                AccessibilityIdentifier.sidebarDestination(.filter(id: filterItem.id))
            )
        }

        private func sectionHeader(_ title: String, onAdd: @escaping () -> Void) -> some View {
            HStack {
                Text(title)
                Spacer()
                Button(action: onAdd) {
                    Image(systemName: "plus")
                }
                .buttonStyle(.borderless)
                .help("Add to \(title)")
            }
        }
    }

    extension FacetNativeSidebar {
        fileprivate var sidebarSyncFooter: some View {
            HStack(spacing: 8) {
                Circle()
                    .fill(
                        store.hasConfiguredToken
                            ? (store.effectiveError == nil ? Color.green : Color.red)
                            : Color.orange
                    )
                    .frame(width: 7, height: 7)

                Text(
                    store.isSyncing
                        ? "Syncing…"
                        : (store.pendingOutboxCount > 0
                            ? "\(store.pendingOutboxCount) pending"
                            : (store.effectiveError != nil
                                ? "Sync needs attention"
                                : (store.hasConfiguredToken ? "Synced" : "On this Mac")))
                )
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)

                Spacer()

                Button {
                    store.showsSettings = true
                } label: {
                    Image(systemName: "gearshape")
                }
                .buttonStyle(.borderless)
                .help("Server & Sync Settings")
                .accessibilityLabel("Settings")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.bar)
        }
    }
#endif
