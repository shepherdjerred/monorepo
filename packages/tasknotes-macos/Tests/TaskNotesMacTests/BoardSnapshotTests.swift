import AppKit
import Foundation
import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI
import Testing

@testable import TaskNotesMac

/// The board, the scoped screens, and the saved-view editor, rendered offscreen
/// for human review.
///
/// ## What these images can and cannot prove
///
/// They prove the board **lays out**: six columns of the right widths, headings
/// and counts, cards that wrap rather than truncate, an empty column that still
/// occupies its place, and a column with more cards than fit. They prove it in
/// both appearances, which matters more here than on a list screen because a
/// column is a *surface* — `.quinary` behind a card at `.background.secondary`
/// — and two stacked translucent fills are exactly the thing that reads fine in
/// one appearance and turns to mud in the other.
///
/// They **cannot** prove the interaction. Nothing offscreen can synthesize a
/// drag, so `.draggable`, `.dropDestination`, the targeting highlight and the
/// snap-back on a refused drop are all unverified by anything here. What is
/// verified instead is every decision a drop consults — see `KanbanBoardTests`,
/// which pins the column a card is in, the targets it offers, the command a
/// move produces and the two cases a move is refused. The gesture itself needs
/// a real run or an XCUITest.
@Suite("The board and the scoped screens, rendered offscreen", .serialized)
@MainActor
struct BoardSnapshotTests {
    /// The board over the same vault every other screen is reviewed against.
    ///
    /// Deliberately the shared corpus rather than a board-shaped one: the point
    /// of rendering it from `SnapshotFixtures.tasks` is that a reviewer can put
    /// this image next to `list-browse` and see the *same* tasks arranged
    /// differently. It also shows the honest resting state of a real vault —
    /// almost everything is `open`, so most columns are empty and one is very
    /// full, which is what a board over unlabelled work actually looks like.
    @Test("the board over the shared vault", arguments: SnapshotAppearance.allCases)
    func board(appearance: SnapshotAppearance) throws {
        let seeded = try SnapshotFixtures.populated()
        try record(
            KanbanBoardView(store: seeded.store),
            named: "board",
            size: Self.boardSize,
            appearance: appearance
        )
    }

    /// The board over work that has actually been triaged.
    ///
    /// The state worth reviewing that the shared vault cannot show: cards in
    /// five of the six columns, one column overflowing past the bottom of its
    /// own scroll view, and one still empty. Those are the two column shapes
    /// the design has to get right — a full column must scroll rather than push
    /// the board taller, and an empty one must still look like a place a card
    /// can be dropped.
    @Test("the board with a full column and an empty one", arguments: SnapshotAppearance.allCases)
    func spreadBoard(appearance: SnapshotAppearance) throws {
        let seeded = try SnapshotFixtures.seeded(with: BoardFixtures.spread)
        try record(
            KanbanBoardView(store: seeded.store),
            named: "board-spread",
            size: Self.boardSize,
            appearance: appearance
        )
    }

    /// A board narrowed to nothing, and an empty vault's board.
    ///
    /// Both are `ContentUnavailableView`, and they must say different things:
    /// "there is nothing here" and "you hid everything" send a reader in
    /// opposite directions.
    @Test("an empty board", arguments: SnapshotAppearance.allCases)
    func emptyBoard(appearance: SnapshotAppearance) throws {
        let seeded = try SnapshotFixtures.empty()
        try record(
            KanbanBoardView(store: seeded.store),
            named: "board-empty",
            size: Self.boardSize,
            appearance: appearance
        )
    }

    @Test("a board narrowed to nothing", arguments: SnapshotAppearance.allCases)
    func narrowedBoard(appearance: SnapshotAppearance) throws {
        let seeded = try SnapshotFixtures.populated()
        try record(
            KanbanBoardView(store: seeded.store, query: TaskListQuery(search: "xyzzy")),
            named: "board-no-matches",
            size: Self.boardSize,
            appearance: appearance
        )
    }

    /// Two columns side by side at a size a reviewer can actually read.
    ///
    /// The whole-board images are 1240pt wide and every card in them is small.
    /// This is the same two column shapes at 1:1 — the one thing worth checking
    /// closely is the card: a two-line title, the priority and repeat marks
    /// surviving beside it, the date column, and the metadata line under it.
    @Test("a full column and an empty one, close up", arguments: SnapshotAppearance.allCases)
    func columns(appearance: SnapshotAppearance) throws {
        let board = try Self.board(of: BoardFixtures.spread)
        // Both are pulled out with `filter` before `#require` rather than
        // with `first(where:)` inside it: the `#require` macro rewrites a
        // `first(where:)` call into a form whose closure is treated as
        // throwing, which does not compile inside a non-throwing expectation.
        let full = try #require(board.columns.filter { $0.count > 3 }.first)
        let empty = try #require(board.columns.filter(\.isEmpty).first)

        try record(
            HStack(alignment: .top, spacing: 12) {
                ColumnHarness(column: full, board: board)
                ColumnHarness(column: empty, board: board)
            }
            .padding(12),
            named: "board-columns",
            size: Self.columnsSize,
            appearance: appearance
        )
    }

