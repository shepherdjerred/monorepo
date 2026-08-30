import Testing

import struct Foundation.Locale

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

/// What the inspector shows, and what it refuses to claim.
@Suite("Task detail")
struct TaskDetailTests {
    @Test("both dates are shown, not just the one a row has room for")
    func bothDates() throws {
        let task = detailTask(
            id: "Tasks/A.md", title: "A", due: "2026-07-24", scheduled: "2026-07-20")
        let detail = try TaskDetail.build(row: try detailRow(task), calendar: detailCalendar)
        #expect(detail.due?.date == "2026-07-24")
        #expect(detail.scheduled?.date == "2026-07-20")
        #expect(detail.scheduled?.isOverdue == true)
    }

    @Test("the labels are the core's, so both clients say the same words")
    func labelsAreTheCores() throws {
        let task = detailTask(id: "Tasks/A.md", title: "A", status: .inProgress, priority: .highest)
        let detail = try TaskDetail.build(row: try detailRow(task), calendar: detailCalendar)
        #expect(detail.statusText == taskStatusLabel(status: .inProgress))
        #expect(detail.priorityText == priorityLabel(priority: .highest))
    }

    @Test("the note body is parsed")
    func bodyParsed() throws {
        let task = detailTask(id: "Tasks/A.md", title: "A", details: "# Notes\n\nbody\n")
        let detail = try TaskDetail.build(row: try detailRow(task), calendar: detailCalendar)
        #expect(detail.body.blocks.count == 2)
    }

    @Test("a task with no body has an empty one")
    func emptyBody() throws {
        let detail = try TaskDetail.build(
            row: try detailRow(detailTask(id: "Tasks/A.md", title: "A")),
            calendar: detailCalendar
        )
        #expect(detail.body.isEmpty)
    }

    /// An estimate reads as a duration, not as a clock.
    ///
    /// The core's `elapsedFormat` would render 90 minutes as `1:30:00`, which is
    /// a video length. Sharing that function would be sharing a spelling rather
    /// than a meaning, so the shell formats it — the same split the plan already
    /// applies to dates.
    @Test("a time estimate is spelled as a duration")
    func estimateSpelled() throws {
        let task = detailTask(id: "Tasks/A.md", title: "A", timeEstimate: 90)
        let detail = try TaskDetail.build(
            row: try detailRow(task),
            calendar: detailCalendar,
            duration: TaskDurationText(locale: Locale(identifier: "en_US"))
        )
        let spelled = try #require(detail.timeEstimateText)
        #expect(spelled.contains("1"))
        #expect(spelled.contains("30"))
        #expect(!spelled.contains(":"))
    }

    @Test("no estimate has no words")
    func noEstimate() throws {
        let detail = try TaskDetail.build(
            row: try detailRow(detailTask(id: "Tasks/A.md", title: "A")),
            calendar: detailCalendar
        )
        #expect(detail.timeEstimateText == nil)
    }
}

