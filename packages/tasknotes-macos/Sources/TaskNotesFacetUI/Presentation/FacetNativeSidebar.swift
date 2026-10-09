import SwiftUI
import TaskNotesKit

internal struct FacetNativeSidebar: View {
    let store: FacetStore
    @Bindable var window: FacetWindowState
    let choose: (String) -> Void
    let admitNavigation: (@MainActor () async -> Bool)?
    @State private var browseDetail: FacetTask?
    @State private var managesViews = false

    init(
        store: FacetStore, window: FacetWindowState, choose: @escaping (String) -> Void,
        admitNavigation: (@MainActor () async -> Bool)? = nil
    ) {
        self.store = store
        self.window = window
        self.choose = choose
        self.admitNavigation = admitNavigation
    }

    var body: some View {
        List {
            Section {
                ForEach(FacetNativeWorkspace.routes.filter { $0.id != "browse" }, id: \.id) {
                    route in
                    routeRow(route.title, symbol: route.symbol, scope: route.id)
                }
                routeRow("All tasks", symbol: "list.bullet", scope: "all")
                routeRow("Board", symbol: "rectangle.split.3x1", scope: "board")
                routeRow("Completed", symbol: "checkmark.circle", scope: "completed")
            }
            if let snapshot = window.snapshot {
                if !snapshot.views.isEmpty {
                    Section("Saved views") {
                        ForEach(snapshot.views) { view in
                            savedViewRow(view)
                        }
                    }
                }
                Button("Manage saved views", systemImage: "rectangle.stack") { managesViews = true }
                ForEach(
                    [
                        ("Projects", "projects", "folder"), ("Contexts", "contexts", "at"),
                        ("Tags", "tags", "tag"),
                    ], id: \.1
                ) { title, key, symbol in
                    let values = window.vocabulary[key] ?? []
                    if !values.isEmpty {
                        Section(title) {
                            ForEach(values, id: \.self) { value in
                                entityRow(value, key: key, symbol: symbol, snapshot: snapshot)
                            }
                        }
                    }
                }
            }
        }
        #if os(macOS)
            .listStyle(.sidebar).foregroundStyle(Color.primary)
        #else
            .listStyle(.insetGrouped).foregroundStyle(Color.primary)
        #endif
        .sheet(isPresented: $managesViews) {
            if let profileID = window.snapshot?.profileId {
                FacetSavedViewsForm(
                    store: store, profileID: profileID, board: $window.board, window: window,
                    admitNavigation: admitNavigation)
            }
        }
    }

    @ViewBuilder private func savedViewRow(_ view: FacetSavedView) -> some View {
        #if os(macOS)
            Button {
                _Concurrency.Task {
                    guard await admitNavigation?() ?? true else { return }
                    await window.apply(view, store: store)
                }
            } label: {
                Label(
                    view.view["name"]?.text ?? view.id,
                    systemImage: "line.3.horizontal.decrease.circle")
            }.buttonStyle(.plain)
        #else
            NavigationLink {
                FacetMobileBrowseDestination(
                    store: store,
                    scope: view.view["query"]?.object?.fields["scope"]?.text ?? "all",
                    title: view.view["name"]?.text ?? view.id,
                    query: view.view["query"]?.object?.fields ?? [:], savedView: view)
            } label: {
                Label(
                    view.view["name"]?.text ?? view.id,
                    systemImage: "line.3.horizontal.decrease.circle")
            }
        #endif
    }

