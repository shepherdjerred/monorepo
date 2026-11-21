#if os(iOS)
    import Foundation
    import SwiftUI
    import TaskNotesKit

    internal enum FacetMobileTab: Hashable {
        case today
        case inbox
        case upcoming
        case browse
    }

    internal struct FacetMobileWorkspace: View {
        @Bindable var store: FacetStore
        let onPresentModal: (FacetPresentedEntityModal) -> Void

        @State private var captureRegions = FacetCaptureDropRegions()
        @GestureState private var dragOffset = CGSize.zero
        @State private var selectedTab: FacetMobileTab = .today
        @State private var browsePath: [FacetDestination] = []
        @State private var searching = false
        @State private var searchState = FacetWorkspaceSearchState()
        @State private var searchOriginTab = FacetMobileTab.today
        @State private var searchOriginPath: [FacetDestination] = []

        var body: some View {
            ZStack(alignment: .bottomTrailing) {
                TabView(selection: $selectedTab) {
                    mobileTaskStack(for: .section(.inbox))
                        .tabItem {
                            Label("Inbox", systemImage: "tray.fill")
                        }
                        .tag(FacetMobileTab.inbox)

                    mobileTaskStack(for: .section(.today))
                        .tabItem {
                            Label("Today", systemImage: "calendar.badge.clock")
                        }
                        .tag(FacetMobileTab.today)

                    mobileTaskStack(for: .section(.upcoming))
                        .tabItem {
                            Label("Upcoming", systemImage: "calendar")
                        }
                        .tag(FacetMobileTab.upcoming)

                    mobileBrowseTab
                        .tabItem {
                            Label("Browse", systemImage: "square.grid.2x2")
                        }
                        .tag(FacetMobileTab.browse)
                }

                Button {
                    store.captureDestination =
                        selectedTab == .browse && browsePath.isEmpty
                        ? .section(.inbox) : store.destination
                    store.captureSectionId = nil
                    store.showsCapture = true
                } label: {
                    Image(systemName: "plus")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(
                            width: FacetNativeStyle.mobileCaptureDiameter,
                            height: FacetNativeStyle.mobileCaptureDiameter
                        )
                        .background(FacetNativeStyle.actionFill, in: .circle)
                        .shadow(color: .black.opacity(0.14), radius: 5, y: 2)
                }
                .offset(dragOffset)
                .highPriorityGesture(captureDrag)
                .padding(.trailing, FacetNativeStyle.mobileCapturePadding)
                .padding(.bottom, 68)
                .accessibilityLabel("Quick Add Task")
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.newTask)
            }
            .environment(\.facetCaptureRegions, captureRegions)
            .tint(FacetNativeStyle.brand)
            .onChange(of: selectedTab) {
                switch selectedTab {
                case .today:
                    store.destination = .section(.today)
                case .inbox:
                    store.destination = .section(.inbox)
                case .upcoming:
                    store.destination = .section(.upcoming)
                case .browse:
                    if let target = browsePath.last { store.destination = target }
                }
            }
            .onChange(of: store.searchFocusedRequest) { showSearch() }
            .onChange(of: store.destination) { previous, current in
                guard store.resolvedDestination(previous) != current else { return }
                if !searchState.isShowingCollection(in: store) {
                    searchState.openedCollection = nil
                }
                switch store.destination {
                case .section(.today):
                    selectedTab = .today
                case .section(.inbox):
                    selectedTab = .inbox
                case .section(.upcoming):
                    selectedTab = .upcoming
                case .section(.completed), .board, .project, .label, .filter:
                    if browsePath.last.map(store.resolvedDestination) != store.destination {
                        browsePath = [store.destination]
                    }
                    selectedTab = .browse
                }
            }
            .sheet(isPresented: $searching) {
                FacetWorkspaceSearch(store: store, session: searchState) { destination in
                    searchOriginTab = selectedTab
                    searchOriginPath = browsePath
                    searching = false
                    store.destination = destination
                    if ![.section(.today), .section(.upcoming), .section(.inbox)].contains(
                        destination)
                    {
                        browsePath = [destination]
                        selectedTab = .browse
                    }
                }
            }
            .sheet(item: $store.bulkScheduleRequest) { request in
                FacetBulkScheduleSheet(store: store, request: request)
            }
            .sheet(isPresented: $store.showsInspector) {
                if let id = store.selectedTaskId, let latest = store.task(for: id) {
                    NavigationStack {
                        FacetTaskInspectorView(
                            task: latest,
                            store: store,
                            onClose: { store.showsInspector = false }
                        )
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Done", systemImage: "xmark") {
                                    store.showsInspector = false
                                }
                            }
                        }
                    }
                }
            }
        }

        private var captureDrag: some Gesture {
            DragGesture(minimumDistance: 12, coordinateSpace: .global)
                .updating($dragOffset) { drag, offset, _ in offset = drag.translation }
                .onChanged { drag in
                    captureRegions.highlighted = captureRegions.target(at: drag.location)
                }
                .onEnded { drag in
                    captureRegions.highlighted = nil
                    guard let target = captureRegions.target(at: drag.location) else { return }
                    store.captureDestination = store.destination
                    store.captureSectionId = nil
                    switch target {
                    case .day(let civil): store.upcomingSelectedDate = civil
                    case .section(let id): store.captureSectionId = id
                    }
                    store.showsCapture = true
                }
        }

        private func mobileTaskStack(for target: FacetDestination) -> some View {
            NavigationStack {
                FacetTaskListView(
                    store: store,
                    onSelectTask: { task in
                        store.selectedTaskId = task.id
                        store.showsInspector = true
                    },
                    onPresentModal: onPresentModal
                )
                .toolbar { searchButton }
                .refreshable {
                    await store.syncNow()
                }
                .onAppear {
                    store.destination = target
                }
            }
        }

        fileprivate var searchButton: some ToolbarContent {
            ToolbarItem(placement: .topBarTrailing) {
                if searchState.isShowingCollection(in: store) {
                    Button("Back to Search", systemImage: "arrow.uturn.backward") { showSearch() }
                } else {
                    Button("Search", systemImage: "magnifyingglass") { showSearch() }
                }
            }
        }

        private func showSearch() {
            if searchState.isShowingCollection(in: store), let origin = searchState.origin {
                searchState.openedCollection = nil
                browsePath = searchOriginPath
                selectedTab = searchOriginTab
                if selectedTab != .browse || !browsePath.isEmpty { store.destination = origin }
            }
            searching = true
        }
    }

    extension FacetMobileWorkspace {
        fileprivate var mobileBrowseTab: some View {
            NavigationStack(path: $browsePath) {
                List {
                    SwiftUI.Section {
                        Button("Search", systemImage: "magnifyingglass", action: showSearch)
                    }
                    if !store.favoriteProjects.isEmpty || !store.favoriteLabels.isEmpty
                        || !store.favoriteFilters.isEmpty
                    {
                        SwiftUI.Section("Favorites") {
                            ForEach(store.favoriteProjects) { project in
                                NavigationLink(value: FacetDestination.project(id: project.id)) {
                                    Label(project.name, systemImage: "number")
                                }
                            }
                            ForEach(store.favoriteLabels) { label in
                                NavigationLink(value: FacetDestination.label(id: label.id)) {
                                    Label(label.name, systemImage: "tag")
                                }
                            }
                            ForEach(store.favoriteFilters) { filter in
                                NavigationLink(value: FacetDestination.filter(id: filter.id)) {
                                    Label(
                                        filter.name,
                                        systemImage: "line.3.horizontal.decrease.circle")
                                }
                            }
                        }
                    }

                    SwiftUI.Section {
                        ForEach(store.userProjects) { proj in
                            NavigationLink(value: FacetDestination.project(id: proj.id)) {
                                HStack {
                                    Circle()
                                        .fill(FacetNativeStyle.swatchColor(proj.color))
                                        .frame(width: 10, height: 10)
                                    Text(proj.name)
                                    Spacer()
                                    Text("\(store.openTaskCount(inProject: proj.id))")
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(.leading, CGFloat(store.projectPath(proj).count - 1) * 12)
                            .contextMenu {
                                Button("Edit Project…") { onPresentModal(.editProject(proj)) }
                                Button("Archive Project") { store.archive(proj, archived: true) }
                            }
                        }
                        FacetArchivedProjects(store: store)
                    } header: {
                        HStack {
                            Text("My Projects")
                            Spacer()
                            Button {
                                onPresentModal(.addProject)
                            } label: {
                                Image(systemName: "plus")
                            }
                            .accessibilityLabel("Add project")
                        }
                    }

                    SwiftUI.Section {
                        ForEach(store.activeLabels) { item in
                            NavigationLink(value: FacetDestination.label(id: item.id)) {
                                Label("@\(item.name)", systemImage: "tag")
                            }
                            .contextMenu {
                                Button("Edit Label…") { onPresentModal(.editLabel(item)) }
                            }
                        }
                    } header: {
                        HStack {
                            Text("Labels")
                            Spacer()
                            Button {
                                onPresentModal(.addLabel)
                            } label: {
                                Image(systemName: "plus")
                            }
                            .accessibilityLabel("Add label")
                        }
                    }

                    SwiftUI.Section {
                        ForEach(store.activeFilters) { filterItem in
                            NavigationLink(value: FacetDestination.filter(id: filterItem.id)) {
                                Label(
                                    filterItem.name,
                                    systemImage: "line.3.horizontal.decrease.circle"
                                )
                            }
                            .contextMenu {
                                Button("Edit Filter…") { onPresentModal(.editFilter(filterItem)) }
                            }
                        }
                    } header: {
                        HStack {
                            Text("Filters")
                            Spacer()
                            Button {
                                onPresentModal(.addFilter)
                            } label: {
                                Image(systemName: "plus")
                            }
                            .accessibilityLabel("Add filter")
                        }
                    }
                    SwiftUI.Section("Views") {
                        NavigationLink(value: FacetDestination.board) {
                            Label("Priority Board", systemImage: "rectangle.split.3x1")
                        }
                        NavigationLink(value: FacetDestination.section(.completed)) {
                            Label("Completed", systemImage: "checkmark.circle")
                        }
                    }
                }
                .navigationDestination(for: FacetDestination.self) { target in
                    browseDestinationPage(target)
                }
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Settings", systemImage: "gearshape") { store.showsSettings = true }
                    }
                }
                .navigationTitle("Browse")
                .refreshable {
                    await store.syncNow()
                }
            }
        }

        private func browseDestinationPage(
            _ target: FacetDestination
        ) -> some View {
            FacetTaskListView(
                store: store,
                onSelectTask: { task in
                    store.selectedTaskId = task.id
                    store.showsInspector = true
                },
                onPresentModal: onPresentModal
            )
            .toolbar { searchButton }
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                store.destination = target
            }
        }
    }
#endif
