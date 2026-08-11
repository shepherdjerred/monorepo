public import TaskNotesUniFFI

/// The task list, laid out as columns of status.
///
/// ## What this is a port of, and what it is not
///
/// The React Native `JobSearchKanbanScreen` is a board over one hard-coded
/// project (`[[2026 Job Search]]`) with three hard-coded columns
/// (`Identified`, `Applied`, `Screener`) whose membership is read from an
/// `extraFields["company_status"]` string, falling back to a three-entry tag
/// table, falling back to "put it in the first column". Moving a card rewrites
/// the task's **tags**.
///
/// None of that survives contact with a shared core, and it should not:
///
///   * The columns are `task_status_all()` — the core's closed six-variant
///     enum — titled with `task_status_label`. So the vocabulary is the one the
///     vault, the filter menu, the inspector and the second client already use,
///     rather than three strings one screen invented.
///   * **Every task lands in exactly one column, by construction.** The
///     three-way fallback in the React Native version exists because its column
///     key is a free-text field that might say anything; a closed enum cannot,
///     so there is no default column and no task can be silently filed under a
///     heading that does not describe it.
///   * A move dispatches `CommandInput.setStatus`, which is the same command
///     the row checkbox and the inspector's status picker issue. Writing tags
///     to express status would have made the board's idea of "where a task is"
///     invisible to every other screen in the app.
///
/// What is kept is the thing the board is *for*: one project's work, in
/// columns. That arrives as a ``TaskListScope`` — so "the board for Job Search"
/// is the saved view's own scope, and "the board for this tag" is free.
///
/// ## The pipeline is the list's, entirely
///
/// Membership, scope narrowing, search, filter, sort, row derivation and facets
/// all come from ``TaskListModel`` — literally, by calling it. This type
/// partitions the rows it produced and does nothing else. That is deliberate:
/// a board that computed its own membership would be a second answer to
/// "which tasks am I looking at", visibly disagreeing with the list screen one
/// click away.
public struct KanbanBoard: Sendable, Equatable {
    /// One column per status, in the core's own order.
    public let columns: [KanbanColumn]

    /// The heading above the board.
    public let heading: String

    /// The calendar every row below was derived against.
    public let calendar: ViewerCalendar

    /// The query the cards were narrowed by.
    public let query: TaskListQuery

    /// What the filter menu can offer, over the board's own corpus.
    public let facets: TaskListFacets

    /// What narrowed the corpus before the reader's query, if anything.
    public let scope: TaskListScope?

    /// How many tasks the board admitted before searching and filtering.
    public let admittedCount: Int

    /// Every card, in column order then row order.
    public var cards: [TaskRowState] { columns.flatMap(\.rows) }

    public var cardCount: Int { columns.reduce(0) { $0 + $1.rows.count } }

    public var isEmpty: Bool { cardCount == 0 }

    /// Whether anything was narrowed away — the only reason an empty board
    /// might not be an empty vault.
    public var isNarrowed: Bool { query.isNarrowing }

    /// `No tasks` / `1 task` / `7 tasks`, the same words the list screens use.
    public var countLabel: String {
        switch cardCount {
        case 0: "No tasks"
        case 1: "1 task"
        case let count: "\(count) tasks"
        }
    }

    /// Derive a board from a snapshot.
    ///
    /// - Parameters:
    ///   - tasks: `TaskNotesStore.tasks`, in the core's order.
    ///   - pendingTaskIds: `TaskNotesStore.pendingTaskIds`.
    ///   - calendar: where and when the viewer is.
    ///   - query: the search, filter and sort the reader has applied.
    ///   - text: the locale formatter; injected so a test can pin a locale.
    ///   - scope: what the board is a board *of*, or `nil` for the whole vault.
    /// - Returns: the board, one column per status, each holding the cards that
    ///   survived the scope, the search, the filter and the sort.
    /// - Throws: `CoreError` when the core rejects the viewer's calendar or one
    ///   of the tasks' own stored values.
    public static func build(
        tasks: [CoreTask],
        pendingTaskIds: [TaskId],
        calendar: ViewerCalendar,
        query: TaskListQuery = TaskListQuery(),
        text: TaskDateText = TaskDateText(),
        scope: TaskListScope? = nil
    ) throws(CoreError) -> KanbanBoard {
        // `.browse` and not `.today`: a board whose Done and Cancelled columns
        // could never be populated would be six columns pretending to be four,
        // and the whole point of dragging a card rightwards is that it can
        // reach them. Browse is the one section that admits a finished task.
        let list = try TaskListModel.build(
            section: .browse,
            tasks: tasks,
            pendingTaskIds: pendingTaskIds,
            calendar: calendar,
            query: query,
            text: text,
            scope: scope
        )

        // One pass per column rather than one bucketing pass over the rows.
        // There are six statuses and a screen's worth of rows, so the constant
        // factor is irrelevant — and this way the *only* thing that decides a
        // column's membership is an equality against the status the column
        // already carries, with no intermediate key and nothing to keep in step
        // with `id`.
        //
        // Row order inside a column is the order the list produced, which is
        // the reader's sort.
        let partitioned = taskStatusAll().map { status in
            KanbanColumn(
                status: status,
                title: taskStatusLabel(status: status),
                rows: list.rows.filter { $0.task.status == status }
            )
        }

        return KanbanBoard(
            columns: partitioned,
            heading: scope?.title ?? "Board",
            calendar: calendar,
            query: query,
            facets: list.facets,
            scope: scope,
            admittedCount: list.admittedCount
        )
    }

