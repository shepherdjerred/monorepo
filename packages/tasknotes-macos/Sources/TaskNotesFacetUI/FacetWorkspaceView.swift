import SwiftUI
import TaskNotesKit

/// Workspace presentation; the root owns startup, lifecycle and system presentation.
internal struct FacetWorkspaceView: View {
    @Bindable var store: FacetStore
    @Binding var importsFolder: Bool
    @Binding var board: Bool

    var body: some View {
        if store.profiles.isEmpty {
            onboardingWorkspace
        } else {
            FacetNativeWorkspace(store: store, importsFolder: $importsFolder)
        }
    }

    private var onboardingWorkspace: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ForEach(store.pendingImports) { imported in
                    Button("Retry independent copy of \(imported.name)") {
                        _Concurrency.Task { await store.retryImport(imported) }
                    }.disabled(store.isLoading).padding(.horizontal)
                }
                if store.profiles.isEmpty {
                    onboarding
                } else {
                    filters
                    ForEach(store.pendingActions) { action in
                        let owner = store.profiles.first(where: { $0.id == action.profileID })
                        if action.canResume {
                            Button("Resume saved action in \(owner?.name ?? action.profileID)") {
                                _Concurrency.Task { await store.resumeSavedAction(action) }
                            }
                            .disabled(store.isSaving)
                            .padding(.horizontal)
                        } else {
                            Text(
                                "A saved action in \(owner?.name ?? action.profileID) uses a removed feature. "
                                    + "Its original request is retained."
                            )
                            .font(.caption).foregroundStyle(.secondary).padding(.horizontal)
                            Button("Check outcome and retire saved action") {
                                _Concurrency.Task { await store.retireSavedAction(action) }
                            }
                            .disabled(store.isSaving || store.selectedProfileID != action.profileID)
                            .padding(.horizontal)
                        }
                    }
                    if let profileID = store.selectedProfileID,
                        let state = store.syncStates[profileID]
                    {
                        Text(state).font(.caption).foregroundStyle(.secondary).padding(.horizontal)
                    }
                    if let route = store.notificationRoute {
                        let owner =
                            store.profiles.first { $0.id == route.profileID }?.name
                            ?? route.profileID
                        Button("Open reminder task in \(owner)") {
                            _Concurrency.Task { await store.openNotificationRoute() }
                        }.disabled(store.isSaving || store.isLoading)
                    }
                    if let reminderStatus = store.reminderStatus {
                        Text(reminderStatus).font(.caption).foregroundStyle(.secondary).padding(
                            .horizontal)
                    }
                    if store.needsStandardConsent {
                        VStack(spacing: 12) {
                            Text(
                                "This vault has no TaskNotes settings. "
                                    + "Use the standard TaskNotes configuration to begin creating tasks?"
                            )
                            Button("Use standard configuration") {
                                _Concurrency.Task { await store.approveStandardConfiguration() }
                            }
                        }.padding()
                    }
                    if let snapshot = store.snapshot {
                        if snapshot.conflictCount > 0 {
                            Button("\(snapshot.conflictCount) conflicts need your attention") {
                                _Concurrency.Task { await store.loadConflicts() }
                            }
                            .accessibilityIdentifier("facet.conflicts.open")
                            .padding()
                        }
                        FacetTaskBrowser(store: store, snapshot: snapshot, board: $board)
                    } else {
                        ProgressView("Opening vault…").frame(maxHeight: .infinity)
                    }
                }
            }
            .navigationTitle("Facet")
            .searchable(text: $store.search, prompt: "Search tasks")
            .toolbar {
                ToolbarItemGroup {
                    Menu {
                        ForEach(store.profiles) { profile in
                            Button(profile.name) {
                                _Concurrency.Task { await store.selectProfile(profile.id) }
                            }
                        }
                        Divider()
                        Button(folderAction) { importsFolder = true }
                        Button("Connect Obsidian Sync…") { store.showsAccount = true }
                        if store.remindersEnabled {
                            Button("Turn off task reminders") {
                                _Concurrency.Task { await store.disableReminders() }
                            }
                        } else {
                            Button("Enable task reminders…") {
                                _Concurrency.Task { await store.enableReminders() }
                            }
                        }
                        Button("Sign out of Obsidian") {
                            _Concurrency.Task { await store.signOut() }
                        }
                    } label: {
                        Label("Vaults", systemImage: "folder")
                    }
                    Button {
                        board.toggle()
                    } label: {
                        Label(
                            board ? "List" : "Board",
                            systemImage: board ? "list.bullet" : "rectangle.split.3x1")
                    }
                    .disabled(store.selectedProfileID == nil)
                    Button {
                        store.showsCapture = true
                    } label: {
                        Label("Add task", systemImage: "plus")
                    }
                    .disabled(store.selectedProfileID == nil)
                    .accessibilityIdentifier("facet.capture.open")
                    Button {
                        _Concurrency.Task { await store.refresh() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .disabled(store.selectedProfileID == nil)
                }
            }
        }
    }

    private var folderAction: String {
        #if os(iOS)
            "Import vault copy…"
        #else
            "Open vault folder…"
        #endif
    }
    private var onboarding: some View {
        FacetVaultOnboarding(
            store: store, importsFolder: $importsFolder, folderAction: folderAction)
    }

    private var filters: some View {
        FacetFilters(store: store)
    }
}
