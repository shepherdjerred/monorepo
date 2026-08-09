import AppKit
import SwiftUI
import TaskNotesKit
import TaskNotesUniFFI
import Testing

@testable import TaskNotesMac

/// The scoped screens, rendered offscreen.
///
/// Split from ``ListSnapshotTests`` because that file reached the linter's
/// length limit, and the cut is a real seam rather than an arbitrary one: these
/// two cases are about what a list stops saying once the *screen* says it, so
/// they read together and apart from everything else.
///
/// A project, context or tag screen is `TaskListView` over a `TaskListScope` —
/// the same rows, the same row view, a smaller corpus and a different name on
/// top. What is worth looking at is therefore not the rows but the **absence**:
/// a scoped screen must stop repeating its own identity down every row, and it
/// must stop at exactly that and no further.
///
/// `.serialized` for the reason the sibling suite is: one `NSApplication`, one
/// main run loop, and a render that spins it cannot do so while another is.
@Suite("The scoped screens, rendered offscreen", .serialized)
@MainActor
struct ScopedListSnapshotTests {
    /// A project screen, which must not print the project on every row.
    ///
    /// The scoped screens are Browse over a smaller corpus, so the rows are the
    /// same rows — and on the Website screen every one of them is in Website.
    /// Restating that down the whole column buries the metadata that actually
    /// distinguishes the rows, which is the same defect a repeated "Tomorrow"
    /// caused under a day heading.
    ///
    /// What to look at: **"Ship the release notes" keeps `@work` and loses
    /// `Website`**, while nothing else on the screen loses a context. A task in
    /// two projects would keep the other one.
    @Test(
        "a project screen omits its own name from its rows", arguments: SnapshotAppearance.allCases)
    func scopedScreenOmitsItsOwnName(appearance: SnapshotAppearance) throws {
        let seeded = try SnapshotFixtures.populated()
        let entity = try #require(TaskEntity(kind: .project, name: "[[Website]]"))
        try record(
            TaskListView(section: .browse, store: seeded.store, scope: entity.scope),
            named: "list-scoped-project",
            size: Self.screenSize,
            appearance: appearance
        )
    }

    /// A row on a scoped screen keeps every value the scope does *not* name.
    ///
    /// The over-suppression case, which the whole-screen shot above cannot
    /// show: a task in two projects, on the screen for one of them. Only the
    /// screen's own project may disappear.
    ///
    /// What to look at, top to bottom: unscoped reads `Website · Admin ·
    /// @work`; scoped to Website it reads **`Admin · @work`**; scoped to a
    /// context it reads `Website · Admin` and drops only `@work`.
    @Test("a scoped row drops only what the scope names", arguments: SnapshotAppearance.allCases)
    func scopedRowKeepsEverythingElse(appearance: SnapshotAppearance) throws {
        let task = coreTask(
            id: "Tasks/Ship the release notes.md",
            title: "Ship the release notes",
            due: SnapshotFixtures.today,
            projects: ["[[Website]]", "[[Admin]]"],
            contexts: ["work"]
        )
        let row = try TaskRowState(
            task: task,
            isPending: false,
            calendar: SnapshotFixtures.calendar,
            text: TaskDateText(locale: Locale(identifier: "en_US"))
        )
        let byProject = try #require(TaskEntity(kind: .project, name: "[[Website]]"))
        let byContext = try #require(TaskEntity(kind: .context, name: "work"))

        try record(
            List {
                scopedRow(row, omitting: nil)
                scopedRow(row, omitting: byProject.scope.baseFilter)
                scopedRow(row, omitting: byContext.scope.baseFilter)
            }
            .listStyle(.inset),
            named: "row-scoped",
            size: Self.rowsSize,
            appearance: appearance
        )
    }

    private func scopedRow(_ row: TaskRowState, omitting: FilterConfig?) -> some View {
        TaskRowView(
            row: row,
            onToggle: {},
            onDelete: {},
            onSchedule: { _ in },
            onScheduleDate: { _ in },
            omitting: omitting
        )
    }

    /// A recurring task that is globally finished, beside one that is not.
    ///
    /// ⚠️ **The case Browse is the only screen that can show.**
    /// `TaskRowState.isCompleted` is *occurrence*-level for a recurring task —
    /// it reads `completeInstances`, never `status` — so a cancelled or done
    /// recurring task used to draw exactly like a live one. Today and Upcoming
    /// filter terminal tasks out, so neither could ever have revealed it.
    ///
    /// What to look at, top to bottom: **cancelled** and **done** recurring
    /// tasks are struck through with dimmed marks and an *empty* checkbox — the
    /// task is retired, this occurrence was never ticked. The third is live and
    /// its occurrence is ticked: not struck, filled box. The fourth is live and
    /// untouched.
    ///
    /// The two channels answer **different** questions, and the third row is
    /// what proves it: strikethrough says *this row is not live work right
    /// now* — true whether the task retired or merely today's occurrence was
    /// ticked — while the box says only *this occurrence is done*. Rows 1 and 2
    /// are struck with an empty box, row 3 is struck with a full one, and the
    /// pair that used to be indistinguishable from row 4 no longer is.
    ///
    /// Cancelled and done deliberately draw alike: a list row spends one
    /// channel on "retired", the status filter is what separates the two
    /// reasons, and the spoken label names whichever applies.
    @Test(
        "a retired recurring task does not draw as live work",
        arguments: SnapshotAppearance.allCases
    )
    func retiredRecurringTasksReadAsRetired(appearance: SnapshotAppearance) throws {
        func row(_ status: TaskStatus, done: Bool) throws -> TaskRowState {
            try TaskRowState(
                task: coreTask(
                    id: "Tasks/\(status)-\(done).md",
                    title: "Water the ferns",
                    status: status,
                    priority: .high,
                    scheduled: SnapshotFixtures.today,
                    recurrence: "FREQ=DAILY",
                    completeInstances: done ? [SnapshotFixtures.today] : [],
                    contexts: ["home"]
                ),
                isPending: false,
                calendar: SnapshotFixtures.calendar,
                text: TaskDateText(locale: Locale(identifier: "en_US"))
            )
        }

        let rows = [
            try row(.cancelled, done: false),
            try row(.done, done: false),
            try row(.open, done: true),
            try row(.open, done: false),
        ]
        try record(
            List(rows) { each in
                TaskRowView(
                    row: each,
                    onToggle: {},
                    onDelete: {},
                    onSchedule: { _ in },
                    onScheduleDate: { _ in }
                )
            }
            .listStyle(.inset),
            named: "row-retired-recurring",
            size: Self.rowsSize,
            appearance: appearance
        )
    }

    private static let screenSize = CGSize(width: 780, height: 560)
    private static let rowsSize = CGSize(width: 560, height: 320)
}
