internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

internal import struct Foundation.Date
internal import struct Foundation.DateComponents

/// The board screen.
///
/// The same store, the same query surface, the same row derivation and the same
/// commands as a list screen — laid out as columns of status instead of as one
/// column of rows. It is ``KanbanBoard`` on top and ``KanbanColumnView`` below,
/// and there is no membership rule anywhere in this file.
///
/// ## Scoped or not
///
/// A `nil` scope is the whole vault. A scope is a project, a context, a tag or
/// a saved view — which is how the React Native app's *"Job Search board"*
/// arrives without a job-search-shaped screen: it is the saved view's own
/// scope, handed to this.
struct KanbanBoardView: View {
    let store: TaskNotesStore

    /// What the board is a board *of*, or `nil` for everything.
    let scope: TaskListScope?

    /// The window's running count of search-focus requests — today,
    /// `tasknotes://search`. See ``TaskListView/searchFocusToken``; the board
    /// answers it identically, because it publishes the same `⌘F`.
    let searchFocusToken: Int

    /// The viewer's day and offset, held rather than re-read per redraw so the
    /// heading, the badges and every completion target describe one instant.
    @State private var calendar: ViewerCalendar

    @State private var query: TaskListQuery

    /// The selected card, board-wide. One value across six columns — see
    /// ``KanbanColumnView`` for why that is what makes the menu bar able to act
    /// on "the selected card" at all.
    @State private var selection: TaskId?

    @State private var composeText = ""
    @State private var isComposing = false
    @State private var isRefreshing = false

    @FocusState private var isComposeFocused: Bool
    @FocusState private var isSearchFocused: Bool

    /// A board over a store.
    ///
    /// - Parameters:
    ///   - store: the app's task state.
    ///   - scope: what the board is of, or `nil` for the vault.
    ///   - query: where the board starts narrowed. The app supplies a saved
    ///     view's seed; a snapshot supplies a state worth reviewing.
    ///   - searchFocusToken: the window's running count of search-focus
    ///     requests.
    init(
        store: TaskNotesStore,
        scope: TaskListScope? = nil,
        query: TaskListQuery? = nil,
        searchFocusToken: Int = 0
    ) {
        self.store = store
        self.scope = scope
        self.searchFocusToken = searchFocusToken
        _calendar = State(initialValue: store.viewerCalendar())
        // `.effectiveDate` and not `.dueDate`: cards are dominated by recurring
        // and scheduled-only work, and `dueDate` reads exactly one field — so a
        // scheduled task would sort as undated while its own badge printed
        // "Today". The core added the key for precisely this.
        _query = State(
            initialValue: query
                ?? TaskListQuery(sort: SortConfig(field: .effectiveDate, direction: .asc)))
    }

    var body: some View {
        content
            .navigationTitle(scope?.title ?? "Board")
            .navigationSubtitle(subtitle)
            .toolbar { toolbar }
            .focusedSceneValue(\.taskListActions, listActions)
            .focusedSceneValue(\.boardActions, boardActions)
            .focusedSceneValue(\.inspectorSubject, inspected)
            .task(id: calendar.today) { await rollOverAtMidnight() }
            // `tasknotes://search`, into the same field `⌘F` focuses.
            .onChange(of: searchFocusToken) { isSearchFocused = true }
            // ⚠️ `.contain`, for the same reason ``TaskListView``'s pane is:
            // this holds a banner, a heading and six columns of cards, each
            // with its own identifier and its own menu. `.combine` would
            // flatten the board into one element and destroy every one of them.
            .accessibilityElement(children: .contain)
            .accessibilityLabel(scope?.title ?? "Board")
            .accessibilityIdentifier(AccessibilityIdentifier.detail(destination))
    }

