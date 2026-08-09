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

    private static let screenSize = CGSize(width: 780, height: 560)
    private static let rowsSize = CGSize(width: 560, height: 320)
}