    /// Every card state, stacked, so the set is reviewable as a set.
    ///
    /// The same argument the priority ramp makes on the list side: a card is
    /// not obviously wrong on its own, and a completed card that looks
    /// identical to an overdue one is only visible when the two are adjacent.
    @Test("the card states, stacked", arguments: SnapshotAppearance.allCases)
    func cards(appearance: SnapshotAppearance) throws {
        let board = try Self.board(of: BoardFixtures.cardStates)
        let column = try #require(board.columns.filter { !$0.isEmpty }.first)

        try record(
            VStack(alignment: .leading, spacing: 8) {
                ForEach(board.cards) { row in
                    KanbanCardView(
                        row: row,
                        moveTargets: board.moveTargets(for: row.id),
                        onToggle: {},
                        onMove: { _ in },
                        onDelete: {},
                        columnTitle: column.title
                    )
                }
                Spacer()
            }
            .frame(width: KanbanColumnView.width)
            .padding(12)
            // On the surface a card actually sits on. Rendered against the
            // window background instead, a `.background.secondary` card is
            // nearly invisible in light mode — a picture of a contrast problem
            // the app does not have.
            .background(.quinary),
            named: "board-cards",
            size: Self.cardsSize,
            appearance: appearance
        )
    }

    /// A project screen, which is Browse over a smaller corpus.
    ///
    /// Worth an image rather than only a test because the thing to check is
    /// that it does **not** look like a new screen: same row, same toolbar,
    /// same header — with the project's name in the heading and the project's
    /// own count beside it.
    @Test("a project screen", arguments: SnapshotAppearance.allCases)
    func projectScreen(appearance: SnapshotAppearance) throws {
        let seeded = try SnapshotFixtures.populated()
        let entity = try #require(TaskEntity(kind: .project, name: "[[Admin]]"))
        try record(
            TaskListView(section: .browse, store: seeded.store, scope: entity.scope),
            named: "entity-project",
            size: Self.screenSize,
            appearance: appearance
        )
    }

    /// What a `tasknotes://task/…` link opens.
    ///
    /// The screen is Browse — this app has no task *screen*, because a task's
    /// fields belong to the inspector — with the linked row already selected,
    /// which is what publishes the `InspectorSubject` the panel reads. Worth an
    /// image because "the row came back selected" is exactly the kind of claim
    /// a compiler cannot check and a headless test only checks in the abstract.
    @Test("a deep-linked task opens already selected", arguments: SnapshotAppearance.allCases)
    func deepLinkedTask(appearance: SnapshotAppearance) throws {
        let seeded = try SnapshotFixtures.populated()
        try record(
            TaskListView(section: .browse, store: seeded.store, reveal: "Tasks/Stand-up.md"),
            named: "deep-link-task",
            size: Self.screenSize,
            appearance: appearance
        )
    }

    @Test("a context screen", arguments: SnapshotAppearance.allCases)
    func contextScreen(appearance: SnapshotAppearance) throws {
        let seeded = try SnapshotFixtures.populated()
        let entity = try #require(TaskEntity(kind: .context, name: "work"))
        try record(
            TaskListView(section: .browse, store: seeded.store, scope: entity.scope),
            named: "entity-context",
            size: Self.screenSize,
            appearance: appearance
        )
    }

    /// A tag screen with nothing on it.
    ///
    /// The empty state that would have been wrong without a scope: on Browse it
    /// reads "Every task in the vault appears here", which under a heading
    /// saying `#nonexistent` describes the wrong thing entirely.
    @Test("an empty tag screen says what it is empty of", arguments: SnapshotAppearance.allCases)
    func emptyTagScreen(appearance: SnapshotAppearance) throws {
        let seeded = try SnapshotFixtures.populated()
        let entity = try #require(TaskEntity(kind: .tag, name: "nonexistent"))
        try record(
            TaskListView(section: .browse, store: seeded.store, scope: entity.scope),
            named: "entity-tag-empty",
            size: Self.screenSize,
            appearance: appearance
        )
    }

