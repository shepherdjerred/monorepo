import SwiftUI
import TaskNotesKit

internal struct FacetNativeWorkspace: View {
    @Bindable var store: FacetStore
    @Binding var importsFolder: Bool
    @State private var window: FacetWindowState
    @State private var draft: FacetInspectorDraft?
    @State private var detail: FacetTask?
    @State private var route = "inbox"
    @State private var settings = false
    @State private var searching = false
    @State private var deletingSelection = false
    @State private var selectionAction = FacetBulkDraft()
    @State private var commitRegistration = UUID()
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @Environment(\.facetFeedbackOrigin) private var feedbackOrigin

    init(
        store: FacetStore, importsFolder: Binding<Bool>, window: FacetWindowState? = nil,
        draft: FacetInspectorDraft? = nil
    ) {
        self.store = store
        _importsFolder = importsFolder
        let state = window ?? FacetWindowState(store: store)
        _window = State(initialValue: state)
        _route = State(
            initialValue: Self.routes.contains(where: { $0.id == state.scope })
                ? state.scope : "browse")
        _draft = State(initialValue: draft)
    }

    var body: some View {
        platformWorkspace
            .onAppear {
                registerDraft()
                window.feedbackOrigin = feedbackOrigin
                window.reducedMotion = reducedMotion
            }
            .onChange(of: reducedMotion) { window.reducedMotion = reducedMotion }
            .onChange(of: feedbackOrigin) { window.feedbackOrigin = feedbackOrigin }
            .onChange(of: store.appliedFeedback) {
                _Concurrency.Task { await window.reload(store: store) }
            }
            .onChange(of: draft?.rowID) { registerDraft() }
            .onDisappear { FacetDraftCoordinator.shared.unregister(commitRegistration) }
            .disabled(FacetDraftCoordinator.shared.isTransitioning)
            #if os(macOS)
                .background(FacetWindowCloseGuard(flush: flush).frame(width: 0, height: 0))
                .focusedSceneValue(\.facetWindowCommands, commandActions)
                .confirmationDialog(
                    "Delete the selected task notes?", isPresented: $deletingSelection
                ) {
                    Button("Delete", role: .destructive) { mutateSelection(deleting: true) }
                }
            #endif
            .task(id: store.selectedProfileID) {
                if draft?.profileID != store.selectedProfileID { draft = nil }
                await window.reload(store: store)
            }
            .onChange(of: store.snapshot?.version) {
                _Concurrency.Task { await window.reload(store: store) }
            }
            .onChange(of: window.search) { _Concurrency.Task { await window.reload(store: store) } }
            .onChange(of: window.scope) { _Concurrency.Task { await window.reload(store: store) } }
            .sheet(item: $detail) { task in
                if let snapshot = window.snapshot {
                    FacetTaskEditor(
                        store: store, task: task, profileID: snapshot.profileId,
                        statuses: pairs(snapshot, "statuses"),
                        priorities: pairs(snapshot, "priorities")
                    )
                    #if os(iOS)
                        .presentationDetents([.fraction(0.75), .large]).presentationDragIndicator(
                            .visible)
                    #endif
                }
            }
            .sheet(isPresented: $settings) {
                NavigationStack {
                    FacetNativeSettings(store: store, importsFolder: $importsFolder)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done") { settings = false }
                            }
                        }
                }
            }
    }

    @ViewBuilder private var platformWorkspace: some View {
        #if os(macOS)
            NavigationSplitView {
                FacetNativeSidebar(
                    store: store, window: window, choose: navigate, admitNavigation: flush
                )
                .navigationSplitViewColumnWidth(
                    min: CGFloat(FacetNativeStyle.tokens.desktop.sidebar.min),
                    ideal: CGFloat(FacetNativeStyle.tokens.desktop.sidebar.ideal),
                    max: CGFloat(FacetNativeStyle.tokens.desktop.sidebar.max))
            } detail: {
                content.navigationTitle(title)
                    .searchable(
                        text: $window.search, isPresented: $searching, prompt: "Search tasks"
                    )
                    .toolbar { workspaceToolbar }
                    .inspector(isPresented: $window.inspectorPresented) {
                        if let draft, let snapshot = window.snapshot {
                            FacetNativeInspector(
                                store: store, window: window, draft: draft,
                                configuration: snapshot.configuration)
                        } else {
                            ContentUnavailableView {
                                Label {
                                    Text("Select a task").foregroundStyle(FacetNativeStyle.text)
                                } icon: {
                                    Image(systemName: "sidebar.right").foregroundStyle(
                                        FacetNativeStyle.secondaryText)
                                }
                            } description: {
                                Text("Its details will appear here.").foregroundStyle(
                                    FacetNativeStyle.secondaryText)
                            }
                        }
                    }
            }
        #else
            TabView(selection: $route) {
                ForEach(Self.routes, id: \.id) { item in
                    NavigationStack {
                        Group {
                            if item.id == "browse" {
                                FacetNativeSidebar(store: store, window: window, choose: navigate)
                            } else {
                                content
                            }
                        }
                        .navigationTitle(item.title)
                        .searchable(
                            text: $window.search, isPresented: $searching, prompt: "Search tasks"
                        )
                        .toolbar { workspaceToolbar }
                        .overlay(alignment: .bottomTrailing) {
                            Button {
                                store.showsCapture = true
                            } label: {
                                Image(systemName: "plus").font(.title2.weight(.semibold))
                                    .frame(width: 56, height: 56)
                            }.buttonStyle(.borderedProminent).buttonBorderShape(.circle)
                                .accessibilityLabel("Add task").accessibilityIdentifier(
                                    "facet.capture.open"
                                )
                                .padding(20)
                        }
                    }.tabItem { Label(item.title, systemImage: item.symbol) }.tag(item.id)
                }
            }
            .tint(FacetNativeStyle.brand)
            .onChange(of: route) { if route != "browse" { navigate(route) } }
        #endif
    }

    private var content: some View {
        VStack(spacing: 0) {
            FacetNativeNotices(store: store)
            if let error = window.error {
                Label(error, systemImage: "exclamationmark.triangle").padding()
            }
            if let snapshot = window.snapshot {
                FacetNativeTaskList(
                    store: store, window: window, snapshot: snapshot, selected: draft?.rowID,
                    admitNavigation: flush, open: open)
            } else {
                ProgressView("Opening vault…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    @ToolbarContentBuilder private var workspaceToolbar: some ToolbarContent {
        #if os(iOS)
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("Search", systemImage: "magnifyingglass") { searching = true }
                Button("Settings", systemImage: "gearshape") { settings = true }
            }
        #else
            ToolbarItemGroup {
                Menu {
                    ForEach(store.profiles) { profile in
                        Button(profile.name) {
                            _Concurrency.Task {
                                guard await flush() else { return }
                                await store.selectProfile(profile.id)
                            }
                        }
                    }
                    Divider()
                    Button(folderAction) { importsFolder = true }
                    Button("Connect Obsidian Sync…") { store.showsAccount = true }
                    Button(store.remindersEnabled ? "Turn off reminders" : "Enable reminders…") {
                        _Concurrency.Task {
                            if store.remindersEnabled {
                                await store.disableReminders()
                            } else {
                                await store.enableReminders()
                            }
                        }
                    }
                    Button("Sign out of Obsidian") { _Concurrency.Task { await store.signOut() } }
                } label: {
                    Label("Vaults and settings", systemImage: "gearshape")
                }
                Button {
                    window.board.toggle()
                } label: {
                    Label(
                        window.board ? "List" : "Board",
                        systemImage: window.board ? "list.bullet" : "rectangle.split.3x1")
                }
                Button {
                    store.showsCapture = true
                } label: {
                    Label("Add task", systemImage: "plus")
                }
                .accessibilityIdentifier("facet.capture.open")
                Button {
                    _Concurrency.Task { await store.refresh() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                #if os(macOS)
                    Button {
                        window.inspectorPresented.toggle()
                    } label: {
                        Label("Inspector", systemImage: "sidebar.right")
                    }
                    .keyboardShortcut("i", modifiers: [.command, .option])
                #endif
            }
        #endif
    }
}

extension FacetNativeWorkspace {
    private func open(_ task: FacetTask) {
        #if os(macOS)
            _Concurrency.Task {
                guard draft?.rowID != task.rowID, let profileID = window.snapshot?.profileId
                else { return }
                let query = window.displayedQuery
                let engine = store.engine
                let owns = store.presentationOwner(
                    profileID: profileID, tracksRequest: false,
                    ownsEngine: { store.engine === engine })
                guard await flush(), owns(), store.selectedProfileID == profileID,
                    window.snapshot?.profileId == profileID,
                    window.displayedQuery == query,
                    let currentTask = window.snapshot?.tasks.first(where: { $0.rowID == task.rowID }
                    ),
                    !FacetDraftCoordinator.shared.isTransitioning
                else { return }
                draft = FacetInspectorDraft(task: currentTask, profileID: profileID)
                window.selectedTaskIDs = [currentTask.rowID]
                window.inspectorPresented = true
            }
        #else
            detail = task
        #endif
    }
    private func navigate(_ scope: String) {
        _Concurrency.Task {
            guard await flush() else { return }
            window.savedQuery = [:]
            window.selectedViewID = nil
            window.scope = scope
            window.board = scope == "board"
            if scope == "board" { window.scope = "all" }
            await window.reload(store: store)
        }
    }
    private func flush() async -> Bool {
        guard let draft else { return true }
        return await draft.flush(store: store, window: window)
    }
    private func registerDraft() {
        guard let draft else {
            FacetDraftCoordinator.shared.unregister(commitRegistration)
            return
        }
        FacetDraftCoordinator.shared.register(
            commitRegistration, owner: store, profileID: draft.profileID,
            isDirty: { draft.isDirty },
            flush: {
                await draft.flush(store: store, window: window)
            })
    }
    #if os(macOS)
        private var commandActions: FacetWindowCommandActions? {
            guard window.snapshot != nil, !FacetDraftCoordinator.shared.isTransitioning else {
                return nil
            }
            return FacetWindowCommandActions(
                hasSelection: !window.selectedTaskIDs.isEmpty,
                inspectorPresented: window.inspectorPresented,
                newTask: { store.showsCapture = true }, find: { searching = true },
                navigate: navigate,
                complete: { mutateSelection(deleting: false) },
                delete: { deletingSelection = true },
                toggleInspector: { window.inspectorPresented.toggle() },
                refresh: {
                    _Concurrency.Task {
                        await store.refresh()
                        await window.reload(store: store)
                    }
                })
        }
        private func mutateSelection(deleting: Bool) {
            guard !selectionAction.isSubmitting else { return }
            if selectionAction.hasRetainedSubmission {
                store.error =
                    "Resolve the original selection action in Settings before changing it."
                _Concurrency.Task {
                    if await selectionAction.releaseResolved() {
                        store.error =
                            "The original action is resolved. Review the selection before trying again."
                    }
                }
                return
            }
            guard let snapshot = window.snapshot,
                let selection = FacetReviewedSelection(
                    store: store, window: window, snapshot: snapshot),
                let operations = store.bulkOperations(profileID: selection.profileID)
            else { return }
            guard
                selectionAction.begin(
                    selection.tasks, action: deleting ? .delete : .complete, operations: operations)
            else {
                store.error = selectionAction.error
                return
            }
            _Concurrency.Task {
                guard await flush() else {
                    selectionAction.cancelBeforeDispatch()
                    return
                }
                if await selectionAction.submit() {
                    selection.clearIfCurrent(store: store, window: window)
                } else {
                    store.error = selectionAction.error
                }
                await window.reload(store: store)
            }
        }
    #endif
    private func pairs(_ snapshot: FacetSnapshot, _ key: String) -> [(value: String, label: String)]
    {
        do {
            return try FacetConfiguredChoice.choices(in: snapshot.configuration, key: key).map {
                ($0.value, $0.label)
            }
        } catch { preconditionFailure("Invalid validated workflow configuration: \(error)") }
    }
    private var title: String {
        Self.routes.first { $0.id == window.scope }?.title ?? (window.board ? "Board" : "Tasks")
    }
    private var folderAction: String {
        #if os(iOS)
            "Import vault copy…"
        #else
            "Open vault folder…"
        #endif
    }
    static let routes = [
        (id: "inbox", title: "Inbox", symbol: "tray"),
        (id: "today", title: "Today", symbol: "sun.max"),
        (id: "upcoming", title: "Upcoming", symbol: "calendar"),
        (id: "browse", title: "Browse", symbol: "square.grid.2x2"),
    ]
}
