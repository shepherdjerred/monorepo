import Foundation
import TaskNotesKit
import TaskNotesUniFFI
import Testing

/// What the floating panel promises, against what it would create.
///
/// The assertions worth having here are not "the parser works" — that is the
/// core's own corpus, in Rust, and re-testing it in Swift would be testing the
/// FFI twice. They are that the **preview and the create command agree**. The
/// panel closes on Return over another application, so the strip is the only
/// account the user ever gets of what was made; a preview that said "Tomorrow"
/// while the command carried nothing would be invisible until somebody went
/// looking for a task that was not there.
@Suite("The quick-add preview")
struct QuickAddPreviewTests {
    private let calendar = fixedCalendar()
    private let text = fixedText()

    @Test("a blank line previews nothing and creates nothing")
    func blank() throws {
        for input in ["", "   ", "\n\t "] {
            let preview = try QuickAddPreview.of(input, calendar: calendar, text: text).get()
            #expect(preview.title.isEmpty)
            #expect(preview.marks.isEmpty)
            #expect(!preview.isSubmittable)
            #expect(try QuickAdd.command(for: input, calendar: calendar) == nil)
        }
    }

    @Test("a plain line is a title and nothing else")
    func plain() throws {
        let preview = try QuickAddPreview.of("Buy milk", calendar: calendar, text: text).get()
        #expect(preview.title == "Buy milk")
        #expect(preview.marks.isEmpty)
        #expect(preview.isSubmittable)
    }

    /// The line from the phase brief, end to end.
    @Test("every recognised token becomes a mark")
    func everyToken() throws {
        let preview = try QuickAddPreview.of(
            "Fix bug !high p:Project @context tomorrow",
            calendar: calendar,
            text: text
        ).get()

        #expect(preview.title == "Fix bug")
        #expect(preview.marks.map(\.text) == ["Tomorrow", "P2", "Project", "context"])
    }

    /// The reading order is fixed, not the order the user typed in.
    @Test("marks are ordered date, priority, projects, contexts, tags")
    func readingOrder() throws {
        let preview = try QuickAddPreview.of(
            "Write it up #docs @work p:Website !low today",
            calendar: calendar,
            text: text
        ).get()

        #expect(preview.marks.map(\.text) == ["Today", "P4", "Website", "work", "docs"])
    }

    /// The one assertion this file exists for.
    @Test("the preview and the create command carry the same values")
    func previewMatchesCommand() throws {
        let input = "Renew the domain !highest p:Admin @home #annual tomorrow"
        let preview = try QuickAddPreview.of(input, calendar: calendar, text: text).get()
        let command = try #require(try QuickAdd.command(for: input, calendar: calendar))

        guard case .create(let payload) = command else {
            Issue.record("quick add produced \(command) rather than a create")
            return
        }

        #expect(payload.title == preview.title)
        #expect(payload.priority == .highest)
        #expect(payload.projects == ["Admin"])
        #expect(payload.contexts == ["home"])
        #expect(payload.tags == ["annual"])

        // The date the command carries is the date the strip printed, reached
        // from the other end: the badge holds the civil date it worded.
        let due = try #require(preview.marks.compactMap(dueBadge).first)
        #expect(payload.due == due.date)
        #expect(due.text == "Tomorrow")
    }

    /// Nothing the parser produces is ever late, and the strip has to agree.
    ///
    /// Every date phrase the core recognises resolves to today or later — a
    /// weekday is "strictly in the future", `next week` is next Monday — so a
    /// quick-add line cannot create an overdue task. The assertion is that the
    /// badge the panel draws says the same thing, because ``QuickAddMarkView``
    /// spends red on `isOverdue` and red in this app means *late* and nothing
    /// else. A badge that mis-bucketed would put the app's one alarm colour on a
    /// task that is not even due yet.
    @Test(
        "no recognised date previews as late",
        arguments: ["today", "tomorrow", "next week", "this weekend", "in 3 days", "friday"]
    )
    func neverOverdue(phrase: String) throws {
        let preview = try QuickAddPreview.of(
            "Chase the invoice \(phrase)",
            calendar: calendar,
            text: text
        ).get()
        let badge = try #require(preview.marks.compactMap(dueBadge).first)
        #expect(!badge.isOverdue, "\(phrase) resolved to \(badge.date), which is in the past")
        #expect(badge.date >= calendar.today)
    }

    /// Tokens with no title left over are not a task.
    @Test("a line of nothing but tokens is not submittable")
    func tokensOnly() throws {
        let preview = try QuickAddPreview.of("!high @home", calendar: calendar, text: text).get()
        #expect(preview.title.isEmpty)
        #expect(!preview.isSubmittable)
        #expect(preview.marks.map(\.text) == ["P2", "home"])
    }

    /// A mark's spoken form is a sentence, not a bare word out of context.
    @Test("every mark speaks what it means")
    func spoken() throws {
        let preview = try QuickAddPreview.of(
            "Ship it !medium p:Website @work #release tomorrow",
            calendar: calendar,
            text: text
        ).get()

        #expect(
            preview.marks.map(\.spoken) == [
                "Due Tomorrow",
                "P3 priority",
                "Project Website",
                "Context work",
                "Tag release",
            ]
        )
    }

    /// Identifiers have to be distinct or `ForEach` silently draws one chip.
    @Test("marks of the same text in different kinds have different ids")
    func distinctIdentifiers() throws {
        let preview = try QuickAddPreview.of(
            "Plan it p:work @work #work",
            calendar: calendar,
            text: text
        ).get()
        #expect(Set(preview.marks.map(\.id)).count == preview.marks.count)
    }

    private func dueBadge(_ mark: QuickAddMark) -> DateBadge? {
        switch mark.kind {
        case .due(let badge): badge
        case .priority, .project, .context, .tag, .recurrence: nil
        }
    }
}
