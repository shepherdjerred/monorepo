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
        #expect(board.cardCount == KanbanFixtures.vault.count)

        var seen: Set<TaskId> = []
        for column in board.columns {
            for row in column.rows {
                #expect(seen.insert(row.id).inserted, "\(row.id) is in two columns")
                #expect(row.task.status == column.status)
            }
        }
        #expect(seen.count == KanbanFixtures.vault.count)
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

    /// ⚠️ **A recurring task whose current occurrence is done stays in the
    /// column its `status` names, and that is load-bearing.**
    ///
    /// Ticking today's vitamins mutates `completeInstances`, never `status`, so
    /// the task is still `open` and belongs under Open. Filing it under Done
    /// because it "looks finished" would break three things at once: the
    /// invariant that a card's column *is* its status (there is no default
    /// column, because the status is a closed enum), dragging it out would then
    /// `setStatus` a field it never had — and the card would **move itself back
    /// to Open overnight**, when the rule's next occurrence comes due and
    /// nobody touched anything.
    ///
    /// So the model keeps the two answers separate, and the card view draws
    /// them on separate channels: the strikethrough follows `status`, the
    /// checkbox follows the occurrence.
    @Test("a recurring task with its occurrence done stays in its status column")
    func completedOccurrenceStaysInItsStatusColumn() throws {
        let board = try build()
        let column = try #require(board.column(holding: "Tasks/Take vitamins.md"))
        #expect(column.status == .open)

        let card = try #require(board.card("Tasks/Take vitamins.md"))
        // The occurrence is done…
        #expect(card.isCompleted)
        // …and the task is not. Both true at once is the whole point.
        #expect(taskStatusIsActive(status: card.task.status))
        #expect(!column.isTerminal)
    }

    /// ⚠️ **The mirror case: a retired task whose rule still fires.**
    ///
    /// `TaskRowState.isCompleted` is occurrence-level for a recurring task — it
    /// reads `completeInstances` and never `status` — so a cancelled or done
    /// recurring task reports `isCompleted == false` while being entirely
    /// finished. Anything keyed on `isCompleted` alone therefore draws it as
    /// live work.
    ///
    /// **The board is the only surface that can show this**, which is why it
    /// went unnoticed: Today and Upcoming filter terminal tasks out, so a
    /// screen built against them structurally cannot reveal it. Browse can, and
    /// a Cancelled column makes it unmissable.
    ///
    /// The model's job is only to file the card correctly, which it does by
    /// `status`. The drawing is `KanbanCardView`'s, and it keys the
    /// strikethrough on the task and the checkbox on the occurrence precisely
    /// so that this row comes out struck through with an **empty** box.
    @Test("a retired task whose rule still fires is filed by status, not occurrence")
    func retiredRecurringIsFiledByStatus() throws {
        let board = try build()
        let column = try #require(board.column(holding: "Tasks/Weekly review.md"))
        #expect(column.status == .cancelled)
        #expect(column.isTerminal)

        let card = try #require(board.card("Tasks/Weekly review.md"))
        // Occurrence-level says "not done"…
        #expect(!card.isCompleted)
        // …while the task is finished. A view keyed on the first alone would
        // draw this as live work.
        #expect(!taskStatusIsActive(status: card.task.status))
        #expect(card.isRecurring)
    }

    /// ⚠️ **The invariant the board's channel split rests on: a card is struck
    /// through exactly when the column it sits in is terminal.**
    ///
    /// The card keys its strikethrough on `TaskRowState.isTerminal` and its
    /// checkbox on `isCompleted`, so that a recurring task with today ticked
    /// reads as *today is done, the task is not* rather than as a
    /// contradiction. That only holds if the card's own idea of "terminal"
    /// cannot drift from its column's — and it cannot, because both are the
    /// core's `task_status_is_active` asked of the same status.
    ///
    /// ⚠️ **Being honest about what each half of this pins.** The equality
    /// itself *follows* from the partition rule — cards are filed by status, so
    /// a card's status is its column's — and asserting it does not catch a view
    /// bug, because no view runs here. It is stated because it is the property
    /// the card's drawing silently depends on, so that changing how the board
    /// files cards breaks this by name instead of quietly changing what gets
    /// struck through.
    ///
    /// The two expectations **below** it are the load-bearing ones: without a
    /// card that is retired-but-not-terminal and one that is
    /// terminal-but-not-completed, the equality would hold vacuously and
    /// `isTerminal` could be defined as either of its neighbours undetected.
    @Test("a card is terminal exactly when its column is")
    func cardTerminalityMatchesItsColumn() throws {
        let board = try build()
        for column in board.columns {
            for card in column.rows {
                #expect(
                    card.isTerminal == column.isTerminal,
                    "\(card.id) and the \(column.title) column disagree about being terminal")
            }
        }

        // And the two facts really are independent, or the equality above would
        // be vacuous: the fixture holds a card that is retired without being
        // terminal, and one that is terminal without being completed.
        let vitamins = try #require(board.card("Tasks/Take vitamins.md"))
        #expect(vitamins.isRetired && !vitamins.isTerminal)
        let review = try #require(board.card("Tasks/Weekly review.md"))
        #expect(review.isTerminal && !review.isCompleted)
    }

    /// The three questions a card can be asked about being finished, over the
    /// fixture, as a table read off it **by hand**.
    ///
    /// ⚠️ **This replaces a test that could never fail.** It asserted
    /// `isRetired == isCompleted || isTerminal` — which is the implementation
    /// restated, so it passed for *any* definition of any of the three and read
    /// as coverage while providing none. The only form that can disagree with
    /// the code is one whose expectations come from the fixture's own inputs
    /// rather than from the code's own composition, which is what the literals
    /// below are.
    ///
    /// The table is also the clearest statement of why three properties exist:
    /// **every column here differs from the other two on some row.** Take
    /// vitamins is completed without being terminal; Weekly review is terminal
    /// without being completed; Delegated is neither despite sounding final.
    @Test("completed, terminal and retired are three different questions")
    func theThreeQuestions() throws {
        let board = try build()
        let expectations: [FinishedExpectation] = [
            FinishedExpectation("Tasks/Open one.md", false, false, false),
            FinishedExpectation("Tasks/Running.md", false, false, false),
            // Delegated is a live status: only done and cancelled are terminal,
            // and that is the core's answer, not a guess made here.
            FinishedExpectation("Tasks/Delegated.md", false, false, false),
            FinishedExpectation("Tasks/Finished.md", true, true, true),
            FinishedExpectation("Tasks/Abandoned.md", true, true, true),
            // Live, today ticked — retired without being terminal.
            FinishedExpectation("Tasks/Take vitamins.md", true, false, true),
            // Cancelled, nothing ever ticked — terminal without being completed.
            FinishedExpectation("Tasks/Weekly review.md", false, true, true),
        ]

        for expectation in expectations {
            let card = try #require(board.card(expectation.id))
            #expect(card.isCompleted == expectation.completed, "\(expectation.id) isCompleted")
            #expect(card.isTerminal == expectation.terminal, "\(expectation.id) isTerminal")
            #expect(card.isRetired == expectation.retired, "\(expectation.id) isRetired")
        }
    }

    /// One row of the table above.
    ///
    /// A named struct rather than a four-member tuple: `large_tuple` caps them
    /// at two, and the cap is right here — four unlabelled `Bool`s at a call
    /// site would be exactly the sort of thing that gets transposed silently.
    private struct FinishedExpectation {
        let id: TaskId
        let completed: Bool
        let terminal: Bool
        let retired: Bool

        init(_ id: TaskId, _ completed: Bool, _ terminal: Bool, _ retired: Bool) {
            self.id = id
            self.completed = completed
            self.terminal = terminal
            self.retired = retired
        }
    }

    /// The board narrows through the same query surface as a list, and its
    /// count says so.
    @Test("filtering the board narrows the cards and states the narrowing")
    func filtering() throws {
        var query = TaskListQuery()
        query.filter.toggleContext("work")
        let board = try build(query: query)

        #expect(board.isNarrowed)
        #expect(board.admittedCount == KanbanFixtures.vault.count)
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

    /// ⚠️ **The combination neither `filtering` nor `scopedBoard` covers: a
    /// scoped board that the reader then narrows again.**
    ///
    /// Each of those two pins one input with the other absent, and a board that
    /// dropped the scope the moment a filter was applied — or dropped the
    /// filter the moment a scope was present — would pass both of them. Only
    /// supplying both at once can tell "and" from "either one wins".
    ///
    /// The counts are chosen to be three-way distinguishable: the scope alone
    /// admits 2, the filter alone admits 5, and the intersection admits 1. A
    /// union would show 6.
    @Test("a scoped board narrows again under the reader's filter")
    func scopedBoardNarrowsAgain() throws {
        let entity = try #require(TaskEntity(kind: .context, name: "work"))
        var query = TaskListQuery()
        query.filter.toggleStatus(.open)

        let scopeOnly = try build(scope: entity.scope)
        let filterOnly = try build(query: query)
        let both = try build(query: query, scope: entity.scope)

        #expect(scopeOnly.cardCount == 2)
        #expect(filterOnly.cardCount == 5)
        #expect(both.cardCount == 1)
        #expect(both.cards.map(\.task.title) == ["Open one"])

        // The scope survives the reader's filter: the count beside the heading
        // still describes the slice, not the vault.
        #expect(both.admittedCount == 2)
    }

    /// ⚠️ **A scope with more than one link, which every other scope fixture
    /// here has exactly one of.**
    ///
    /// `TaskEntity` produces single-link chains, so nothing above could
    /// distinguish `narrow` applying *every* link from applying only the first.
    /// A saved view kept from a project screen carries two — the screen's scope
    /// and the reader's filter, conjoined — so this is the shape real stored
    /// views have, and it was untested.
    ///
    /// First link alone admits 2, second alone admits 5; the conjunction admits
    /// 1, so applying only one of them is visible either way round.
    @Test("a board scoped by a multi-link chain applies every link")
    func multiLinkScope() throws {
        var byContext = FilterConfig.unfiltered
        byContext.contexts = ["work"]
        var byStatus = FilterConfig.unfiltered
        byStatus.statuses = [.open]

        let scope = TaskListScope(
            title: "Open work",
            systemImage: "briefcase",
            baseFilter: FilterChain.of(byContext).and(byStatus),
            emptyTitle: "Nothing here",
            emptyDescription: "",
            identity: "view.open-work"
        )
        #expect(scope.baseFilter.filters.count == 2, "two links, not one merged record")

        let board = try build(scope: scope)
        #expect(board.cardCount == 1)
        #expect(board.cards.map(\.task.title) == ["Open one"])
        #expect(board.admittedCount == 1)
        #expect(board.heading == "Open work")
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

    // ── Fixture ───────────────────────────────────────────────────────────

    private func build(
        query: TaskListQuery = TaskListQuery(),
        scope: TaskListScope? = nil,
        pending: [TaskId] = []
    ) throws -> KanbanBoard {
        try KanbanBoard.build(
            tasks: KanbanFixtures.vault,
            pendingTaskIds: pending,
            calendar: fixedCalendar(),
            query: query,
            text: fixedText(),
            scope: scope
        )
    }
}

/// The vault the board cases run against.
///
/// At file scope rather than nested in the suite: the type had outgrown the
/// linter's body-length limit, and the limit was pointing at something real — a
/// test type should read as a list of what is being asserted, not as a vault.
enum KanbanFixtures {
    /// A vault with four open tasks, one of each other live status, and none
    /// waiting or delegated — so the board has both an overflowing column and
    /// empty ones without any of it being contrived.
    static let vault: [CoreTask] = [
        coreTask(id: "Tasks/Open one.md", title: "Open one", contexts: ["work"]),
        coreTask(id: "Tasks/Open two.md", title: "Open two", due: "2026-07-20"),
        coreTask(id: "Tasks/Open three.md", title: "Open three", priority: .highest),
        coreTask(id: "Tasks/Open four.md", title: "Open four", contexts: ["home"]),
        coreTask(
            id: "Tasks/Running.md", title: "Running", status: .inProgress, contexts: ["work"]),
        coreTask(id: "Tasks/Finished.md", title: "Finished", status: .done),
        coreTask(id: "Tasks/Abandoned.md", title: "Abandoned", status: .cancelled),
        coreTask(id: "Tasks/Delegated.md", title: "Delegated", status: .delegated),
        // Live, and its current occurrence is already ticked off. The one
        // fixture where "is this done?" has two different right answers.
        coreTask(
            id: "Tasks/Take vitamins.md", title: "Take vitamins",
            scheduled: "2026-07-22", recurrence: "FREQ=DAILY",
            completeInstances: ["2026-07-22"]),
        // Retired, but its rule still fires and no occurrence was ever ticked.
        // The mirror image of the row above, and the case that can only surface
        // on a board.
        coreTask(
            id: "Tasks/Weekly review.md", title: "Weekly review", status: .cancelled,
            scheduled: "2026-07-24", recurrence: "FREQ=WEEKLY;BYDAY=FR"),
    ]
}