    @ViewBuilder private func routeRow(_ title: String, symbol: String, scope: String) -> some View
    {
        #if os(macOS)
            Button {
                choose(scope)
            } label: {
                Label {
                    Text(title).foregroundStyle(FacetNativeStyle.text)
                } icon: {
                    Image(systemName: symbol).foregroundStyle(FacetNativeStyle.secondaryText)
                }
            }
            .buttonStyle(.plain)
            .listRowBackground(
                window.scope == scope ? Color.accentColor.opacity(0.12) : Color.clear)
        #else
            NavigationLink {
                FacetMobileBrowseDestination(store: store, scope: scope, title: title)
            } label: {
                Label(title, systemImage: symbol)
            }
        #endif
    }
    @ViewBuilder private func entityRow(
        _ value: String, key: String, symbol: String, snapshot: FacetSnapshot
    ) -> some View {
        #if os(macOS)
            Button {
                _Concurrency.Task {
                    guard await admitNavigation?() ?? true else { return }
                    window.savedQuery = [key: .array([.string(value)])]
                    window.scope = "all"
                    await window.reload(store: store)
                }
            } label: {
                Label(value, systemImage: symbol)
            }.buttonStyle(.plain)
        #else
            NavigationLink {
                FacetMobileBrowseDestination(
                    store: store, scope: "all", title: value, query: [key: .array([.string(value)])]
                )
            } label: {
                Label(value, systemImage: symbol)
            }
        #endif
    }
}

#if os(iOS)
    internal struct FacetMobileBrowseDestination: View {
        let store: FacetStore
        let scope: String
        let title: String
        var query: [String: FacetValue] = [:]
        var savedView: FacetSavedView?
        @State private var window = FacetWindowState()
        @State private var detail: FacetTask?
        var body: some View {
            Group {
                if let snapshot = window.snapshot {
                    FacetNativeTaskList(
                        store: store, window: window, snapshot: snapshot, selected: nil
                    ) { detail = $0 }
                } else {
                    ProgressView("Opening view…")
                }
            }
            .navigationTitle(title)
            .searchable(text: $window.search)
            .task {
                if let savedView {
                    await window.apply(savedView, store: store)
                } else {
                    window.scope = scope == "board" ? "all" : scope
                    window.board = scope == "board"
                    window.savedQuery = query
                    await window.reload(store: store)
                }
            }
            .onChange(of: window.search) { _Concurrency.Task { await window.reload(store: store) } }
            .onChange(of: store.snapshot?.version) {
                _Concurrency.Task { await window.reload(store: store) }
            }
            .sheet(item: $detail) { task in
                if let profileID = window.snapshot?.profileId {
                    FacetTaskEditor(
                        store: store, task: task, profileID: profileID,
                        statuses: store.statuses, priorities: store.priorities
                    )
                    .presentationDetents([.fraction(0.75), .large]).presentationDragIndicator(
                        .visible)
                }
            }
        }
    }
#endif

internal struct FacetNativeNotices: View {
    let store: FacetStore
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let profileID = store.selectedProfileID, let state = store.syncStates[profileID] {
                Label(state, systemImage: "arrow.triangle.2.circlepath").font(.caption)
                    .foregroundStyle(.secondary).accessibilityIdentifier("facet.sync.status")
            }
            if store.needsStandardConsent {
                Text(
                    "This vault has no TaskNotes settings. Use the standard configuration to begin creating tasks?"
                )
                Button("Use standard configuration") {
                    _Concurrency.Task { await store.approveStandardConfiguration() }
                }
            }
            if let snapshot = store.snapshot, snapshot.conflictCount > 0 {
                Button(
                    "\(snapshot.conflictCount) conflicts need your attention",
                    systemImage: "exclamationmark.arrow.triangle.2.circlepath"
                ) {
                    _Concurrency.Task { await store.loadConflicts() }
                }.accessibilityIdentifier("facet.conflicts.open")
            }
            ForEach(store.pendingActions) { action in
                if action.canResume {
                    Button("Resume saved action in \(action.profileID)") {
                        _Concurrency.Task { await store.resumeSavedAction(action) }
                    }
                    Button("Check outcome and retire saved action") {
                        _Concurrency.Task { await store.retireSavedAction(action) }
                    }.disabled(store.selectedProfileID != action.profileID)
                } else {
                    Text("A saved action uses a removed feature. Its original request is retained.")
                        .font(.caption)
                    Button("Check outcome and retire saved action") {
                        _Concurrency.Task { await store.retireSavedAction(action) }
                    }
                    .disabled(store.selectedProfileID != action.profileID)
                }
            }
        }.padding(
            store.needsStandardConsent || !store.pendingActions.isEmpty
                || (store.snapshot?.conflictCount ?? 0) > 0 ? 12 : 0)
    }
}