    @ViewBuilder
    private var content: some View {
        switch derived {
        case .success(let board):
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
                header(board)
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
                if board.isEmpty {
                    emptyState(board)
                } else {
                    columns(board)
                }
            }
        case .failure(let error):
            // A derivation failure means the core rejected the vault's own
            // data. Nothing below it would be trustworthy, so the screen says
            // so rather than drawing a plausible subset.
            ContentUnavailableView {
                Label("This board cannot be shown", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error.userMessage)
            }
            // `.combine`: a headline and a sentence, no control to swallow.
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(AccessibilityIdentifier.Board.empty)
        }
    }

    private func header(_ board: KanbanBoard) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(board.heading)
                .font(.title2.weight(.semibold))
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.heading)
            Spacer()
            Text(count(board))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.count)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    /// The count, and how much of the board it is counting.
    ///
    /// `6 of 34` on a narrowed board, for the same reason the list header says
    /// it: a bare `6 tasks` next to a filter is a true statement that reads as
    /// a false one.
    private func count(_ board: KanbanBoard) -> String {
        guard board.isNarrowed, board.admittedCount != board.cardCount else {
            return board.countLabel
        }
        return "\(board.cardCount) of \(board.admittedCount)"
    }

    private func columns(_ board: KanbanBoard) -> some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(board.columns) { column in
                    KanbanColumnView(
                        column: column,
                        board: board,
                        selection: $selection,
                        onToggle: toggle,
                        onMove: move,
                        onDelete: delete
                    )
                }
            }
            .padding(12)
            .frame(maxHeight: .infinity)
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Board.board)
    }

    /// A board with no cards at all.
    ///
    /// Six empty columns would be a truthful picture and a useless one — there
    /// is nothing to drag and nothing to drop — so this says which of the two
    /// empty readings it is, exactly as the list screens do.
    private func emptyState(_ board: KanbanBoard) -> some View {
        VStack {
            Spacer()
            ContentUnavailableView {
                Label(
                    board.isNarrowed ? "No matches" : (scope?.emptyTitle ?? "No tasks"),
                    systemImage: board.isNarrowed
                        ? "line.3.horizontal.decrease.circle"
                        : (scope?.systemImage ?? "rectangle.split.3x1")
                )
            } description: {
                Text(
                    board.isNarrowed
                        ? "No task on this board matches the current search and filter."
                        : (scope?.emptyDescription
                            ?? "Tasks appear here in columns, one per status."))
            } actions: {
                if board.isNarrowed {
                    Button("Clear Filters & Search") { query.clearNarrowing() }
                        .accessibilityIdentifier(AccessibilityIdentifier.Query.clearFilters)
                } else {
                    Button("New Task", action: beginCompose)
                }
            }
            Spacer()
        }
        // ⚠️ `.contain` rather than `.combine`: this empty state carries a
        // button — *Clear Filters & Search* or *New Task* — and combining would
        // fold the only remedy on the screen into a sentence nobody can press.
        .accessibilityElement(children: .contain)
        .accessibilityLabel(board.isNarrowed ? "No matches" : (scope?.emptyTitle ?? "No tasks"))
        .accessibilityIdentifier(AccessibilityIdentifier.Board.empty)
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
                .accessibilityLabel("Search this board")
        }
    }

    // ── Derivation ─────────────────────────────────────────────────────────

    private var derived: Result<KanbanBoard, CoreError> {
        KanbanBoard.of(
            tasks: store.tasks,
            pendingTaskIds: store.pendingTaskIds,
            calendar: calendar,
            query: query,
            scope: scope
        )
    }

    private var destination: TaskNotesDestination { .board }

    private var facets: TaskListFacets {
        switch derived {
        case .success(let board): return board.facets
        case .failure: return .empty
        }
    }

    /// The selection, as the inspector reads it.
    private var inspected: InspectorSubject {
        guard case .success(let board) = derived, let selection,
            let card = board.card(selection)
        else { return InspectorSubject(rows: []) }
        return InspectorSubject(rows: [card])
    }

    private var subtitle: String {
        store.pendingCount == 0 ? "Facet" : "\(store.pendingCount) waiting to sync"
    }
}

