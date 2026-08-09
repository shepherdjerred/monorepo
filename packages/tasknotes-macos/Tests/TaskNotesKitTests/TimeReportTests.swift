import Foundation
import TaskNotesKit
import TaskNotesUniFFI
import Testing

/// The time report's two sources, and the one thing that makes it readable.
@Suite("The time report")
struct TimeReportTests {
    private let locale = Locale(identifier: "en_US")

    // ── Durations read, they are not watched ───────────────────────────────

    /// ⚠️ The assertion this whole type exists for.
    ///
    /// The core's `elapsedFormat` would render ninety minutes as `1:30:00`,
    /// which is a *timer* — it reads as a video length, not as an hour and a
    /// half of work. Phase 9b found that; this is the fix, pinned so nobody
    /// "simplifies" the report back onto the timer's formatter.
    @Test("durations are spelled, not clocked")
    func spelledDurations() {
        #expect(TimeReport.text(minutes: 90, locale: locale) == "1 hr, 30 min")
        #expect(elapsedFormat(seconds: 90 * 60) == "1:30:00")
    }

    @Test(
        "durations in every magnitude",
        arguments: [
            (UInt32(0), "0 min"),
            (1, "1 min"),
            (45, "45 min"),
            (60, "1 hr"),
            (125, "2 hr, 5 min"),
            (1_500, "25 hr"),
        ]
    )
    func durations(minutes: UInt32, expected: String) {
        #expect(TimeReport.text(minutes: minutes, locale: locale) == expected)
    }

    // ── The server's aggregate ─────────────────────────────────────────────

    @Test("a server summary keeps the server's order")
    func fromSummary() {
        let report = TimeReport.of(
            summary: TimeSummary(
                totalTime: 100,
                topTasks: [
                    TopTask(taskId: "Tasks/b.md", title: "Second", minutes: 25),
                    TopTask(taskId: "Tasks/a.md", title: "First", minutes: 75),
                ]
            )
        )

        // Deliberately *not* re-sorted: 25 before 75, exactly as it arrived.
        #expect(report.rows.map(\.taskId) == ["Tasks/b.md", "Tasks/a.md"])
        #expect(report.totalMinutes == 100)
        #expect(report.rows.map(\.share) == [0.25, 0.75])
    }

    // ── The local derivation ───────────────────────────────────────────────

    @Test("local totals are ranked, and untracked tasks are left out")
    func fromTasks() {
        let report = TimeReport.ofTrackedTotals(tasks: [
            tracked(id: "Tasks/a.md", title: "Alpha", minutes: 30),
            tracked(id: "Tasks/none.md", title: "Untouched", minutes: 0),
            tracked(id: "Tasks/c.md", title: "Gamma", minutes: 90),
        ])

        #expect(report.rows.map(\.title) == ["Gamma", "Alpha"])
        #expect(report.totalMinutes == 120)
        #expect(report.rows.map(\.minutes) == [90, 30])
        #expect(report.rows.map { $0.text(locale: locale) } == ["1 hr, 30 min", "30 min"])
        #expect(report.rows.map(\.share) == [0.75, 0.25])
    }

    /// A report that reshuffled between reads would be unusable, and equal
    /// totals are the common case for two short tasks.
    @Test("ties break on title so the order is stable")
    func stableTies() {
        let report = TimeReport.ofTrackedTotals(tasks: [
            tracked(id: "Tasks/z.md", title: "Zebra", minutes: 15),
            tracked(id: "Tasks/a.md", title: "Aardvark", minutes: 15),
        ])
        #expect(report.rows.map(\.title) == ["Aardvark", "Zebra"])
    }

    @Test("a vault with no tracked time reports nothing")
    func empty() {
        let report = TimeReport.ofTrackedTotals(tasks: [
            tracked(id: "Tasks/a.md", title: "Alpha", minutes: 0)
        ])
        #expect(report.isEmpty)
        #expect(report.totalMinutes == 0)
        #expect(TimeReport.text(minutes: report.totalMinutes, locale: locale) == "0 min")
    }

    /// A task carrying tracked time and nothing else that matters.
    ///
    /// Spelled here rather than added as a parameter to the shared
    /// `coreTask` helper, because `totalTrackedTime` is the only field this
    /// suite reads and every other suite would have to skip past it.
    private func tracked(id: TaskId, title: String, minutes: UInt32) -> CoreTask {
        CoreTask(
            id: id,
            path: id,
            title: title,
            status: .open,
            priority: .normal,
            due: nil,
            scheduled: nil,
            contexts: [],
            projects: [],
            tags: [],
            recurrence: nil,
            recurrenceAnchor: nil,
            completeInstances: [],
            skippedInstances: [],
            completedDate: nil,
            dateCreated: nil,
            dateModified: nil,
            timeEstimate: nil,
            timeEntries: [],
            blockedBy: [],
            reminders: [],
            archived: false,
            totalTrackedTime: minutes,
            isBlocked: false,
            isBlocking: false,
            extraFields: "{}",
            details: nil
        )
    }
}