/// The recurrence row's projection from the shared core.
@Suite("Recurrence summary")
struct RecurrenceSummaryTests {
    @Test("a task that does not repeat has no summary")
    func noRule() throws {
        #expect(
            try RecurrenceSummary.of(
                task: detailTask(id: "Tasks/A.md", title: "A"), calendar: detailCalendar) == nil
        )
    }

    /// An empty rule is not a rule.
    ///
    /// The core reads `Some("")` as the no-rule case. Treating it as a rule is a
    /// mistake that only shows up on tasks somebody edited by hand in the vault.
    @Test("an empty rule string is not a rule")
    func emptyRule() throws {
        let task = detailTask(id: "Tasks/A.md", title: "A", recurrence: "")
        #expect(try RecurrenceSummary.of(task: task, calendar: detailCalendar) == nil)
    }

    /// The rule is carried verbatim **and** described, and the sentence is the
    /// core's.
    ///
    /// The literal here is the assertion that matters: `INTERVAL` and `BYDAY`
    /// are exactly the parts a sentence assembled in Swift from `Frequency`
    /// alone would have dropped, printing "Weekly" over a rule that fires every
    /// other Tuesday. It fails the moment anything on this side starts
    /// paraphrasing.
    @Test("the rule is carried verbatim and described by the core")
    func ruleVerbatim() throws {
        let rule = "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"
        let task = detailTask(
            id: "Tasks/A.md", title: "A", scheduled: "2026-07-20", recurrence: rule)
        let summary = try #require(
            try RecurrenceSummary.of(task: task, calendar: detailCalendar))
        #expect(summary.rule == rule)
        #expect(summary.description == "Every 2 weeks on Mon, Wed")
    }

    /// A rule the core will not describe leaves ``RecurrenceSummary/description``
    /// absent, which the panel draws as the raw `RRULE`.
    ///
    /// `nil` means *show the rule*, matching `recurrenceFrequency`, and a wrong
    /// summary is strictly worse than none: `BYDAY` crossed with `BYMONTHDAY` is
    /// an intersection — Friday the 13th — that a comma-joined list would
    /// misread as a union.
    @Test("a rule with no honest sentence falls back to the raw rule")
    func undescribableRule() throws {
        let rule = "FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13"
        let task = detailTask(
            id: "Tasks/A.md", title: "A", scheduled: "2026-07-20", recurrence: rule)
        let summary = try #require(
            try RecurrenceSummary.of(task: task, calendar: detailCalendar))
        #expect(summary.description == nil)
        #expect(summary.rule == rule)
    }

    /// An endless rule says so **by omission**, in one place rather than two.
    ///
    /// ⚠️ This used to expect `"Repeats indefinitely"`, and that string was
    /// wrong in three of the four situations `recurrenceFiniteInstanceCount`
    /// answers `nil` for. Once the core's sentence arrived it became a visible
    /// contradiction rather than a latent one — see
    /// ``noCountBeatsTheSummary`` below.
    @Test("an endless rule says so in its sentence, not in a second clause")
    func endlessRule() throws {
        let task = detailTask(
            id: "Tasks/A.md", title: "A", scheduled: "2026-07-20", recurrence: "FREQ=DAILY")
        let summary = try #require(
            try RecurrenceSummary.of(task: task, calendar: detailCalendar))
        #expect(summary.description == "Every day")
        #expect(summary.finiteInstanceCount == nil)
        #expect(summary.occurrenceDescription == nil)
    }

    /// The two core functions disagree, and the panel now sides with the
    /// accurate one.
    ///
    /// `FREQ=DAILY;COUNT=abc` fires **exactly once** — the expansion decrements
    /// a non-numeric `COUNT` to `NaN` and stops — while
    /// `recurrenceFiniteInstanceCount` reads `COUNT` with a digits-only regex
    /// and gives up. Both answers are the reference's, pinned by
    /// `@tasknotes/fixtures` as `finiteInstanceCount: null` beside
    /// `occurrenceCount: 1`, so neither is a porting defect and neither can be
    /// moved without moving a third-party package. What the panel must not do
    /// is print both readings at once, which is what "Repeats indefinitely"
    /// beside "Every day, once" was.
    @Test("where the count and the summary disagree, only the summary is drawn")
    func noCountBeatsTheSummary() throws {
        let task = detailTask(
            id: "Tasks/A.md",
            title: "A",
            scheduled: "2026-07-20",
            recurrence: "FREQ=DAILY;COUNT=abc"
        )
        let summary = try #require(
            try RecurrenceSummary.of(task: task, calendar: detailCalendar))
        #expect(summary.description == "Every day, once")
        #expect(summary.finiteInstanceCount == nil, "the reference's answer, reproduced")
        #expect(
            summary.occurrenceDescription == nil,
            "and drawn as nothing rather than as a contradiction")
    }

    /// A `COUNT` is one of the parts a Swift-side summary would have dropped,
    /// and it comes straight from the core.
    @Test("a counted rule reports its occurrences")
    func countedRule() throws {
        let task = detailTask(
            id: "Tasks/A.md",
            title: "A",
            scheduled: "2026-07-20",
            recurrence: "FREQ=DAILY;COUNT=5"
        )
        let summary = try #require(
            try RecurrenceSummary.of(task: task, calendar: detailCalendar))
        #expect(summary.finiteInstanceCount == 5)
        #expect(summary.occurrenceDescription == "5 occurrences")
    }

    /// The next occurrence skips what is already done.
    ///
    /// From `recurrenceNextUncompletedOccurrence`, which accounts for
    /// `completeInstances` and `skippedInstances` — a naive "next date after
    /// today" would not, and would tell the user to do something they finished.
    @Test("the next occurrence skips completed ones")
    func nextSkipsCompleted() throws {
        let task = detailTask(
            id: "Tasks/A.md",
            title: "A",
            scheduled: "2026-07-20",
            recurrence: "FREQ=DAILY",
            completeInstances: ["2026-07-22"]
        )
        let summary = try #require(
            try RecurrenceSummary.of(task: task, calendar: detailCalendar))
        #expect(summary.next?.date != "2026-07-22")
    }

    /// An absent anchor reads as `scheduled`, which is the core's own
    /// documented reading rather than a default invented here — and the panel
    /// says it is implied so the picker does not look like a choice somebody
    /// made.
    @Test("an absent anchor is the core's reading, and is marked as implied")
    func impliedAnchor() throws {
        let task = detailTask(
            id: "Tasks/A.md", title: "A", scheduled: "2026-07-20", recurrence: "FREQ=DAILY")
        let summary = try #require(
            try RecurrenceSummary.of(task: task, calendar: detailCalendar))
        #expect(summary.anchor == .scheduled)
        #expect(summary.anchorIsImplied)
    }

    @Test("a stored anchor is not implied")
    func storedAnchor() throws {
        let task = detailTask(
            id: "Tasks/A.md",
            title: "A",
            scheduled: "2026-07-20",
            recurrence: "FREQ=DAILY",
            recurrenceAnchor: .completion
        )
        let summary = try #require(
            try RecurrenceSummary.of(task: task, calendar: detailCalendar))
        #expect(summary.anchor == .completion)
        #expect(!summary.anchorIsImplied)
    }

    /// The engine fails open, so an unreadable rule keeps the task visible. The
    /// panel has to say the rule is broken, or that looks like it working.
    @Test("an unreadable rule is reported rather than hidden")
    func unreadableRule() throws {
        let task = detailTask(
            id: "Tasks/A.md", title: "A", scheduled: "2026-07-20", recurrence: "NONSENSE")
        let summary = try #require(
            try RecurrenceSummary.of(task: task, calendar: detailCalendar))
        #expect(!summary.isExpandable)
    }

    /// Stopping is a `clear`, and it touches nothing else.
    ///
    /// It is the one recurrence edit safe to offer without a rule summary,
    /// because it constructs no rule. The anchor is deliberately left alone —
    /// clearing two frontmatter keys for one gesture is more than was asked.
    @Test("stopping a repetition clears only the rule")
    func stopRepeating() {
        let payload = RecurrenceSummary.stopRepeating.payload
        #expect(payload.recurrence == .clear)
        #expect(payload.recurrenceAnchor == .unchanged)
    }
}

