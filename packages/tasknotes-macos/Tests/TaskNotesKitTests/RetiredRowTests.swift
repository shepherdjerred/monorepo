import Foundation
import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

/// The two independent reasons a row stops being live work.
///
/// ⚠️ **This suite exists because the combination that matters was missing.**
/// Every fixture the row was built against was either terminal-and-plain or
/// recurring-and-live, so `isCompleted` and `taskStatusIsActive` never
/// disagreed in a test — and a cancelled recurring task, which is exactly where
/// they do, drew identically to a live one. Browse is the only screen that can
/// show such a task, and it arrived after the row did.
///
/// All four combinations are asserted rather than the one that broke, because
/// the point is that the two facts are *independent*: pinning only the failing
/// corner would let a "simplification" collapse them again from the other side.
@Suite("Retired rows")
struct RetiredRowTests {
    private func row(
        _ status: TaskStatus,
        recurring: Bool,
        occurrenceDone: Bool
    ) throws -> TaskRowState {
        try TaskRowState(
            task: coreTask(
                id: "ferns.md",
                status: status,
                due: recurring ? nil : "2026-07-22",
                scheduled: recurring ? "2026-07-22" : nil,
                recurrence: recurring ? "FREQ=DAILY" : nil,
                completeInstances: occurrenceDone ? ["2026-07-22"] : []
            ),
            isPending: false,
            calendar: fixedCalendar(),
            text: fixedText()
        )
    }

    @Test("a terminal recurring task is retired even with no occurrence ticked")
    func aCancelledRuleIsNotLiveWork() throws {
        // The bug, stated as an assertion. `isCompleted` is false — the
        // occurrence was never ticked — and the task is still finished.
        for status in [TaskStatus.cancelled, .done] {
            let retired = try row(status, recurring: true, occurrenceDone: false)
            #expect(retired.isCompleted == false, "occurrence-level state is untouched")
            #expect(taskStatusIsActive(status: retired.task.status) == false)
            #expect(retired.isRetired, "\(status) must not draw as live work")
        }
    }

    @Test("a live rule with its occurrence ticked is retired for the other reason")
    func todaysOccurrenceDoneIsAlsoRetired() throws {
        // The mirror case, and the one that keeps the Today screen's completion
        // feedback: the task is active, the occurrence is done, the row still
        // reads as finished for now.
        let ticked = try row(.open, recurring: true, occurrenceDone: true)
        #expect(ticked.isCompleted)
        #expect(taskStatusIsActive(status: ticked.task.status))
        #expect(ticked.isRetired)
    }

    @Test("a live rule with nothing ticked is live work")
    func anUntouchedRuleIsLive() throws {
        let live = try row(.open, recurring: true, occurrenceDone: false)
        #expect(live.isCompleted == false)
        #expect(live.isRetired == false)
    }

    @Test("for a plain task the two reasons coincide, which is why this was easy to miss")
    func aPlainTaskCollapsesBothReasons() throws {
        // `isCompleted` for a plain task *is* the negated status, so no plain
        // fixture could ever have separated the two — which is precisely how a
        // row read one of them for years and looked correct.
        #expect(try row(.open, recurring: false, occurrenceDone: false).isRetired == false)
        #expect(try row(.done, recurring: false, occurrenceDone: false).isRetired)
        #expect(try row(.cancelled, recurring: false, occurrenceDone: false).isRetired)
        #expect(try row(.waiting, recurring: false, occurrenceDone: false).isRetired == false)
    }

    @Test("terminal is the core's answer about status, asked of every status there is")
    func terminalTracksTheCoreAcrossTheWholeEnum() throws {
        // ⚠️ **Recurring rows, and that is the whole point.** A first version of
        // this test used plain ones and was *vacuous*: for a plain task
        // `isCompleted` already equals the negated status, so `isTerminal`
        // defined wrongly as `isCompleted` still satisfied every assertion. It
        // was caught by redefining `isTerminal` and watching this test stay
        // green. The same collapse that hid the original bug hides a test of
        // it — a fixture has to make the two facts disagree before it can tell
        // them apart.
        for status in taskStatusAll() {
            let each = try row(status, recurring: true, occurrenceDone: false)
            #expect(each.isCompleted == false, "no occurrence is ticked, whatever the status")
            #expect(
                each.isTerminal == !taskStatusIsActive(status: status),
                "\(status) must take its terminal reading from the core, not from a list here")
        }
        // And the membership itself, so a change to which statuses are terminal
        // is a test failure somewhere rather than a silent re-drawing of every
        // list in the app. Driven by `taskStatusAll()` rather than a literal
        // list, so a seventh status added in Rust arrives here automatically
        // instead of defaulting to "not terminal".
        let terminal = try taskStatusAll().filter {
            try row($0, recurring: true, occurrenceDone: false).isTerminal
        }
        #expect(terminal == [.done, .cancelled])
    }

    @Test("retired reads true in exactly the cases the fixtures describe")
    func retiredMatchesAnIndependentReading() throws {
        // ⚠️ **Not `isRetired == isCompleted || isTerminal`.** That was the
        // first version and it is the implementation restated, so it passes for
        // *any* definition of its two halves and can never fail — a test that
        // reads as coverage and is not. The expectation here is derived from
        // the fixture's own inputs instead, which is the only way it can
        // disagree with the code.
        for status in taskStatusAll() {
            for recurring in [true, false] {
                for occurrenceDone in [true, false] {
                    let each = try row(
                        status, recurring: recurring, occurrenceDone: occurrenceDone)
                    let isActive = taskStatusIsActive(status: status)
                    // A plain task has no occurrences, so ticking one is not a
                    // thing that can have happened to it.
                    let expected = recurring ? (occurrenceDone || !isActive) : !isActive
                    #expect(
                        each.isRetired == expected,
                        "\(status) recurring=\(recurring) ticked=\(occurrenceDone)")
                }
            }
        }
    }
}
