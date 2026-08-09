import Foundation
internal import TaskNotesKit
internal import TaskNotesUniFFI
import Testing

/// The board, without a window.
///
/// Drag-and-drop itself cannot be tested here — or anywhere headless, since
/// nothing can synthesize a drag — so what is pinned instead is everything a
/// drop *decides*: which column a card is in, which columns it may move to,
/// what command a move produces, and when a move is refused. A drop handler
/// that consults these cannot be wrong about anything except the gesture.
@Suite("The Kanban board")
struct KanbanBoardTests {
    /// Every status gets a column, in the core's own order, with the core's own
    /// words.
    ///
    /// The React Native board has three hard-coded columns read from a free-text
    /// `extraFields["company_status"]`, with a three-entry tag fallback and then
    /// a default column. This is the assertion that none of that survived: the
    /// vocabulary is `task_status_all()` and `task_status_label`, so the board,
    /// the filter menu and the inspector cannot disagree about what statuses
    /// exist or what they are called.
    @Test("columns are the core's statuses, in the core's order")
    func columnsAreTheCoreStatuses() throws {
        let board = try build()
        #expect(board.columns.map(\.status) == taskStatusAll())
        #expect(board.columns.map(\.title) == taskStatusAll().map { taskStatusLabel(status: $0) })
        #expect(board.columns.map(\.id) == taskStatusAll().map { taskStatusWireValue(status: $0) })
    }

    /// Every admitted task lands in exactly one column, and none are lost.
    ///
    /// There is no default column and there cannot be one, because the status is
    /// a closed six-variant enum rather than a string somebody typed. That is
    /// the whole reason the React Native fallback chain does not exist here.
    @Test("every card is in exactly one column and none go missing")
    func partitionIsTotalAndDisjoint() throws {
        let board = try build()
        #expect(board.cardCount == Self.vault.count)

        var seen: Set<TaskId> = []
        for column in board.columns {
            for row in column.rows {
                #expect(seen.insert(row.id).inserted, "\(row.id) is in two columns")
                #expect(row.task.status == column.status)
            }
        }
        #expect(seen.count == Self.vault.count)
    }

    /// A board over the fixture has both of the states worth looking at: a
    /// column with several cards, and a column with none.
    @Test("the fixture board has an overflowing column and an empty one")
    func hasBothColumnShapes() throws {
        let board = try build()
        // Spelled as counts rather than as `contains(where:)`: the `#expect`
        // macro rewrites a `contains(where:)` call into a form whose closure is
        // treated as throwing, which does not compile inside a non-throwing
        // expectation.
        let overflowing = board.columns.filter { $0.count > 3 }
        let empty = board.columns.filter(\.isEmpty)
        #expect(overflowing.count == 1)
        #expect(empty.count == 1)
    }

    /// Terminal columns are named by the core's predicate, not by a list of
    /// "done-ish" statuses restated in Swift.
    @Test("terminal columns are the core's inactive statuses")
    func terminalColumns() throws {
        let board = try build()
        let terminal = board.columns.filter(\.isTerminal).map(\.status)
        #expect(terminal == taskStatusAll().filter { !taskStatusIsActive(status: $0) })
    }

    /// The move targets a card offers are every column but its own — which is
    /// `getMoveTargets` from the React Native card, and the keyboard route to
    /// the whole feature.
    @Test("move targets are every column except the card's own")
    func moveTargets() throws {
        let board = try build()
        let targets = board.moveTargets(for: "Tasks/Open one.md")
        #expect(targets.count == taskStatusAll().count - 1)
        #expect(!targets.contains { $0.status == .open })
    }

    @Test("an unknown card offers no targets")
    func unknownCardHasNoTargets() throws {
        let board = try build()
        #expect(board.moveTargets(for: "Tasks/Not here.md").isEmpty)
    }

    /// A move is a `setStatus` — the *same* command the row checkbox and the
    /// inspector's status picker issue.
    ///
    /// The React Native board rewrites **tags** to express which column a card
    /// is in, which makes the board's idea of where a task lives invisible to
    /// every other screen. This is the assertion that we did not port that.
    @Test("a move dispatches setStatus, not a tag rewrite")
    func moveCommandIsSetStatus() throws {
        let board = try build()
        let command = try #require(board.moveCommand("Tasks/Open one.md", to: .inProgress))
        #expect(command == .setStatus(taskId: "Tasks/Open one.md", status: .inProgress))
    }

    /// A drop that would not move anything is refused, so the system draws its
    /// own snap-back rather than the app pretending an edit happened.
    @Test("a move into the card's own column is refused")
    func moveIntoOwnColumnIsRefused() throws {
        let board = try build()
        #expect(board.moveCommand("Tasks/Open one.md", to: .open) == nil)
    }