    /// A saved view, which is the same thing again with a stored query behind
    /// it.
    @Test("a saved view screen", arguments: SnapshotAppearance.allCases)
    func savedViewScreen(appearance: SnapshotAppearance) throws {
        let seeded = try SnapshotFixtures.populated()
        var filter = FilterConfig.unfiltered
        filter.contexts = ["work"]
        let view = SavedView(
            id: "focus",
            name: "Work Focus",
            symbol: .briefcase,
            draft: SavedViewDraft(
                base: .of(filter), sort: SortConfig(field: .effectiveDate, direction: .asc))
        )
        try record(
            TaskListView(
                section: .browse,
                store: seeded.store,
                query: view.seededQuery,
                scope: view.scope
            ),
            named: "saved-view",
            size: Self.screenSize,
            appearance: appearance
        )
    }

    /// The sheet that names a view.
    ///
    /// The symbol row is the part worth looking at: ten glyphs at one size, one
    /// of them selected by a filled background rather than by a colour swapped
    /// into the glyph — because the glyphs are only comparable if their colour
    /// is constant.
    @Test("the saved-view editor", arguments: SnapshotAppearance.allCases)
    func savedViewEditor(appearance: SnapshotAppearance) throws {
        let store = SavedViewStore(defaults: try Self.scratchDefaults())
        try record(
            SavedViewEditor(mode: .create(SavedViewDraft()), store: store),
            named: "saved-view-editor",
            size: Self.editorSize,
            appearance: appearance
        )
    }

    /// The sidebar, which is where the saved views and the vault's own names
    /// now live.
    ///
    /// The one image that shows the whole navigation model at once: four fixed
    /// screens plus the board, then the saved views, then the vault's projects,
    /// contexts and tags as three collapsible groups.
    @Test("the sidebar", arguments: SnapshotAppearance.allCases)
    func sidebar(appearance: SnapshotAppearance) throws {
        let store = SavedViewStore(defaults: try Self.scratchDefaults())
        try record(
            SidebarList(
                navigation: NavigationState(),
                vocabulary: TaskVocabulary.of(tasks: SnapshotFixtures.tasks),
                savedViews: store
            )
            .frame(width: 240),
            named: "sidebar",
            size: Self.sidebarSize,
            appearance: appearance
        )
    }

    // ── Fixtures ───────────────────────────────────────────────────────────

    /// A board built exactly as ``KanbanBoardView`` builds one.
    ///
    /// The sort is the view's own default and not `TaskListQuery()`'s. A first
    /// pass left it unsorted, and the close-up column then showed its cards in
    /// a different order from the same column in the whole-board image — two
    /// pictures of one screen disagreeing, which is worse than either.
    private static func board(of tasks: [CoreTask]) throws -> KanbanBoard {
        try KanbanBoard.build(
            tasks: tasks,
            pendingTaskIds: ["Tasks/Sync me.md"],
            calendar: SnapshotFixtures.calendar,
            query: TaskListQuery(sort: SortConfig(field: .effectiveDate, direction: .asc)),
            text: TaskDateText(locale: Locale(identifier: "en_US")),
            scope: nil
        )
    }

    /// A defaults suite nobody else shares, so rendering a sidebar cannot
    /// rewrite the developer's own saved views.
    private static func scratchDefaults() throws -> UserDefaults {
        try #require(
            UserDefaults(suiteName: "red.sjer.tasknotes.snapshots.\(UUID().uuidString)"))
    }

    /// Wide enough for four of the six columns, which is what a default window
    /// shows — so the horizontal scroll is visibly part of the design rather
    /// than an artefact of a narrow canvas.
    private static let boardSize = CGSize(width: 1200, height: 620)
    /// Short enough that a seven-card column visibly runs past the bottom of
    /// its own scroll view, which is the state a board has to handle and the
    /// whole-board image at 620pt does not reach.
    private static let columnsSize = CGSize(width: 600, height: 400)
    private static let cardsSize = CGSize(width: 320, height: 560)
    private static let screenSize = CGSize(width: 780, height: 560)
    private static let editorSize = CGSize(width: 420, height: 220)
    private static let sidebarSize = CGSize(width: 240, height: 620)
}

/// A column with somewhere to put its selection.
///
/// `KanbanColumnView` takes a `Binding<TaskId?>`, which a test function cannot
/// vend. This is the smallest wrapper that owns one, and it exists for that
/// reason alone.
private struct ColumnHarness: View {
    let column: KanbanColumn
    let board: KanbanBoard

    @State private var selection: TaskId?

    var body: some View {
        KanbanColumnView(
            column: column,
            board: board,
            selection: $selection,
            onToggle: { _ in },
            onMove: { _, _ in },
            onDelete: { _ in }
        )
    }
}

