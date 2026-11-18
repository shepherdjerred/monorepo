#if os(macOS)
    import Foundation
    import SwiftUI
    import TaskNotesKit

    internal struct FacetNativeWorkspace: View {
        @Bindable var store: FacetStore
        let onPresentModal: (FacetPresentedEntityModal) -> Void

        @State private var searchFieldPresented = false

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
                    onPresentModal: onPresentModal
                )
                .searchable(
                    text: $store.searchQuery,
                    isPresented: $searchFieldPresented,
                    prompt: "Filter tasks…"
                )
                .inspector(isPresented: $store.showsInspector) {
                    inspectorColumn
                        .inspectorColumnWidth(min: 290, ideal: 340, max: 440)
                }
                .toolbar {
                    ToolbarItemGroup(placement: .primaryAction) {
                        Button {
                            store.showsCapture = true
                        } label: {
                            Label("Quick Add", systemImage: "plus")
                        }
                        .help("Add Task (⌘N)")
                        .accessibilityIdentifier(AccessibilityIdentifier.TaskList.newTask)

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

                        Button {
                            store.showsInspector.toggle()
                        } label: {
                            Label("Inspector", systemImage: "sidebar.trailing")
                        }
                        .help("Toggle Inspector (⌥⌘I)")
                        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.toggle)
                    }
                }
            }
            .onChange(of: store.searchFocusedRequest) {
                searchFieldPresented = true
            }
            .background(
                FacetWindowCloseGuard {
                    await store.flushBeforeClose()
                }
                .frame(width: 0, height: 0)
            )
            .focusedSceneValue(\.facetWindowCommands, windowCommandActions)
        }

        @ViewBuilder
        private var inspectorColumn: some View {
            if let selectedId = store.selectedTaskId, let task = store.task(for: selectedId) {
                FacetTaskInspectorView(task: task, store: store)
            } else {
                VStack(spacing: 10) {
                    Image(systemName: "sidebar.trailing")
                        .font(.title)
                        .foregroundStyle(.tertiary)
                    Text("No Task Selected")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                    Text(
                        "Select any task to edit Markdown notes, recurrence, labels, sub-tasks, and reminders."
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 20)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier(AccessibilityIdentifier.Inspector.empty)
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
                find: { searchFieldPresented = true },
                toggleInspector: { store.showsInspector.toggle() },
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
