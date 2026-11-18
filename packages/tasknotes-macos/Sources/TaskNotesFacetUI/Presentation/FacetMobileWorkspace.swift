#if os(iOS)
    import Foundation
    import SwiftUI
    import TaskNotesKit

    internal enum FacetMobileTab: Hashable {
        case today
        case inbox
        case upcoming
        case browse
        case settings
    }

    internal struct FacetMobileWorkspace: View {
        @Bindable var store: FacetStore
        let onPresentModal: (FacetPresentedEntityModal) -> Void

        @State private var selectedTab: FacetMobileTab = .today
        @State private var inspectedTask: Task?

        var body: some View {
            ZStack(alignment: .bottomTrailing) {
                TabView(selection: $selectedTab) {
                    mobileTaskStack(for: .section(.today))
                        .tabItem {
                            Label("Today", systemImage: "star.fill")
                        }
                        .tag(FacetMobileTab.today)

                    mobileTaskStack(for: .section(.inbox))
                        .tabItem {
                            Label("Inbox", systemImage: "tray.fill")
                        }
                        .tag(FacetMobileTab.inbox)

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

                    NavigationStack {
                        FacetSettingsAndOnboardingView(store: store, embeddedInTab: true)
                    }
                    .tabItem {
                        Label("Settings", systemImage: "gearshape.fill")
                    }
                    .tag(FacetMobileTab.settings)
                }

                if selectedTab != .settings {
                    Button {
                        store.showsCapture = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.title2.weight(.semibold))
                            .foregroundStyle(.white)
                            .frame(
                                width: FacetNativeStyle.mobileCaptureDiameter,
                                height: FacetNativeStyle.mobileCaptureDiameter
                            )
                            .background(FacetNativeStyle.brand, in: .circle)
                            .shadow(radius: 8, y: 4)
                    }
                    .padding(.trailing, FacetNativeStyle.mobileCapturePadding)
                    .padding(.bottom, 68)
                    .accessibilityLabel("Quick Add Task")
                    .accessibilityIdentifier(AccessibilityIdentifier.TaskList.newTask)
                }
            }
            .onChange(of: selectedTab) {
                switch selectedTab {
                case .today:
                    store.destination = .section(.today)
                case .inbox:
                    store.destination = .section(.inbox)
                case .upcoming:
                    store.destination = .section(.upcoming)
                case .browse, .settings:
                    break
                }
            }
            .onChange(of: store.destination) {
                switch store.destination {
                case .section(.today):
                    selectedTab = .today
                case .section(.inbox):
                    selectedTab = .inbox
                case .section(.upcoming):
                    selectedTab = .upcoming
                case .section(.completed), .board, .project, .label, .filter:
                    selectedTab = .browse
                }
            }
            .sheet(item: $inspectedTask) { selected in
                if let latest = store.task(for: selected.id) {
                    NavigationStack {
                        FacetTaskInspectorView(
                            task: latest,
                            store: store,
                            onClose: { inspectedTask = nil }
                        )
                        .navigationTitle("Task")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done") { inspectedTask = nil }
                            }
                        }
                    }
                }
            }
        }

        private func mobileTaskStack(for target: FacetDestination) -> some View {
            NavigationStack {
                FacetTaskListView(
                    store: store,
                    onSelectTask: { task in
                        store.selectedTaskId = task.id
                        inspectedTask = task
                    },
                    onPresentModal: onPresentModal
                )
                .searchable(text: $store.searchQuery, prompt: "Search tasks")
                .refreshable {
                    await store.syncNow()
                }
                .onAppear {
                    store.destination = target
                }
            }
        }

        private var mobileBrowseTab: some View {
            NavigationStack {
                List {
                    SwiftUI.Section("Views") {
                        NavigationLink {
                            browseDestinationPage(.board, title: "Priority Board")
                        } label: {
                            Label("Priority Board", systemImage: "rectangle.split.3x1")
                        }

                        NavigationLink {
                            browseDestinationPage(.section(.completed), title: "Completed")
                        } label: {
                            Label("Completed", systemImage: "checkmark.circle")
                        }
                    }

                    SwiftUI.Section {
                        ForEach(store.userProjects) { proj in
                            NavigationLink {
                                browseDestinationPage(.project(id: proj.id), title: proj.name)
                            } label: {
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
                        }
                    } header: {
                        HStack {
                            Text("Projects")
                            Spacer()
                            Button {
                                onPresentModal(.addProject)
                            } label: {
                                Image(systemName: "plus")
                            }
                        }
                    }

                    SwiftUI.Section {
                        ForEach(store.activeLabels) { item in
                            NavigationLink {
                                browseDestinationPage(.label(id: item.id), title: "@\(item.name)")
                            } label: {
                                Label("@\(item.name)", systemImage: "tag")
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
                        }
                    }

                    SwiftUI.Section {
                        ForEach(store.activeFilters) { filterItem in
                            NavigationLink {
                                browseDestinationPage(
                                    .filter(id: filterItem.id),
                                    title: filterItem.name
                                )
                            } label: {
                                Label(
                                    filterItem.name,
                                    systemImage: "line.3.horizontal.decrease.circle"
                                )
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
                        }
                    }
                }
                .navigationTitle("Browse")
                .refreshable {
                    await store.syncNow()
                }
            }
        }

        private func browseDestinationPage(
            _ target: FacetDestination,
            title: String
        ) -> some View {
            FacetTaskListView(
                store: store,
                onSelectTask: { task in
                    store.selectedTaskId = task.id
                    inspectedTask = task
                },
                onPresentModal: onPresentModal
            )
            .navigationTitle(title)
            .onAppear {
                store.destination = target
            }
        }
    }
#endif
