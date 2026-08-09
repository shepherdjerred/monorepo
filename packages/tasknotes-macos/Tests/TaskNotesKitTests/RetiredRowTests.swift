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
}