    /// ``build(tasks:pendingTaskIds:calendar:query:text:scope:)``, as a
    /// `Result`.
    ///
    /// A SwiftUI `body` cannot `try`, for the reason ``TaskListModel`` spells
    /// out at length on its own `of` — a closure written inside a `@MainActor`
    /// view infers `any Error` as its thrown type, which no longer converts to
    /// a `throws(CoreError)` parameter.
    public static func of(
        tasks: [CoreTask],
        pendingTaskIds: [TaskId],
        calendar: ViewerCalendar,
        query: TaskListQuery = TaskListQuery(),
        text: TaskDateText = TaskDateText(),
        scope: TaskListScope? = nil
    ) -> Result<KanbanBoard, CoreError> {
        CoreErrors.capturing { () throws(CoreError) -> KanbanBoard in
            try build(
                tasks: tasks,
                pendingTaskIds: pendingTaskIds,
                calendar: calendar,
                query: query,
                text: text,
                scope: scope
            )
        }
    }

    // ── Moving a card ──────────────────────────────────────────────────────

    /// The card with this id, wherever it is.
    public func card(_ id: TaskId) -> TaskRowState? {
        for column in columns {
            if let row = column.rows.first(where: { $0.id == id }) { return row }
        }
        return nil
    }

    /// The column a card is currently in.
    public func column(holding id: TaskId) -> KanbanColumn? {
        columns.first { column in column.rows.contains { $0.id == id } }
    }

    /// The columns a card could be moved to — every column but its own.
    ///
    /// This is `getMoveTargets` from the React Native card, and it exists for
    /// the same reason: a "Move to…" menu offering the column the card is
    /// already in is a menu item that does nothing.
    ///
    /// It is also the **keyboard and VoiceOver route to the whole feature**.
    /// Dragging is a pointer gesture and nothing else; every move a drag can
    /// make must be reachable from this list, through the card's context menu
    /// and through the menu bar.
    public func moveTargets(for id: TaskId) -> [KanbanColumn] {
        guard let current = column(holding: id) else { return [] }
        return columns.filter { $0.status != current.status }
    }

    /// The column one step along from the one holding `id`.
    ///
    /// What `⌃⌘→` and `⌃⌘←` move a card to. Deliberately **not** wrapping:
    /// a card in the last column pressed rightwards should stay put, because a
    /// wrap would silently turn "advance this" into "send it back to the
    /// beginning" at exactly the moment a reader stops looking.
    public func column(_ direction: KanbanDirection, of id: TaskId) -> KanbanColumn? {
        guard let current = column(holding: id),
            let index = columns.firstIndex(where: { $0.status == current.status })
        else { return nil }
        let next = direction.step(from: index)
        guard columns.indices.contains(next) else { return nil }
        return columns[next]
    }

    /// The command that moves a card into `status`, or `nil` when it is already
    /// there.
    ///
    /// `nil` is the honest answer for a no-op, and it is what a drop handler
    /// returns `false` for — which is how the system draws the "not accepted"
    /// snap-back rather than pretending an edit happened.
    public func moveCommand(_ id: TaskId, to status: TaskStatus) -> CommandInput? {
        guard let row = card(id), row.task.status != status else { return nil }
        return .setStatus(taskId: id, status: status)
    }
}

/// Which way a keyboard move goes.
public enum KanbanDirection: Sendable, Equatable, Hashable {
    case previous
    case next

    func step(from index: Int) -> Int {
        switch self {
        case .previous: index - 1
        case .next: index + 1
        }
    }

    /// What the menu item says.
    public var title: String {
        switch self {
        case .previous: "Move Left"
        case .next: "Move Right"
        }
    }
}

/// One status, and the cards currently in it.
public struct KanbanColumn: Sendable, Equatable, Identifiable {
    /// The status this column *is*. Moving a card here sets exactly this.
    public let status: TaskStatus

    /// The heading, from `task_status_label` — the core's word, not a local one.
    public let title: String

    /// The cards, in the order the list's sort produced them.
    public let rows: [TaskRowState]

    /// The core's own stable name for the status.
    ///
    /// Used as the SwiftUI identity, in accessibility identifiers, and as the
    /// bucket key while the board is built, so all three agree by construction.
    public var id: String { taskStatusWireValue(status: status) }

    public var count: Int { rows.count }

    public var isEmpty: Bool { rows.isEmpty }

    /// Whether this column is where finished work goes.
    ///
    /// The core's `task_status_is_active`, negated — not a list of "done-ish"
    /// statuses restated here. A column view uses it only to decide how loudly
    /// to draw a count.
    public var isTerminal: Bool { !taskStatusIsActive(status: status) }

    public init(status: TaskStatus, title: String, rows: [TaskRowState]) {
        self.status = status
        self.title = title
        self.rows = rows
    }
}
