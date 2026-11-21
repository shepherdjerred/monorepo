#if os(macOS)
    import Foundation
    import SwiftUI
    import TaskNotesKit

    internal struct FacetNativeWorkspace: View {
        @Bindable var store: FacetStore
        let onPresentModal: (FacetPresentedEntityModal) -> Void

        @State private var searchFieldPresented = false
        @State private var inspectorDismissals = 0
        @State private var searchState = FacetWorkspaceSearchState()

        var body: some View {
            NavigationSplitView {
                FacetNativeSidebar(store: store, onPresentModal: onPresentModal)
                    .navigationSplitViewColumnWidth(min: 210, ideal: 240, max: 320)
            } detail: {
                FacetTaskListView(
                    store: store,
                    onSelectTask: { task in
                        store.selectedTaskId = task.id
                        store.showsInspector = true
                    },
                    onPresentModal: onPresentModal,
                    inspectorDismissals: inspectorDismissals
                )
                .frame(maxWidth: listWidth)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .sheet(isPresented: $searchFieldPresented) {
                    FacetWorkspaceSearch(store: store, session: searchState) { destination in
                        searchFieldPresented = false
                        store.destination = destination
                    }
                }
                .sheet(
                    isPresented: $store.showsInspector,
                    onDismiss: { inspectorDismissals += 1 },
                    content: {
                        inspectorColumn
                            .frame(minWidth: 420, idealWidth: 740, minHeight: 360, idealHeight: 520)
                    }
                )
                .toolbar {
                    if searchState.isShowingCollection(in: store) {
                        ToolbarItem(placement: .navigation) {
                            Button("Back to Search", systemImage: "chevron.backward") {
                                showSearch()
                            }
                            .keyboardShortcut(.cancelAction)
                        }
                    }
                    ToolbarItemGroup(placement: .primaryAction) {
                        Button {
                            _Concurrency.Task { await store.syncNow() }
                        } label: {
                            Label(
                                "Sync",
                                systemImage: store.isSyncing
                                    ? "arrow.triangle.2.circlepath.circle.fill"
                                    : "arrow.clockwise"
                            )
                        }
                        .disabled(store.isSyncing || !store.hasConfiguredToken)
                        .help("Sync Now (⌘R)")
                        .accessibilityIdentifier(AccessibilityIdentifier.TaskList.refresh)
                    }
                }
            }
            .onChange(of: store.searchFocusedRequest) {
                showSearch()
            }
            .onChange(of: store.destination) { previous, current in
                guard store.resolvedDestination(previous) != current else { return }
                if !searchState.isShowingCollection(in: store) {
                    searchState.openedCollection = nil
                }
                store.selectedTaskId = nil
                store.showsInspector = false
            }
            .background(
                FacetWindowCloseGuard {
                    await store.flushBeforeClose()
                }
                .frame(width: 0, height: 0)
            )
            .focusedSceneValue(\.facetWindowCommands, windowCommandActions)
        }

        private func showSearch() {
            if searchState.isShowingCollection(in: store), let origin = searchState.origin {
                store.destination = origin
                searchState.openedCollection = nil
            }
            searchFieldPresented = true
        }

        private var listWidth: CGFloat {
            switch store.destination {
            case .board: .infinity
            case .project(let id) where store.layout(forProject: id) == .board: .infinity
            case .section, .project, .filter, .label: 800
            }
        }

        @ViewBuilder
        private var inspectorColumn: some View {
            if let selectedId = store.selectedTaskId, let task = store.task(for: selectedId) {
                VStack(alignment: .trailing) {
                    Button("Done") { store.showsInspector = false }
                        .keyboardShortcut(.cancelAction)
                        .padding([.top, .trailing])
                    FacetTaskInspectorView(task: task, store: store) {
                        store.showsInspector = false
                    }
                }
            } else {
                Button("Close") { store.showsInspector = false }
                    .keyboardShortcut(.cancelAction)
            }
        }

        private var windowCommandActions: FacetWindowCommandActions {
            let selectedTask = store.selectedTaskId.flatMap { store.task(for: $0) }
            return FacetWindowCommandActions(
                hasSelection: selectedTask != nil,
                inspectorPresented: store.showsInspector,
                newTask: { store.showsCapture = true },
                delete: {
                    if let selectedTask {
                        store.deleteTask(selectedTask)
                    }
                },
                complete: {
                    if let selectedTask {
                        store.toggleTaskCompletion(selectedTask)
                    }
                },
                find: showSearch,
                toggleInspector: { if selectedTask != nil { store.showsInspector.toggle() } },
                navigate: { target in
                    if target == "inbox" {
                        store.destination = .section(.inbox)
                    } else if target == "today" {
                        store.destination = .section(.today)
                    } else if target == "upcoming" {
                        store.destination = .section(.upcoming)
                    } else if target == "completed" {
                        store.destination = .section(.completed)
                    } else if target == "board" {
                        store.destination = .board
                    }
                },
                refresh: {
                    _Concurrency.Task { await store.syncNow() }
                }
            )
        }
    }
#endif
