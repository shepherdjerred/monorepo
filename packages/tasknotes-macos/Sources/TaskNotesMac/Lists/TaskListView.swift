internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

internal import struct Foundation.Date
internal import struct Foundation.DateComponents

/// A list screen. One view for Today, Inbox, Upcoming and Browse.
///
/// ## What was translated, and what was deleted
///
/// The React Native screens' *capabilities* are all here — each screen's own
/// membership rule, a heading with a count, the "all clear" celebration that
/// only appears after an interaction, completion, deletion, scheduling,
/// priority, bulk actions, filtering, sorting, search, refresh, create. Their
/// *interactions* are not: swipes, a floating action button, pull-to-refresh, a
/// bottom sheet, an explicit selection mode, a bulk action bar and a pushed
/// search screen are all touch scaffolding, and each has a desktop idiom that
/// already exists and is better.
///
/// The one that changes the shape of the screen most is **multi-select**. The
/// touch app needs a mode — tap to open, or tap to select, never both — so it
/// has an "enter selection" button and a bar of bulk actions at the bottom. A
/// `List` with a `Set` selection has ⌘-click and ⇧-click natively, needs no
/// mode at all, and `contextMenu(forSelectionType:)` then applies the *same*
/// menu to one row or to fifty. So the bulk action bar is not ported, it is
/// deleted, and nothing is lost.
///
/// ## One view, four configurations
///
/// The four screens are near-identical in the React Native app — the filter
/// bar, the list, the FAB and the bulk bar are copied three times, differing in
/// a predicate and two strings. Copying `TodayView` three times would have made
/// every subsequent row change a four-file edit, and the row is the part of this
/// app most likely to change. Everything that genuinely varies lives in
/// ``SidebarSection``'s list extensions and in ``TaskListModel``; nothing in
/// this file branches on which screen it is.
///
/// ## Scrolling is `List`'s, on purpose
///
/// Momentum, rubber-banding, Page Up/Down, Home/End, live scroll bars, and the
/// selection de-emphasis when the list loses focus all come from `NSTableView`
/// underneath. A hand-rolled `ScrollView` of rows loses every one of them
/// silently, which is why this is a `List` even though the row content is
/// custom.
struct TaskListView: View {
    /// Which screen this is. Everything screen-specific is reached through it.
    let section: SidebarSection

    /// A narrowing applied above everything else, or `nil` for the whole
    /// screen.
    ///
    /// This is what makes a project, context, tag or saved-view screen a
    /// *configuration* of this view rather than another copy of it: those
    /// screens are Browse over a smaller corpus with a different name on top.
    /// `TaskListModel` applies it before membership, so the count, the facets
    /// and the empty state all describe the slice rather than the vault.
    let scope: TaskListScope?

    let store: TaskNotesStore

    /// The viewer's day and offset, held rather than re-read per redraw so the
    /// heading, the buckets, and every completion target describe one instant.
    @State private var calendar: ViewerCalendar

    /// What the user has typed, filtered to, and ordered by.
    @State private var query: TaskListQuery

    @State private var selection: Set<TaskId>
    @State private var composeText = ""
    @State private var isComposing = false
    @State private var isRefreshing = false

    /// Whether anything has been completed on this screen in this session.
    ///
    /// The whole point of the "all clear" celebration is that it distinguishes
    /// *you cleared this* from *there was never anything here*, and only this
    /// flag can tell those apart.
    @State private var hasInteracted = false

    @FocusState private var isComposeFocused: Bool
    @FocusState private var isSearchFocused: Bool

    /// A screen over a store.
    ///
    /// ⚠️ The caller must give this view an `.id(section)`. `@State` survives a
    /// change of a view's stored properties, so without one, switching from
    /// Today to Inbox would carry Today's selection, search text and sort
    /// across — three pieces of state that mean nothing on the new screen.
    /// - Parameters:
    ///   - section: which screen this is.
    ///   - store: the app's task state.
    ///   - query: where the screen starts narrowed, which the app never
    ///     supplies and a snapshot always does. A rendered image of a list
    ///     narrowed to nothing is one of the states most worth reviewing and
    ///     the only one that cannot be reached by seeding data.
    ///   - scope: a narrowing above everything else — a project, context, tag
    ///     or saved view — or `nil` for the unscoped screen.
    ///   - reveal: a task to open the screen with already selected, which is
    ///     what a `tasknotes://task/…` link resolves to. Seeded into the
    ///     selection rather than applied afterwards, because the selection is
    ///     what publishes the `InspectorSubject` — a later assignment would
    ///     show the list for one frame with the panel still empty. The caller's
    ///     `.id(destination.identity)` carries the task, so a second link
    ///     rebuilds this view and re-seeds rather than being ignored as
    ///     unchanged state.
    init(
        section: SidebarSection,
        store: TaskNotesStore,
        query: TaskListQuery? = nil,
        scope: TaskListScope? = nil,
        reveal: TaskId? = nil
    ) {
        self.section = section
        self.store = store
        self.scope = scope
        _calendar = State(initialValue: store.viewerCalendar())
        _query = State(initialValue: query ?? TaskListQuery(section: section))
        _selection = State(initialValue: reveal.map { [$0] } ?? [])
    }

