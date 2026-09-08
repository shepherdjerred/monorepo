import Foundation
import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

/// A newline in a title, which would be a newline in a vault *filename*.
///
/// A task's id **is** its path, and the core's `TaskTitle::parse` rejects only
/// the empty string — so nothing below the UI stops a title carrying `\n` from
/// becoming part of a filename. Both ways a title can be typed therefore have
/// to close it themselves, and these pin that they do it the *same* way.
@Suite("Title hygiene")
struct TaskTitleHygieneTests {
    @Test("quick add flattens an embedded newline rather than truncating at it")
    func theComposeRowCannotProduceANewlineTitle() throws {
        // The compose row is safe for a reason that is easy to miss: it does
        // not sanitize anything, `parse_task_input` does — it normalizes
        // whitespace, so the text after the break is **kept**, joined by a
        // space. Worth a test because the alternative failure is silent and
        // lossy: a parser that split on the first line would drop half of what
        // the user pasted and still produce a perfectly valid-looking task.
        let command = try #require(
            try QuickAdd.command(
                for: "Pay rent\nand call the landlord", calendar: fixedCalendar()))
        guard case .create(let payload) = command else {
            Issue.record("expected a create, got \(command)")
            return
        }
        #expect(payload.title == "Pay rent and call the landlord")
    }

    @Test("the core itself does not guard a title, which is why the shells must")
    func theCoreAcceptsANewlineInATitle() throws {
        // Through `updateTaskRequestFromJson`, so the assertion lands on the
        // core's own `TaskTitle::parse` rather than on a Swift struct literal
        // that validates nothing. It **succeeds**, and that is the finding:
        // the only rule is non-empty, so a newline is a perfectly good title
        // all the way down to the point where it becomes a filename.
        //
        // `PlainTextField(wraps:)` flattens line breaks on the way in —
        // including pasted ones, which never reach `insertNewline(_:)` —
        // because this is what happens if it does not.
        let parsed = try updateTaskRequestFromJson(
            json: #"{"title": "Pay rent\nand call"}"#)
        #expect(parsed.title == "Pay rent\nand call")

        // The one thing it does reject, for contrast.
        #expect(throws: (any Error).self) {
            try updateTaskRequestFromJson(json: #"{"title": ""}"#)
        }
    }
}
