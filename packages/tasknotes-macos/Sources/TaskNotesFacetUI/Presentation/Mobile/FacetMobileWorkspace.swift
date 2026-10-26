#if os(iOS)
    import SwiftUI
    import TaskNotesKit

    /// Each tab owns its query and navigation stack. Searching never replaces
    /// the selected collection or carries that collection's filters with it.
    internal struct FacetMobileWorkspace: View {
        let store: FacetStore
        @Binding var importsFolder: Bool
        @Binding var capturePresented: Bool
        let sheets: FacetSheetPresentation
        let initialWindow: FacetWindowState
        @State private var navigation: FacetMobileNavigation
        @State private var settings = false
        @State private var searching = false
        @State private var browseWindow: FacetWindowState

        init(
            store: FacetStore, importsFolder: Binding<Bool>, capturePresented: Binding<Bool>,
            sheets: FacetSheetPresentation, initialWindow: FacetWindowState
        ) {
            self.store = store
            _importsFolder = importsFolder
            _capturePresented = capturePresented
            self.sheets = sheets
            self.initialWindow = initialWindow
            let initialRoute =
                FacetNativeWorkspace.routes.contains { $0.id == initialWindow.scope }
                ? initialWindow.scope : "browse"
            _navigation = State(initialValue: FacetMobileNavigation(route: initialRoute))
            _browseWindow = State(
                initialValue: initialRoute == "browse"
                    ? initialWindow : FacetWindowState(clock: store.clock))
        }

        var body: some View {
            TabView(selection: $navigation.route) {
                ForEach(FacetNativeWorkspace.routes, id: \.id) { item in
                    NavigationStack {
                        VStack(spacing: 0) {
                            if navigation.route == item.id {
                                FacetNativeNotices(store: store, sheets: sheets)
                            }
                            if item.id == "browse" {
                                FacetNativeSidebar(
                                    store: store, window: browseWindow,
                                    choose: { navigation.route = $0 }
                                )
                                .task(id: store.selectedProfileID) {
                                    await browseWindow.reload(store: store)
                                }
                                .onChange(of: store.snapshot?.version) {
                                    _Concurrency.Task { await browseWindow.reload(store: store) }
                                }
                            } else {
                                FacetMobileTaskScreen(
                                    store: store, scope: item.id,
                                    captureFallback: { capturePresented = true },
                                    goToToday: { navigation.route = "today" },
                                    initialWindow: item.id == initialWindow.scope
                                        ? initialWindow : nil)
                            }
                        }
                        .navigationTitle(item.title)
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItemGroup(placement: .topBarTrailing) {
                                Button("Search", systemImage: "magnifyingglass") {
                                    searching = true
                                }
                                .accessibilityIdentifier("facet.search.open")
                                Button("Settings", systemImage: "gearshape") { settings = true }
                                    .accessibilityIdentifier("facet.settings.open")
                            }
                        }
                    }
                    .tabItem {
                        Label(item.title, systemImage: item.symbol)
                            .accessibilityIdentifier("facet.tab.\(item.id)")
                    }
                    .tag(item.id)
                }
            }
            .tint(FacetNativeStyle.brand)
            .task(id: store.navigationRequestID) { await handleNavigationRequest() }
            .sheet(isPresented: $searching) {
                NavigationStack {
                    FacetMobileTaskScreen(
                        store: store, scope: "all", globalSearch: true
                    )
                    .navigationTitle("Search")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { searching = false }
                                .accessibilityIdentifier("facet.search.done")
                        }
                    }
                }
            }
            .sheet(isPresented: $settings) {
                NavigationStack {
                    FacetNativeSettings(store: store, importsFolder: $importsFolder, sheets: sheets)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done") { settings = false }
                                    .accessibilityIdentifier("facet.settings.done")
                            }
                        }
                }
            }
            .disabled(FacetDraftCoordinator.shared.isTransitioning)
        }

        private func handleNavigationRequest() async {
            guard let request = store.navigationRequestID else { return }
            let profileID = store.selectedProfileID
            let engine = store.engine
            let accepted = await navigation.requestToday(
                ownsOwner: {
                    store.navigationRequestID == request && store.selectedProfileID == profileID
                        && store.engine === engine
                },
                admitNavigation: { await FacetDraftCoordinator.shared.flush(owner: store) })
            if accepted, store.navigationRequestID == request { store.navigationRequestID = nil }
        }
    }
#endif