/// The two vaults the board images are rendered against.
///
/// At file scope rather than nested in the suite: the arrays are long enough
/// that they pushed the type past the linter's body-length limit, and the limit
/// was pointing at something real — a test type should read as a list of what is
/// being looked at, not as a vault.
@MainActor
enum BoardFixtures {
    /// Work that has been triaged: five columns used, one column overflowing,
    /// one still empty.
    static var spread: [CoreTask] {
        [
            coreTask(
                id: "Tasks/Renew passport.md", title: "Renew passport",
                priority: .highest, due: "2026-06-30", projects: ["[[Admin]]"]),
            coreTask(
                id: "Tasks/Reply to the landlord about the boiler inspection.md",
                title: "Reply to the landlord about the boiler inspection",
                priority: .high, due: "2026-07-19"),
            coreTask(
                id: "Tasks/Ship the release notes.md", title: "Ship the release notes",
                due: SnapshotFixtures.today, projects: ["[[Website]]"], contexts: ["work"]),
            coreTask(
                id: "Tasks/Water the plants.md", title: "Water the plants",
                priority: .low, due: SnapshotFixtures.today, contexts: ["home"]),
            coreTask(
                id: "Tasks/Draft the offsite agenda.md", title: "Draft the offsite agenda"),
            coreTask(id: "Tasks/Find a dentist.md", title: "Find a dentist", priority: .high),
            coreTask(
                id: "Tasks/Stand-up.md", title: "Stand-up", priority: .medium,
                scheduled: SnapshotFixtures.today, recurrence: "FREQ=DAILY",
                contexts: ["work"]),
            coreTask(
                id: "Tasks/Rewrite the changelog script.md",
                title: "Rewrite the changelog script", status: .inProgress,
                priority: .medium, due: "2026-07-24", projects: ["[[Website]]"]),
            coreTask(
                id: "Tasks/Migrate the vault.md", title: "Migrate the vault",
                status: .inProgress, priority: .high, contexts: ["work"]),
            coreTask(
                id: "Tasks/Chase the invoice.md", title: "Chase the invoice",
                status: .waiting, priority: .high, due: "2026-07-18", contexts: ["work"]),
            coreTask(
                id: "Tasks/Sync me.md", title: "Waiting on the supplier",
                status: .waiting, due: "2026-08-14"),
            coreTask(
                id: "Tasks/Book the flights.md", title: "Book the flights",
                status: .done, due: "2026-07-20", projects: ["[[Travel]]"]),
            coreTask(
                id: "Tasks/Quarterly review.md", title: "Quarterly review",
                status: .cancelled, priority: .low),
            // Retired but still repeating — see `cardStates` for why this case
            // has to appear on a board and can appear nowhere else.
            coreTask(
                id: "Tasks/Weekly review.md", title: "Weekly review",
                status: .done, priority: .medium,
                scheduled: "2026-07-24", recurrence: "FREQ=WEEKLY;BYDAY=FR"),
        ]
    }

    /// One card per branch the card view takes.
    static var cardStates: [CoreTask] {
        [
            coreTask(
                id: "Tasks/Ship the release notes.md", title: "Ship the release notes",
                due: SnapshotFixtures.today, projects: ["[[Website]]"], contexts: ["work"]),
            coreTask(
                id: "Tasks/Renew passport.md", title: "Renew passport",
                priority: .highest, due: "2026-06-30", projects: ["[[Admin]]"]),
            coreTask(
                id: "Tasks/A title long enough that it has to wrap onto a second line.md",
                title: "A title long enough that it has to wrap onto a second line",
                priority: .low, due: "2026-07-24"),
            coreTask(
                id: "Tasks/Stand-up.md", title: "Stand-up", priority: .medium,
                scheduled: SnapshotFixtures.today, recurrence: "FREQ=DAILY",
                contexts: ["work"]),
            coreTask(
                id: "Tasks/Take vitamins.md", title: "Take vitamins", priority: .low,
                scheduled: SnapshotFixtures.today, recurrence: "FREQ=DAILY",
                completeInstances: [SnapshotFixtures.today]),
            coreTask(id: "Tasks/Sync me.md", title: "Waiting to sync", priority: .high),
            coreTask(id: "Tasks/Bare.md", title: "No metadata at all"),
            // ⚠️ A **retired recurring** task: cancelled, but with a rule that
            // still fires and no entry in `completeInstances`. This is the case
            // `list-screens` found drawing identically to a live task on the
            // list row, and the board is the only surface that can show it —
            // Today and Upcoming filter terminal tasks out, so the bug was
            // structurally invisible there.
            //
            // On a card the two channels have to disagree here: struck through
            // and dimmed, because the *task* is retired, and an **empty** box,
            // because the occurrence was never ticked. A card that looked live
            // would be the same defect one screen over.
            coreTask(
                id: "Tasks/Weekly review.md", title: "Weekly review",
                status: .cancelled, priority: .medium,
                scheduled: "2026-07-24", recurrence: "FREQ=WEEKLY;BYDAY=FR"),
        ]
    }
}
