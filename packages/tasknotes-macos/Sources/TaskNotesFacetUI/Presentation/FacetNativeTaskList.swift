import SwiftUI
import TaskNotesKit

internal struct FacetNativeTaskList: View {
    let store: FacetStore
    @Bindable var window: FacetWindowState
    let snapshot: FacetSnapshot
    let selected: FacetTaskRowID?
    var admitNavigation: (@MainActor () async -> Bool)?
    var reservesCaptureSpace = false
    var showsAppliedFeedback = true
    let open: (FacetTask) -> Void
    @State private var admitted: Set<FacetTaskRowID> = []
    @State private var captureDraft = FacetCaptureDraft()
    @State private var deleting: FacetTask?
    @State private var bulkSelection: FacetReviewedSelection?
    @State private var savedViews = false
    @State private var scheduleTask: FacetTask?
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @Environment(\.facetFeedbackOrigin) private var feedbackOrigin

    var body: some View {
        Group {
            if window.board { board } else { list }
        }
        .confirmationDialog(
            "Delete this task note?",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })
        ) {
            Button("Delete task", role: .destructive) {
                guard let task = deleting else { return }
                deleting = nil
                action(task) {
                    _ = await store.perform(
                        [
                            "kind": .string("delete_checked"), "path": .string(task.path),
                            "expectedRevision": .string(task.revision),
                            "checkBacklinks": .bool(true), "force": .bool(false),
                        ], profileID: snapshot.profileId)
                }
            }
        }
        .toolbar {
            ToolbarItemGroup {
                #if os(macOS)
                    Button("Saved views", systemImage: "rectangle.stack") { savedViews = true }
                    Button("Undo", systemImage: "arrow.uturn.backward") {
                        _Concurrency.Task { await store.undoLast(profileID: snapshot.profileId) }
                    }
                #endif
                if desktop && window.selectedTaskIDs.count > 1 {
                    Button("Actions for \(window.selectedTaskIDs.count) tasks") {
                        bulkSelection = FacetReviewedSelection(
                            store: store, window: window, snapshot: snapshot)
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 0) {
                #if os(iOS)
                    if window.isSelecting {
                        FacetMobileSelectionBar(window: window) {
                            bulkSelection = FacetReviewedSelection(
                                store: store, window: window, snapshot: snapshot)
                        }
                    }
                #endif
                if showsAppliedFeedback {
                    FacetAppliedFeedbackView(store: store, profileID: snapshot.profileId)
                }
            }
        }
        .sheet(item: $bulkSelection) { selection in
            FacetBulkForm(
                store: store, profileID: selection.profileID,
                tasks: selection.tasks, priorities: pairs("priorities"),
                applied: { selection.clearIfCurrent(store: store, window: window) })
        }
        .sheet(isPresented: $savedViews) {
            FacetSavedViewsForm(
                store: store, profileID: snapshot.profileId, board: $window.board, window: window,
                admitNavigation: admitNavigation)
        }
        #if os(iOS)
            .sheet(item: $scheduleTask) { task in
                FacetScheduleSheet(
                    store: store, task: task, profileID: snapshot.profileId,
                    initialField: task.agendaDateKind == "deadline" ? .due : .scheduled,
                    applied: { _Concurrency.Task { await window.reload(store: store) } })
            }
        #endif
    }

    private var list: some View {
        List(selection: selection) {
            if snapshot.tasks.isEmpty {
                ContentUnavailableView(
                    window.search.isEmpty ? "You're all caught up" : "No matching tasks",
                    systemImage: window.search.isEmpty ? "checkmark.circle" : "magnifyingglass",
                    description: Text(
                        window.search.isEmpty
                            ? "Add a task when you're ready." : "Try another search or view."))
            }
            if snapshot.groups.isEmpty {
                taskRows(snapshot.tasks)
            } else {
                ForEach(Array(snapshot.groups.enumerated()), id: \.offset) { _, group in
                    Section {
                        taskRows(
                            FacetTaskGroupPresentation.tasks(
                                snapshot.tasks, in: group,
                                groupBy: window.displayedQuery?.object?.fields["groupBy"]?.text))
                    } header: {
                        Text(groupHeading(group.key)).accessibilityIdentifier(
                            "facet.group.\(group.key)")
                    }
                }
            }
            if snapshot.totalCount > UInt64(snapshot.tasks.count) {
                Button("Load more tasks") {
                    _Concurrency.Task { await window.loadMore(store: store) }
                }
                .disabled(window.isLoading)
            }
            #if os(macOS)
                composeRow
            #endif
            ForEach(Array(snapshot.problems.enumerated()), id: \.offset) { _, problem in
                Label(
                    "\(problem.path): \(problem.message)", systemImage: "exclamationmark.triangle"
                ).foregroundStyle(.orange)
            }
        }
        .refreshable {
            await store.refresh()
            await window.reload(store: store)
        }
        #if os(macOS)
            .listStyle(.inset)
        #else
            .listStyle(.plain)
            .contentMargins(
                .bottom,
                reservesCaptureSpace && !window.isSelecting
                    ? FacetNativeStyle.mobileListBottomMargin : 0,
                for: .scrollContent)
        #endif
    }

    @ViewBuilder private func taskRows(_ tasks: [FacetTask]) -> some View {
        ForEach(tasks, id: \.rowID) { task in
            row(task).tag(task.rowID)
                .swipeActions(edge: .trailing) {
                    if !window.isSelecting {
                        Button("Delete", role: .destructive) { deleting = task }.tint(.red)
                        Button("Schedule") { schedule(task) }.tint(.orange)
                    }
                }
                .swipeActions(edge: .leading) {
                    if !window.isSelecting {
                        Button(task.completed ? "Uncomplete" : "Complete") { toggle(task) }.tint(
                            .green)
                    }
                }
        }
    }

    private var selection: Binding<Set<FacetTaskRowID>> {
        Binding(
            get: { window.selectedTaskIDs },
            set: { ids in
                if !window.isSelecting, ids.count == 1, let id = ids.first,
                    let task = snapshot.tasks.first(where: { $0.rowID == id })
                {
                    open(task)
                } else {
                    window.selectedTaskIDs = ids
                }
            })
    }
    @ViewBuilder private func row(_ task: FacetTask, stacked: Bool = false) -> some View {
        switch Result(catching: {
            try FacetTaskPresentation(task: task, configuration: snapshot.configuration)
        }) {
        case .success(let presentation):
            presentedRow(task, presentation: presentation, stacked: stacked)
                .disabled(admitted.contains(task.rowID))
            if let diagnostic = presentation.priority.colorDiagnostic
                ?? presentation.status.colorDiagnostic
            {
                Label(diagnostic, systemImage: "exclamationmark.triangle").font(.caption)
                    .foregroundStyle(.orange)
            }
            ForEach(
                [
                    presentation.priority.configurationDiagnostic,
                    presentation.status.configurationDiagnostic,
                ].compactMap { $0 }, id: \.self
            ) { diagnostic in
                Label(diagnostic, systemImage: "exclamationmark.triangle").font(.caption)
                    .foregroundStyle(.secondary)
            }
        case .failure(let error):
            VStack(alignment: .leading) {
                Button(task.title) { open(task) }.buttonStyle(.plain)
                Label(error.localizedDescription, systemImage: "exclamationmark.triangle").font(
                    .caption)
            }
        }
    }

    private var board: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 16) {
                ForEach(statusChoices) { status in
                    let tasks = snapshot.tasks.filter { $0.status == status.value }
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Circle().fill(FacetNativeStyle.tint(status)).frame(width: 8, height: 8)
                            Text(status.label).font(.headline)
                            Spacer()
                            Text("\(tasks.count) loaded").font(.caption).foregroundStyle(.secondary)
                        }
                        ForEach(tasks, id: \.rowID) { task in
                            VStack(alignment: .leading, spacing: 8) {
                                row(task, stacked: true)
                                Menu("Move to…") {
                                    ForEach(statusChoices) { target in
                                        Button(target.label) {
                                            action(task) {
                                                await store.setStatus(
                                                    task, status: target.value,
                                                    profileID: snapshot.profileId)
                                            }
                                        }
                                    }
                                }.font(.caption)
                            }.padding(12)
                                .background(.background, in: RoundedRectangle(cornerRadius: 10))
                                .draggable(
                                    FacetBoardDragItem(
                                        profileID: snapshot.profileId, taskID: task.id,
                                        occurrenceDate: task.occurrenceDate, revision: task.revision
                                    ))
                        }
                    }.padding(12).frame(width: 280)
                        .background(
                            .quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 14)
                        )
                        .dropDestination(for: FacetBoardDragItem.self) { items, _ in
                            acceptDrop(items, status: status.value)
                        }
                }
            }.padding().frame(maxHeight: .infinity, alignment: .top)
        }
    }
}