    var body: some View {
        content
            .navigationTitle(scope?.title ?? section.title)
            .navigationSubtitle(subtitle)
            .toolbar { toolbar }
            .focusedSceneValue(\.taskListActions, actions)
            .focusedSceneValue(\.inspectorSubject, inspected)
            .task(id: calendar.today) { await rollOverAtMidnight() }
            // ⚠️ `.contain`, and the choice is load-bearing. This pane holds a
            // banner, a heading, a list of rows and their per-row controls;
            // `.combine` would flatten every one of them into a single element
            // and take their actions with it. `.contain` makes the pane an
            // accessibility *container*: the identifier lands here — where a UI
            // test looks for it — and everything inside keeps its own
            // identifier and its own actions.
            //
            // Without the modifier the identifier is not on this pane at all:
            // SwiftUI pushes it down onto the descendants, where it **replaces**
            // the identifiers they were given. That is how the task list, the
            // heading, the count and the sync banner all came to answer to
            // `…detail.<section>` and none of them to their own names.
            .accessibilityElement(children: .contain)
            .accessibilityLabel(scope?.title ?? section.title)
            // The scope's identity when there is one, so every project screen
            // is not `…detail.browse`. A scope's identity is by construction
            // its destination's, so this and `sidebarItem` name the same thing.
            .accessibilityIdentifier(
                AccessibilityIdentifier.detail(identity: scope?.identity ?? section.rawValue))
    }

    @ViewBuilder
    private var content: some View {
        switch derived {
        case .success(let model):
            VStack(spacing: 0) {
                if let message = SyncMessage.of(
                    status: store.status,
                    pendingCount: store.pendingCount,
                    storeError: store.lastStoreError,
                    credentialError: store.credentialError,
                    parkedCount: store.deadLetters.count
                ) {
                    SyncBannerView(message: message, onRetry: refresh)
                    Divider()
                }
                TaskListHeader(model: model)
                Divider()
                if isComposing {
                    TaskComposeRow(
                        text: $composeText,
                        focus: $isComposeFocused,
                        onSubmit: create,
                        onCancel: cancelCompose
                    )
                    Divider()
                }
                if model.isEmpty {
                    TaskListEmptyState(
                        section: section,
                        scope: scope,
                        isNarrowed: model.isNarrowed,
                        hasInteracted: hasInteracted,
                        onNewTask: beginCompose,
                        onClearFilters: { query.clearNarrowing() }
                    )
                } else {
                    rows(model)
                }
            }
        case .failure(let error):
            // A derivation failure means the core rejected the vault's own
            // data. That is not a banner — nothing below it would be
            // trustworthy — so the screen says so instead of rendering a
            // plausible subset.
            ContentUnavailableView {
                Label("This list cannot be shown", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error.userMessage)
            }
            // `.combine`: a headline and a sentence, no control to swallow.
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(AccessibilityIdentifier.TaskList.empty)
        }
    }

    // ── Pieces ─────────────────────────────────────────────────────────────

    /// The list, in one shape whether or not the screen groups.
    ///
    /// A `Section` with a header is only emitted when there is a heading to
    /// put in it: an `EmptyView` header still reserves the inset style's header
    /// metrics, so an ungrouped list would carry a band of empty space above
    /// every one of its rows.
    private func rows(_ model: TaskListModel) -> some View {
        List(selection: $selection) {
            ForEach(model.groups) { group in
                if let heading = group.heading {
                    Section {
                        rowViews(group)
                    } header: {
                        TaskListGroupHeader(heading: heading)
                    }
                } else {
                    rowViews(group)
                }
            }
        }
        .listStyle(.inset)
        .accessibilityIdentifier(AccessibilityIdentifier.TaskList.list)
        // The sidebar's `List` is named by `NavigationSplitView`; this one is
        // named by nobody, so without this it is an element with an identifier
        // and no description — which is what the audit reported.
        .accessibilityLabel("Tasks")
        // One menu that serves both a right-click on a single row and a
        // right-click inside a multi-selection. This is what replaces the
        // touch app's selection mode and bulk action bar outright — and it is
        // also where `onTaskEdit` and `onTaskSetPriority`, which are dead code
        // in the React Native app because nothing ever passes them, finally
        // reach a user.
        .contextMenu(forSelectionType: TaskId.self) { ids in
            TaskRowMenu(
                targets: model.rows.filter { ids.contains($0.id) },
                onNewTask: beginCompose,
                onToggle: { rows in for row in rows { toggle(row) } },
                onSchedule: { schedule(ids, to: $0) },
                onPriority: { setPriority(ids, to: $0) },
                onDelete: { delete(ids) }
            )
        }
        // Space completes, matching the brief. `NSTableView` leaves it unbound
        // and SwiftUI's `List` implements no type-select on macOS, so nothing
        // is being taken away from the user here.
        .onKeyPress(.space) {
            guard !selection.isEmpty else { return .ignored }
            completeSelection(in: model)
            return .handled
        }
    }

