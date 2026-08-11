import Foundation
import TaskNotesKit
import TaskNotesUniFFI
import Testing

@testable import TaskNotesMac

/// The one date clause a row and a card both speak.
///
/// ⚠️ **The drawn date is `accessibilityHidden`.** A VoiceOver reader gets the
/// row's synthesized label and nothing else, so the word in front of the date
/// is the reader's only statement of *which* date it is — and the label used to
/// say "due" for every non-recurring row, including the ones whose date came
/// from `scheduled`. That announced a deadline the vault never recorded, on
/// exactly the rows Today and Upcoming admit for planned work.
///
/// These assert the clause rather than a rendered image because a snapshot
/// cannot see it: the text is hidden from the accessibility tree on purpose,
/// which is what let the defect through the board and list snapshots.
@Suite("A row's spoken date")
@MainActor
struct SpokenRowDateTests {
    private static let text = TaskDateText(locale: Locale(identifier: "en_US"))

    private func row(
        due: String? = nil,
        scheduled: String? = nil,
        recurrence: String? = nil
    ) throws -> TaskRowState {
        try TaskRowState(
            task: coreTask(
                id: "Tasks/water-the-ferns.md",
                title: "Water the ferns",
                due: due,
                scheduled: scheduled,
                recurrence: recurrence
            ),
            isPending: false,
            calendar: SnapshotFixtures.calendar,
            text: Self.text
        )
    }

    /// The defect, in one assertion.
    @Test("planned work is announced as scheduled, never as due")
    func scheduledOnly() throws {
        #expect(try row(scheduled: SnapshotFixtures.today).spokenDate == "scheduled Today")
    }

    @Test("a deadline is announced as due")
    func dueOnly() throws {
        #expect(try row(due: SnapshotFixtures.today).spokenDate == "due Today")
    }

    /// The word and the date are one answer, so the clause cannot name the
    /// field of one badge and print the text of another.
    @Test("a task with both dates speaks the due one, and says so")
    func duePrecedesScheduled() throws {
        let both = try row(due: SnapshotFixtures.today, scheduled: "2026-07-23")
        #expect(both.spokenDate == "due Today")
        #expect(both.displayDate == both.due)
    }

    /// A recurring task is usually `scheduled`-only, and its date is still the
    /// occurrence the checkbox acts on — not a plan, and not a deadline.
    @Test("a recurring task speaks its occurrence")
    func recurring() throws {
        let repeating = try row(scheduled: SnapshotFixtures.today, recurrence: "FREQ=DAILY")
        #expect(repeating.spokenDate == "occurrence of Today")
    }

    @Test("a task with no date says nothing about one")
    func undated() throws {
        #expect(try row().spokenDate == nil)
    }
}