extension FacetNativeTaskList {
    @ViewBuilder private func presentedRow(
        _ task: FacetTask, presentation: FacetTaskPresentation, stacked: Bool
    ) -> some View {
        #if os(iOS)
            if window.isSelecting {
                FacetMobileSelectionRow(
                    task: task, presentation: presentation,
                    selected: window.selectedTaskIDs.contains(task.rowID)
                ) {
                    if !window.selectedTaskIDs.insert(task.rowID).inserted {
                        window.selectedTaskIDs.remove(task.rowID)
                    }
                }
            } else {
                standardRow(task, presentation: presentation, stacked: stacked)
            }
        #else
            standardRow(task, presentation: presentation, stacked: stacked)
        #endif
    }

    private func standardRow(_ task: FacetTask, presentation: FacetTaskPresentation, stacked: Bool)
        -> some View
    {
        FacetTaskRow(
            task: task, presentation: presentation, desktop: desktop, stacked: stacked,
            completionReceipt: completionReceipt(for: task),
            viewerCalendar: store.clock.viewerCalendar(),
            complete: { toggle(task) }, open: { open(task) }, schedule: { schedule(task) },
            delete: { deleting = task }
        )
        .onTapGesture { open(task) }
    }

    private func groupHeading(_ key: String) -> String {
        #if os(iOS)
            let grouping = window.displayedQuery?.object?.fields["groupBy"]?.text
            if grouping == "effectiveDate" || grouping == "agendaSection" {
                let viewer = store.clock.viewerCalendar()
                return FacetMobileDateText.heading(
                    key, today: viewer.today, timeZone: viewer.timeZone)
            }
            return key.isEmpty ? "None" : key
        #else
            return key.isEmpty ? "No date" : key
        #endif
    }