    /// One group's rows.
    ///
    /// The group is passed rather than its rows, because whether a row prints
    /// its date depends on what the heading above it already says: under
    /// "Tomorrow", every row's date *is* the word "Tomorrow", and repeating it
    /// down the column buries the dates that do carry information — a "Friday"
    /// under "This Week". The comparison lives here because only the list knows
    /// its own headings.
    private func rowViews(_ group: TaskListGroup) -> some View {
        ForEach(group.rows) { row in
            TaskRowView(
                row: row,
                onToggle: { toggle(row) },
                onDelete: { delete([row.id]) },
                onSchedule: { schedule([row.id], to: $0) },
                onScheduleDate: { scheduleDate([row.id], to: $0) },
                showsDate: row.displayDate?.text != group.heading,
                // The screen's own scope, so a project screen stops printing
                // the project's name on every one of its rows.
                omitting: scope?.baseFilter
            )
            .tag(row.id)
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button("New Task", systemImage: "plus") { beginCompose() }
                .help("New Task (⌘N)")
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.newTask)
        }
        ToolbarItem(placement: .primaryAction) {
            Button("Refresh", systemImage: "arrow.clockwise") { refresh() }
                .help("Refresh (⌘R)")
                .disabled(isRefreshing)
                // The spinner state the touch app got from pull-to-refresh,
                // kept rather than dropped: the gesture is gone, the feedback
                // that work is happening is not.
                .symbolEffect(.rotate, options: .repeating, isActive: isRefreshing)
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.refresh)
        }
        ToolbarItem(placement: .primaryAction) {
            FilterMenu(query: $query, facets: facets)
        }
        ToolbarItem(placement: .primaryAction) {
            SortMenu(query: $query)
        }
        ToolbarItem(placement: .primaryAction) {
            SearchField(text: $query.search, prompt: "Search")
                .frame(width: 180)
                .focused($isSearchFocused)
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.search)
                .accessibilityLabel("Search this list")
        }
    }

    // ── Derivation ─────────────────────────────────────────────────────────

    private var derived: Result<TaskListModel, CoreError> {
        TaskListModel.of(
            section: section,
            tasks: store.tasks,
            pendingTaskIds: store.pendingTaskIds,
            calendar: calendar,
            query: query,
            scope: scope
        )
    }

    /// What the filter menu offers.
    ///
    /// Read from the derivation rather than recomputed: an empty list because
    /// of a filter must still offer the filter values that would bring it back,
    /// and both come from the same pass.
    private var facets: TaskListFacets {
        switch derived {
        case .success(let model): return model.facets
        // Nothing to offer over data the core would not accept. The screen is
        // already showing the failure; a populated menu next to it would be
        // asserting the list is fine.
        case .failure: return .empty
        }
    }

    /// The selection, as the inspector reads it.
    private var inspected: InspectorSubject {
        guard case .success(let model) = derived else { return InspectorSubject(rows: []) }
        return InspectorSubject(rows: model.rows.filter { selection.contains($0.id) })
    }

    private var subtitle: String {
        store.pendingCount == 0 ? "TaskNotes" : "\(store.pendingCount) waiting to sync"
    }
}

// Everything a list screen *does*, in an extension rather than in the body
// above.
//
// Not an arbitrary cut: the type had outgrown the linter's body limit, and the
// limit was pointing at something real. What is above is a description of a
// screen; everything below is a dispatch into the store and none of it renders
// anything. Same file, because these are `private` to the screen and that is
// the right visibility for them — an extension in a second file would have had
// to widen every piece of the screen's state to internal just to be written.
extension TaskListView {
    // ── Actions ────────────────────────────────────────────────────────────

