#if os(iOS)
    import SwiftUI
    import TaskNotesKit

    /// Task content leaves navigation-title ownership with its stack or destination.
    internal struct FacetMobileTaskScreen: View {
        let store: FacetStore
        let globalSearch: Bool
        let captureFallback: (() -> Void)?
        let goToToday: (() -> Void)?
        @State private var window: FacetWindowState
        @State private var detail: FacetTask?
        @State private var searchPresented = true
        @Environment(\.facetCaptureRequest) private var captureRequest
        @Environment(\.facetFeedbackOrigin) private var feedbackOrigin
        @Environment(\.accessibilityReduceMotion) private var reducedMotion

        init(
            store: FacetStore, scope: String,
            query: [String: FacetValue] = [:], savedView: FacetSavedView? = nil,
            globalSearch: Bool = false, captureFallback: (() -> Void)? = nil,
            goToToday: (() -> Void)? = nil, initialWindow: FacetWindowState? = nil
        ) {
            self.store = store
            self.globalSearch = globalSearch
            self.captureFallback = captureFallback
            self.goToToday = goToToday
            let state =
                initialWindow
                ?? FacetWindowState(
                    mobileScope: scope, clock: store.clock, query: query,
                    globalSearch: globalSearch,
                    savedView: savedView
                )
            if initialWindow == nil {
                state.board = scope == "board" || savedView?.view["viewType"] == .string("board")
            }
            state.mobilePresentation = true
            _window = State(initialValue: state)
        }

        var body: some View {
            VStack(spacing: 0) {
                if globalSearch {
                    searchableList
                } else {
                    taskContent
                }
            }
            .task(id: store.selectedProfileID) {
                window.selectedTaskIDs = []
                window.isSelecting = false
                await reload()
            }
            .onChange(of: store.snapshot?.version) { _Concurrency.Task { await reload() } }
            .onChange(of: store.appliedFeedback) { _Concurrency.Task { await reload() } }
            .onChange(of: window.search) { _Concurrency.Task { await reload() } }
            .onAppear {
                window.feedbackOrigin = feedbackOrigin
                window.reducedMotion = reducedMotion
            }
            .onChange(of: feedbackOrigin) { window.feedbackOrigin = feedbackOrigin }
            .onChange(of: reducedMotion) { window.reducedMotion = reducedMotion }
            .sheet(item: $detail) { task in
                if let snapshot = window.snapshot {
                    FacetTaskEditor(
                        store: store, task: task, profileID: snapshot.profileId,
                        statuses: choices(snapshot, key: "statuses"),
                        priorities: choices(snapshot, key: "priorities")
                    )
                    .presentationDetents([.fraction(0.75), .large])
                    .presentationDragIndicator(.visible)
                }
            }
        }

        private var searchableList: some View {
            VStack(spacing: 0) {
                if window.search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    ContentUnavailableView(
                        "Start typing to search", systemImage: "magnifyingglass",
                        description: Text("Search all tasks by title, project, context or tag."))
                } else {
                    taskContent
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Search results")
            .accessibilityIdentifier("facet.search.results")
            .searchable(
                text: $window.search, isPresented: $searchPresented, prompt: "Search all tasks"
            )
            .searchPresentationToolbarBehavior(.avoidHidingContent)
        }

        private var taskContent: some View {
            VStack(spacing: 0) {
                taskListRegion
                if let snapshot = window.snapshot {
                    FacetAppliedFeedbackView(store: store, profileID: snapshot.profileId)
                }
            }
        }

        private var taskListRegion: some View {
            VStack(spacing: 0) {
                if let error = window.error {
                    Label(error, systemImage: "exclamationmark.triangle").padding()
                        .accessibilityIdentifier("facet.query.error")
                }
                if let snapshot = window.snapshot {
                    FacetNativeTaskList(
                        store: store, window: window, snapshot: snapshot, selected: nil,
                        reservesCaptureSpace: !globalSearch, showsAppliedFeedback: false
                    ) {
                        detail = $0
                    }
                    .safeAreaInset(edge: .top, spacing: 0) {
                        if !globalSearch { listHeader(snapshot) }
                    }
                } else {
                    ProgressView("Opening view…").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if !globalSearch && !window.isSelecting {
                    Button(action: capture) {
                        Image(systemName: "plus").font(.title2.weight(.semibold))
                            .frame(
                                width: FacetNativeStyle.mobileCaptureDiameter,
                                height: FacetNativeStyle.mobileCaptureDiameter)
                    }
                    .buttonStyle(.borderedProminent).buttonBorderShape(.circle)
                    .accessibilityLabel("Add task").accessibilityIdentifier("facet.capture.open")
                    .disabled(store.selectedProfileID == nil)
                    .padding(FacetNativeStyle.mobileCapturePadding)
                }
            }
        }

        private func listHeader(_ snapshot: FacetSnapshot) -> some View {
            VStack(spacing: 0) {
                FacetMobileListControls(store: store, window: window, snapshot: snapshot)
                if window.scope == "upcoming" || window.scope == "upcomingAgenda" {
                    FacetMobileWeekStrip(store: store, window: window, goToToday: goToToday)
                }
                if window.scope == "today" || window.scope == "todayAgenda" { todayHeading }
            }
            .background(.background)
        }

        private var todayHeading: some View {
            let viewer = store.clock.viewerCalendar()
            let count = window.snapshot?.totalCount ?? 0
            return VStack(alignment: .leading, spacing: 4) {
                Text(
                    FacetMobileDateText.label(
                        viewer.instant, template: "EEEE MMMMd", timeZone: viewer.timeZone)
                )
                .font(.headline)
                Text(count == 1 ? "1 task" : "\(count) tasks")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(
                .vertical, 12
            )
            .accessibilityIdentifier("facet.today.heading")
        }

        private func capture() {
            guard let profileID = store.selectedProfileID else { return }
            var properties: [String: FacetValue] = [:]
            if window.scope == "today" || window.scope == "todayAgenda" {
                properties["scheduled"] = .string(store.clock.viewerCalendar().today)
            } else if let day = window.savedQuery["effectiveDay"]?.text {
                properties["scheduled"] = .string(day)
            }
            if let projects = window.savedQuery["projects"] { properties["projects"] = projects }
            if let captureRequest {
                captureRequest.present(profileID: profileID, properties: properties)
            } else {
                captureFallback?()
            }
        }

        private func reload() async {
            if globalSearch && window.search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            {
                return
            }
            await window.reload(store: store)
        }

        private func choices(_ snapshot: FacetSnapshot, key: String) -> [(
            value: String, label: String
        )] {
            do {
                return try FacetConfiguredChoice.choices(in: snapshot.configuration, key: key).map {
                    ($0.value, $0.label)
                }
            } catch { preconditionFailure("Invalid validated workflow configuration: \(error)") }
        }
    }
#endif