    private func schedule(_ task: FacetTask) {
        #if os(iOS)
            scheduleTask = task
        #else
            open(task)
        #endif
    }
    private func acceptDrop(_ items: [FacetBoardDragItem], status: String) -> Bool {
        guard items.count == 1, let item = items.first, let task = item.task(in: snapshot),
            task.status != status, store.selectedProfileID == snapshot.profileId,
            let engine = store.engine, !admitted.contains(task.rowID)
        else { return false }
        action(task) {
            guard store.engine === engine, store.selectedProfileID == item.profileID else { return }
            await store.setStatus(task, status: status, profileID: item.profileID)
        }
        return true
    }

    private var composeRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: "plus").foregroundStyle(.secondary)
                TextField("Add a task…", text: $captureDraft.input).textFieldStyle(.plain).onSubmit
                { capture() }
                .accessibilityIdentifier("facet.inline-compose.title")
                if captureDraft.isSubmitting {
                    ProgressView().controlSize(.small)
                } else if !captureDraft.input.isEmpty {
                    Button("Add") { capture() }.keyboardShortcut(.return, modifiers: [])
                        .disabled(!captureDraft.canSubmit)
                }
            }
            if let error = captureDraft.error {
                Text(error).font(.caption).foregroundStyle(.red)
                Button("Discard draft") {
                    _Concurrency.Task { await captureDraft.discard(store: store) }
                }
                .font(.caption).disabled(captureDraft.isSubmitting)
            }
        }.padding(.vertical, 8)
    }
    private func capture() {
        guard
            captureDraft.begin(store: store, profileID: snapshot.profileId, origin: feedbackOrigin)
        else { return }
        _Concurrency.Task {
            await captureDraft.submit(store: store)
            await window.reload(store: store)
        }
    }
    private func toggle(_ task: FacetTask) {
        action(task) { await store.toggle(task, profileID: snapshot.profileId) }
    }
    private func action(_ task: FacetTask, operation: @escaping @MainActor () async -> Void) {
        guard admitted.insert(task.rowID).inserted else { return }
        let intent = store.feedbackIntent(origin: feedbackOrigin)
        _Concurrency.Task {
            await FacetFeedbackContext.$intent.withValue(intent) { await operation() }
            await window.reload(store: store)
            admitted.remove(task.rowID)
        }
    }
    private func completionReceipt(for task: FacetTask) -> String? {
        guard let event = store.appliedFeedback?.event, event.origin == feedbackOrigin,
            event.profileID == snapshot.profileId, event.path == task.path,
            event.occurrenceDate == task.occurrenceDate,
            event.action == .completed || event.action == .reopened
        else { return nil }
        return event.mutationID
    }
    private var statusChoices: [FacetConfiguredChoice] {
        do {
            return try FacetConfiguredChoice.choices(
                in: snapshot.configuration, key: "statuses", including: snapshot.tasks.map(\.status)
            )
        } catch { preconditionFailure("Invalid validated workflow configuration: \(error)") }
    }
    private func pairs(_ key: String) -> [(value: String, label: String)] {
        do {
            return try FacetConfiguredChoice.choices(in: snapshot.configuration, key: key).map {
                ($0.value, $0.label)
            }
        } catch { preconditionFailure("Invalid validated workflow configuration: \(error)") }
    }
    private var desktop: Bool {
        #if os(macOS)
            true
        #else
            false
        #endif
    }
}