    private var actions: TaskListActions {
        TaskListActions(
            newTask: beginCompose,
            refresh: refresh,
            complete: { if case .success(let model) = derived { completeSelection(in: model) } },
            delete: { delete(selection) },
            find: { isSearchFocused = true },
            clearFilters: { query.clearNarrowing() },
            hasSelection: !selection.isEmpty,
            isRefreshing: isRefreshing,
            isNarrowed: query.isNarrowing,
            // Available on every screen, scoped or not: the scope's filters and
            // the reader's are conjoined by the core rather than merged, so
            // "Website narrowed to Admin" keeps its **and**.
            saveableView: SavedViewDraft(scope: scope, query: query)
        )
    }

    private func beginCompose() {
        isComposing = true
        isComposeFocused = true
    }

    private func cancelCompose() {
        composeText = ""
        isComposing = false
        isComposeFocused = false
    }

    /// Create the composed task, and clear the field only if it was recorded.
    ///
    /// ⚠️ **The typed line survives a refused enqueue.** `dispatch` answers
    /// `nil` when the core could not write the command — a full or momentarily
    /// unwritable queue file — and clearing on that outcome destroys what
    /// somebody typed, with only the sync banner to say why. The line stays in
    /// the field instead, retryable and copyable, exactly as the quick-add
    /// panel keeps it.
    private func create() {
        switch QuickAdd.parsing(composeText, calendar: calendar) {
        case .success(let command):
            guard let command else {
                cancelCompose()
                return
            }
            _Concurrency.Task {
                guard await store.dispatch(command) != nil else { return }
                composeText = ""
                // Focus is kept rather than dismissed: adding three tasks in a
                // row is the common case, and a field that closes after each
                // one turns that into three ⌘N presses.
                isComposeFocused = true
                await store.settle()
            }
        case .failure(let error):
            store.report(error)
        }
    }

    private func toggle(_ row: TaskRowState) {
        hasInteracted = true
        _Concurrency.Task {
            await store.dispatchAnimated(row.completionCommand)
            await store.settle()
        }
    }

    private func completeSelection(in model: TaskListModel) {
        for row in model.rows where selection.contains(row.id) {
            toggle(row)
        }
    }

    private func delete(_ ids: Set<TaskId>) {
        selection.subtract(ids)
        _Concurrency.Task {
            for id in ids {
                await store.dispatchAnimated(.delete(taskId: id))
            }
            await store.settle()
        }
    }

    private func schedule(_ ids: Set<TaskId>, to choice: ScheduleChoice) {
        switch choice.resolving(on: calendar) {
        case .success(let date): scheduleDate(ids, to: date)
        case .failure(let error): store.report(error)
        }
    }

    private func scheduleDate(_ ids: Set<TaskId>, to date: String?) {
        _Concurrency.Task {
            for id in ids {
                await store.dispatch(.update(taskId: id, payload: .settingDue(date)))
            }
            await store.settle()
        }
    }

    private func setPriority(_ ids: Set<TaskId>, to priority: Priority) {
        _Concurrency.Task {
            for id in ids {
                await store.dispatch(.update(taskId: id, payload: .settingPriority(priority)))
            }
            await store.settle()
        }
    }

    private func refresh() {
        guard !isRefreshing else { return }
        isRefreshing = true
        _Concurrency.Task {
            await store.sync()
            calendar = store.viewerCalendar()
            isRefreshing = false
        }
    }

    /// Re-read the viewer's day shortly after the next local midnight.
    ///
    /// Without this, a window left open overnight keeps showing yesterday —
    /// the heading, the overdue colouring, the day groups, and every completion
    /// target all stay on the previous day, and nothing on screen suggests they
    /// are stale. The `.task(id:)` re-arms because its identity is the day it
    /// is waiting past.
    private func rollOverAtMidnight() async {
        guard let midnight = Self.nextMidnight() else { return }
        let seconds = midnight.timeIntervalSinceNow + 1
        guard seconds > 0 else { return }
        switch await Result(catching: {
            try await _Concurrency.Task.sleep(for: .seconds(seconds))
        }) {
        case .success: calendar = store.viewerCalendar()
        // Cancelled, because the view went away. Nothing to do and nothing to
        // report — this is the one place a discarded error is the whole design.
        case .failure: return
        }
    }

    private static func nextMidnight() -> Date? {
        Foundation.Calendar.autoupdatingCurrent.nextDate(
            after: Date(),
            matching: DateComponents(hour: 0, minute: 0, second: 0),
            matchingPolicy: .nextTime
        )
    }
}