/// The vault's own vocabulary, for token completion.
@Suite("Task vocabulary")
struct TaskVocabularyTests {
    /// First-appearance order, never sorted.
    ///
    /// Sorting would mean collation, which the plan parks deliberately — the
    /// core's `compareTitles` approximates `localeCompare` and diverges on
    /// accents. A Swift-side sort here would be a third ordering agreeing with
    /// neither.
    @Test("names come out in first-appearance order")
    func firstAppearanceOrder() {
        let vocabulary = TaskVocabulary.of(tasks: [
            detailTask(id: "1", title: "1", projects: ["Zebra"], contexts: ["work"], tags: ["b"]),
            detailTask(id: "2", title: "2", projects: ["Apple"], contexts: ["home"], tags: ["a"]),
        ])
        #expect(vocabulary.projects == ["Zebra", "Apple"])
        #expect(vocabulary.contexts == ["work", "home"])
        #expect(vocabulary.tags == ["b", "a"])
    }

    /// A wikilink and its bare name are one project, and only the core knows
    /// that. String equality would offer both and let the user create a second
    /// spelling of something that already exists.
    @Test("a wikilink and its display name are one project")
    func wikilinkDedupe() {
        let vocabulary = TaskVocabulary.of(tasks: [
            detailTask(id: "1", title: "1", projects: ["[[Projects/Website|the site]]"]),
            detailTask(id: "2", title: "2", projects: ["Website"]),
        ])
        #expect(vocabulary.projects == ["[[Projects/Website|the site]]"])
    }

    @Test("adding a project already present by another spelling changes nothing")
    func addingCoveredProject() {
        let current = ["[[Projects/Website|the site]]"]
        #expect(TaskVocabulary.adding(project: "Website", to: current) == current)
    }

    @Test("adding a new project appends it")
    func addingNewProject() {
        #expect(TaskVocabulary.adding(project: "Admin", to: ["Website"]) == ["Website", "Admin"])
    }

    @Test("an empty vault has an empty vocabulary")
    func emptyVault() {
        #expect(TaskVocabulary.of(tasks: []) == TaskVocabulary.empty)
    }
}