    /// The boundary check behind the drop handler: the payload is a plain task
    /// id, so anything can be dropped on a column, and only ids the board holds
    /// are honoured.
    @Test("a dropped id the board does not hold is refused")
    func foreignDropIsRefused() throws {
        let board = try build()
        #expect(board.moveCommand("some dragged text", to: .done) == nil)
    }

    /// `⌃⌘←` and `⌃⌘→`, and the reason they do not wrap.
    @Test("keyboard moves step one column and stop at the ends")
    func keyboardMoves() throws {
        let board = try build()
        let statuses = taskStatusAll()

        #expect(board.column(.next, of: "Tasks/Open one.md")?.status == statuses[1])
        // `open` is the first status, so there is nothing to its left. A wrap
        // would silently turn "send this back a step" into "send it to Done".
        #expect(board.column(.previous, of: "Tasks/Open one.md") == nil)

        #expect(board.column(.previous, of: "Tasks/Delegated.md")?.status == statuses[4])
        #expect(board.column(.next, of: "Tasks/Delegated.md") == nil)
    }

    /// The board narrows through the same query surface as a list, and its
    /// count says so.
    @Test("filtering the board narrows the cards and states the narrowing")
    func filtering() throws {
        var query = TaskListQuery()
        query.filter.toggleContext("work")
        let board = try build(query: query)

        #expect(board.isNarrowed)
        #expect(board.admittedCount == Self.vault.count)
        #expect(board.cardCount == 2)
        #expect(board.cards.allSatisfy { $0.task.contexts.contains("work") })
    }

    /// Search is a filter dimension now, so it narrows the board exactly as it
    /// narrows a list — through the core, in one call.
    @Test("searching the board goes through the core's filter")
    func searching() throws {
        var query = TaskListQuery()
        query.search = "open one"
        let board = try build(query: query)
        #expect(board.cardCount == 1)
        #expect(board.cards.first?.task.title == "Open one")
    }

    /// A scoped board is the board over a smaller corpus — the same mechanism
    /// the entity and saved-view screens use, which is what makes "the board
    /// for this project" cost nothing.
    @Test("a scoped board narrows its corpus and takes the scope's name")
    func scopedBoard() throws {
        let entity = try #require(TaskEntity(kind: .context, name: "work"))
        let board = try build(scope: entity.scope)

        #expect(board.heading == "@work")
        #expect(board.cardCount == 2)
        #expect(board.admittedCount == 2)
        // The columns stay — an empty one is still a drop target, and a board
        // that dropped its empty columns would have nowhere to drag a card to.
        #expect(board.columns.count == taskStatusAll().count)
    }

    /// A board that is empty is empty, and still has all six columns to say so
    /// with.
    @Test("an empty vault still produces every column")
    func emptyBoard() throws {
        let board = try KanbanBoard.build(
            tasks: [],
            pendingTaskIds: [],
            calendar: fixedCalendar(),
            text: fixedText()
        )
        #expect(board.isEmpty)
        #expect(board.columns.count == taskStatusAll().count)
        #expect(board.countLabel == "No tasks")
    }

    /// A pending card is marked as one, because the board reads the same
    /// `TaskRowState` a list row does.
    @Test("cards carry the same pending state list rows do")
    func pendingCards() throws {
        let board = try build(pending: ["Tasks/Open one.md"])
        let card = try #require(board.card("Tasks/Open one.md"))
        #expect(card.isPending)
        #expect(board.cards.filter(\.isPending).count == 1)
    }

    // ── Fixture ────────────────────────────────────────────────────────────

    private func build(
        query: TaskListQuery = TaskListQuery(),
        scope: TaskListScope? = nil,
        pending: [TaskId] = []
    ) throws -> KanbanBoard {
        try KanbanBoard.build(
            tasks: Self.vault,
            pendingTaskIds: pending,
            calendar: fixedCalendar(),
            query: query,
            text: fixedText(),
            scope: scope
        )
    }

    /// A vault with four open tasks, one of each other live status, and none
    /// waiting or delegated — so the board has both an overflowing column and
    /// empty ones without any of it being contrived.
    private static let vault: [CoreTask] = [
        coreTask(id: "Tasks/Open one.md", title: "Open one", contexts: ["work"]),
        coreTask(id: "Tasks/Open two.md", title: "Open two", due: "2026-07-20"),
        coreTask(id: "Tasks/Open three.md", title: "Open three", priority: .highest),
        coreTask(id: "Tasks/Open four.md", title: "Open four", contexts: ["home"]),
        coreTask(
            id: "Tasks/Running.md", title: "Running", status: .inProgress, contexts: ["work"]),
        coreTask(id: "Tasks/Finished.md", title: "Finished", status: .done),
        coreTask(id: "Tasks/Abandoned.md", title: "Abandoned", status: .cancelled),
        coreTask(id: "Tasks/Delegated.md", title: "Delegated", status: .delegated),
    ]
}