// Everything the board *does*. Split from the description above for the same
// reason `TaskListView`'s is: what is above draws a screen, and none of what is
// below draws anything.
extension KanbanBoardView {
    /// What the shared menu-bar commands act on when a board is frontmost.
    ///
    /// The board publishes the *same* surface a list screen does, so `⌘N`,
    /// `⌘R`, `⌘F`, `⌘.` and `⌘⌫` mean here exactly what they mean one
    /// destination away. A board that greyed those out would teach the reader
    /// that the commands belong to a screen rather than to the app.
    private var listActions: TaskListActions {
        TaskListActions(
            newTask: beginCompose,
            refresh: refresh,
            complete: completeSelection,
            delete: { if let selection { delete(selection) } },
            find: { isSearchFocused = true },
            clearFilters: { query.clearNarrowing() },
            hasSelection: selection != nil,
            isRefreshing: isRefreshing,
            isNarrowed: query.isNarrowing,
            saveableView: SavedViewDraft(scope: scope, query: query)
        )
    }

    /// The board-only commands: moving the selected card between columns.
    private var boardActions: BoardActions {
        BoardActions(
            canMove: { target(in: $0) != nil },
            move: { direction in
                guard let selection, let column = target(in: direction) else { return }
                move(selection, to: column.status)
            }
        )
    }

    /// The column one step along from the selected card's, if there is one.
    private func target(in direction: KanbanDirection) -> KanbanColumn? {
        guard case .success(let board) = derived, let selection else { return nil }
        return board.column(direction, of: selection)
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
    /// ⚠️ Same rule as the list composer and the quick-add panel: `dispatch`
    /// answers `nil` when the core could not write the command, and clearing on
    /// that outcome destroys the typed line.
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
                isComposeFocused = true
                await store.settle()
            }
        case .failure(let error):
            store.report(error)
        }
    }

    private func toggle(_ row: TaskRowState) {
        _Concurrency.Task {
            await store.dispatchAnimated(row.completionCommand)
            await store.settle()
        }
    }

    private func completeSelection() {
        guard case .success(let board) = derived, let selection,
            let card = board.card(selection)
        else { return }
        toggle(card)
    }

    /// Move a card into a column.
    ///
    /// ⚠️ **Through `store.dispatch`, like every other edit in this app.**
    /// A drop that mutated a local array would show the card in its new column
    /// and write nothing to the vault, and the discrepancy would survive until
    /// the next sync overwrote it. `moveCommand` returns `nil` for a move that
    /// is not a move, so nothing is dispatched for a drop onto a card's own
    /// column.
    private func move(_ id: TaskId, to status: TaskStatus) {
        guard case .success(let board) = derived,
            let command = board.moveCommand(id, to: status)
        else { return }
        _Concurrency.Task {
            await store.dispatchAnimated(command)
            await store.settle()
        }
    }

    private func delete(_ id: TaskId) {
        if selection == id { selection = nil }
        _Concurrency.Task {
            await store.dispatchAnimated(.delete(taskId: id))
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
    /// A board left open overnight would otherwise keep yesterday's date
    /// badges and — the part that corrupts rather than merely misinforms —
    /// yesterday's completion target on every recurring card, so clicking a
    /// daily task would uncomplete yesterday's occurrence. The `.task(id:)`
    /// re-arms because its identity is the day it is waiting past.
    private func rollOverAtMidnight() async {
        guard let midnight = Self.nextMidnight() else { return }
        let seconds = midnight.timeIntervalSinceNow + 1
        guard seconds > 0 else { return }
        do {
            try await _Concurrency.Task.sleep(for: .seconds(seconds))
        } catch is CancellationError {
            // Cancelled, because the view went away. Nothing to do and nothing to
            // report — this is the one place a discarded error is the whole design.
            return
        } catch {
            preconditionFailure("midnight timer failed unexpectedly: \(error)")
        }
        calendar = store.viewerCalendar()
    }

    private static func nextMidnight() -> Date? {
        Foundation.Calendar.autoupdatingCurrent.nextDate(
            after: Date(),
            matching: DateComponents(hour: 0, minute: 0, second: 0),
            matchingPolicy: .nextTime
        )
    }
}
