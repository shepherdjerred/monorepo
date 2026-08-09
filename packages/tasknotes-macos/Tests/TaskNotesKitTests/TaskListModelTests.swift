import Foundation
import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

/// The Today screen's derivation, which is where every date decision lands.
///
/// These run headless because `TaskListModel` has no SwiftUI in it — which is the
/// whole reason the no-UI-imports rule on `TaskNotesKit` is load-bearing rather
/// than tidy. The screen's correctness is asserted here; the screen's
/// *appearance* is the only thing left needing a Mac.
@Suite("Today list")
struct TaskListModelTests {
    /// The filter, clause by clause, against the React Native `todayTasks`
    /// specification.
    @Test("a task belongs on Today when it is due today, overdue, or recurs today")
    func theFilterMatchesTheReferenceScreen() throws {
        let today = fixedCalendar(today: "2026-07-22")
        let tasks = [
            coreTask(id: "due-today.md", due: "2026-07-22"),
            coreTask(id: "overdue.md", due: "2026-07-01"),
            coreTask(id: "due-tomorrow.md", due: "2026-07-23"),
            coreTask(id: "no-date.md"),
            coreTask(id: "done.md", status: .done, due: "2026-07-22"),
            coreTask(id: "cancelled.md", status: .cancelled, due: "2026-07-01"),
            coreTask(id: "archived.md", due: "2026-07-22", archived: true),
            // Recurring and scheduled-only: no due date at all, which is the
            // usual shape and the one a due-date-only filter would hide.
            coreTask(
                id: "daily.md", scheduled: "2026-07-01", recurrence: "FREQ=DAILY"),
            coreTask(
                id: "weekly-other-day.md",
                scheduled: "2026-07-20",
                recurrence: "FREQ=WEEKLY;BYDAY=MO"),
        ]

        let list = try TaskListModel.build(
            section: .today,
            tasks: tasks, pendingTaskIds: [], calendar: today, text: fixedText())

        #expect(list.rows.map(\.id) == ["due-today.md", "overdue.md", "daily.md"])
    }

    @Test("a globally completed recurring task does not reappear each time its rule fires")
    func aCompletedRecurringTaskStaysGone() throws {
        // Checking off an occurrence mutates `completeInstances`, not `status`,
        // so a *live* recurring task stays visible. Marking the task itself
        // done is a different act and must stick.
        // `scheduled` is the *current* occurrence: the TaskNotes plugin
        // advances it as each one is completed, which is what makes the
        // scheduled-occurrence completion rule below coherent.
        let tasks = [
            coreTask(
                id: "live.md", scheduled: "2026-07-22", recurrence: "FREQ=DAILY",
                completeInstances: ["2026-07-22"]),
            coreTask(
                id: "retired.md", status: .done, scheduled: "2026-07-22",
                recurrence: "FREQ=DAILY"),
        ]

        let list = try TaskListModel.build(
            section: .today,
            tasks: tasks, pendingTaskIds: [], calendar: fixedCalendar(), text: fixedText())

        #expect(list.rows.map(\.id) == ["live.md"])
        // And the one that stayed reads as done for today, so the checkbox
        // shows the completion the user just made rather than the row simply
        // vanishing.
        #expect(list.rows.map(\.isCompleted) == [true])
    }

    @Test("the core's order survives the derivation untouched")
    func orderIsNeverResorted() throws {
        let titles = ["zulu", "alpha", "mike", "bravo"]
        let tasks = titles.map {
            coreTask(id: "\($0).md", title: $0, due: "2026-07-22")
        }

        let list = try TaskListModel.build(
            section: .today,
            tasks: tasks, pendingTaskIds: [], calendar: fixedCalendar(), text: fixedText())

        #expect(list.rows.map(\.task.title) == titles)
        #expect(list.rows.map(\.task.title) != titles.sorted())
    }

    @Test("the heading and count read the way the screen says them")
    func theHeadingAndCountAreTheReferenceWording() throws {
        func list(_ tasks: [CoreTask]) throws -> TaskListModel {
            try TaskListModel.build(
                section: .today,
                tasks: tasks, pendingTaskIds: [], calendar: fixedCalendar(), text: fixedText())
        }

        // 2026-07-22 is a Wednesday.
        #expect(try list([]).heading == "Wednesday, July 22")
        #expect(try list([]).countLabel == "No tasks")
        #expect(try list([coreTask(id: "a.md", due: "2026-07-22")]).countLabel == "1 task")
        #expect(
            try list([
                coreTask(id: "a.md", due: "2026-07-22"),
                coreTask(id: "b.md", due: "2026-07-22"),
            ]).countLabel == "2 tasks")
    }

    @Test("a queued command marks its task as pending")
    func pendingIdsReachTheRow() throws {
        let list = try TaskListModel.build(
            section: .today,
            tasks: [
                coreTask(id: "queued.md", due: "2026-07-22"),
                coreTask(id: "settled.md", due: "2026-07-22"),
            ],
            pendingTaskIds: ["queued.md"],
            calendar: fixedCalendar(),
            text: fixedText()
        )

        #expect(list.rows.map(\.isPending) == [true, false])
    }
}

/// The completion resolution — the one piece of this screen that is correctness
/// rather than presentation.
@Suite("Completion targets")
struct CompletionTargetTests {
    @Test("a recurring task completes its scheduled occurrence, not the day of the click")
    func recurringCompletionTargetsTheOccurrence() throws {
        // The rent case: the rule fires on the 1st, it is the 12th. Recording
        // the 12th would orphan the entry against a day the rule never fires
        // on, so the occurrence would still read as open and the task would
        // reappear untouched.
        let task = coreTask(
            id: "rent.md",
            scheduled: "2026-07-01",
            recurrence: "FREQ=MONTHLY;BYMONTHDAY=1")
        let row = try TaskRowState(
            task: task,
            isPending: false,
            calendar: fixedCalendar(today: "2026-07-12"),
            text: fixedText())

        #expect(row.isRecurring)
        #expect(row.completionTarget == "2026-07-01")
        #expect(row.isCompleted == false)
        // ⚠️ The defect this closes: the task has **no due date at all**, so a
        // row printing `due` showed nothing in the one column that explains why
        // it is on screen. The occurrence is that date, it is the date the
        // click writes, and it is late — which is what the row's only red says.
        #expect(row.due == nil)
        #expect(row.displayDate?.date == "2026-07-01")
        #expect(row.occurrence?.text == "Jul 1")
        #expect(row.displayDate?.isOverdue == true)
        guard case .setInstanceComplete(let id, let date, let completed) = row.completionCommand
        else {
            Issue.record("expected a per-occurrence completion, got \(row.completionCommand)")
            return
        }
        #expect(id == "rent.md")
        #expect(date == "2026-07-01")
        #expect(completed)
    }

    @Test("a completion-anchored series targets today instead")
    func completionAnchoredTargetsToday() throws {
        // "N days after each completion" measures from when you finished, so
        // today is the only meaningful target.
        let task = coreTask(
            id: "water.md",
            scheduled: "2026-07-01",
            recurrence: "FREQ=DAILY;INTERVAL=3",
            recurrenceAnchor: .completion)
        let row = try TaskRowState(
            task: task,
            isPending: false,
            calendar: fixedCalendar(today: "2026-07-12"),
            text: fixedText())

        #expect(row.completionTarget == "2026-07-12")
    }

    @Test("the checkbox reads the occurrence the click would target")
    func theCheckboxAndTheGestureAgree() throws {
        // The two must never disagree about which thing they are talking
        // about: the checkbox shows the state of exactly the date the toggle
        // would write.
        let task = coreTask(
            id: "rent.md",
            scheduled: "2026-07-01",
            recurrence: "FREQ=MONTHLY;BYMONTHDAY=1",
            completeInstances: ["2026-07-01"])
        let row = try TaskRowState(
            task: task,
            isPending: false,
            calendar: fixedCalendar(today: "2026-07-12"),
            text: fixedText())

        #expect(row.isCompleted)
        guard case .setInstanceComplete(_, let date, let completed) = row.completionCommand else {
            Issue.record("expected a per-occurrence completion")
            return
        }
        #expect(date == "2026-07-01")
        #expect(completed == false, "an already-completed occurrence toggles back off")
    }

    @Test("a plain task moves status through the core's own toggle policy")
    func plainCompletionMovesStatus() throws {
        func row(_ status: TaskStatus) throws -> TaskRowState {
            try TaskRowState(
                task: coreTask(id: "plain.md", status: status, due: "2026-07-22"),
                isPending: false,
                calendar: fixedCalendar(),
                text: fixedText())
        }

        #expect(try row(.open).isRecurring == false)
        #expect(try row(.open).completionTarget == nil)
        #expect(try row(.open).occurrence == nil)
        #expect(try row(.open).displayDate?.text == "Today", "a plain row shows its due date")
        #expect(try row(.open).isCompleted == false)
        #expect(try row(.done).isCompleted)
        #expect(try row(.cancelled).isCompleted)
        #expect(try row(.waiting).isCompleted == false)

        guard case .setStatus(let id, let status) = try row(.open).completionCommand else {
            Issue.record("expected a status change for a plain task")
            return
        }
        #expect(id == "plain.md")
        #expect(status == .done)
        guard case .setStatus(_, let reopened) = try row(.done).completionCommand else {
            Issue.record("expected a status change for a plain task")
            return
        }
        #expect(reopened == .open)
    }

    @Test("the completion target follows `scheduled`, which the server advances")
    func theTargetFollowsTheAdvancingScheduledField() throws {
        // Worth pinning down because it is the assumption the whole rule rests
        // on and it is invisible in the UI. A recurring task's `scheduled`
        // field is not its start date — the plugin rewrites it to the current
        // occurrence as each one completes — so "the scheduled occurrence" is
        // a live pointer, not a historical one.
        //
        // The consequence, stated plainly so nobody reads it as a bug: a task
        // whose `scheduled` has *not* been advanced targets that stale date,
        // and the React Native app does exactly the same thing. This is parity
        // with the plugin, not an independent decision.
        let stale = try TaskRowState(
            task: coreTask(
                id: "daily.md", scheduled: "2026-07-01", recurrence: "FREQ=DAILY",
                completeInstances: ["2026-07-01"]),
            isPending: false,
            calendar: fixedCalendar(today: "2026-07-22"),
            text: fixedText())
        #expect(stale.completionTarget == "2026-07-01")

        let advanced = try TaskRowState(
            task: coreTask(
                id: "daily.md", scheduled: "2026-07-22", recurrence: "FREQ=DAILY",
                completeInstances: ["2026-07-01"]),
            isPending: false,
            calendar: fixedCalendar(today: "2026-07-22"),
            text: fixedText())
        #expect(advanced.completionTarget == "2026-07-22")
        #expect(advanced.isCompleted == false, "today's occurrence is still open")
    }

    @Test("an empty recurrence string is not a recurring task")
    func anEmptyRuleIsNotARule() throws {
        // A hand-edited vault can carry `recurrence: ""`, and the core reads
        // that as the no-rule case. Treating it as a rule would route the
        // completion through a per-occurrence command with nothing to anchor
        // to.
        let row = try TaskRowState(
            task: coreTask(id: "blank.md", due: "2026-07-22", recurrence: ""),
            isPending: false,
            calendar: fixedCalendar(),
            text: fixedText())

        #expect(row.isRecurring == false)
        #expect(row.completionTarget == nil)
    }
}

/// The date badge: the core decides the bucket, Foundation writes the words.
@Suite("Date badges")
struct DateBadgeTests {
    @Test(
        "each bucket gets the core's own heading or a formatted date",
        arguments: [
            ("2026-07-21", DateGroup.overdue, "Jul 21"),
            ("2026-07-22", DateGroup.today, "Today"),
            ("2026-07-23", DateGroup.tomorrow, "Tomorrow"),
            ("2026-07-25", DateGroup.thisWeek, "Saturday"),
            ("2026-08-20", DateGroup.later, "Aug 20"),
        ])
    func badgesReadCorrectly(stored: String, group: DateGroup, text: String) throws {
        let badge = try #require(
            try DateBadge.of(
                stored: stored, calendar: fixedCalendar(), text: fixedText()))
        #expect(badge.group == group)
        #expect(badge.text == text)
        #expect(badge.isOverdue == (group == .overdue))
    }

    @Test("a value in no recognised shape is no badge rather than a failure")
    func anUnreadableDateIsNoBadge() throws {
        // Frontmatter is whatever a human typed. "There is no usable date
        // here" is a reading, not an error.
        #expect(try DateBadge.of(stored: nil, calendar: fixedCalendar(), text: fixedText()) == nil)
        #expect(
            try DateBadge.of(stored: "someday", calendar: fixedCalendar(), text: fixedText())
                == nil)
    }

    @Test("a zoned instant is bucketed in the viewer's own day")
    func aZonedInstantShiftsIntoTheViewersDay() throws {
        // 02:00 UTC on the 23rd is still the 22nd in UTC-7, so a task carrying
        // it is due *today* for this viewer and not tomorrow. This is the
        // difference the core's `dateParseLocal` exists to get right, and the
        // reason the offset is part of `ViewerCalendar` rather than assumed.
        let badge = try #require(
            try DateBadge.of(
                stored: "2026-07-23T02:00:00Z",
                calendar: fixedCalendar(today: "2026-07-22", utcOffsetSeconds: -25_200),
                text: fixedText()))
        #expect(badge.group == .today)
    }
}

/// Quick add, and the named schedule dates.
@Suite("Task entry")
struct TaskEntryTests {
    @Test("a typed line becomes a create carrying everything the core parsed out of it")
    func quickAddUsesTheCoreParser() throws {
        let command = try #require(
            try QuickAdd.command(
                for: "Pay rent tomorrow", calendar: fixedCalendar(today: "2026-07-22")))
        guard case .create(let payload) = command else {
            Issue.record("expected a create, got \(command)")
            return
        }
        #expect(payload.title == "Pay rent")
        #expect(payload.due == "2026-07-23")
    }

    @Test("an empty line is not a mistake to report")
    func anEmptyLineIsNothing() throws {
        #expect(try QuickAdd.command(for: "   ", calendar: fixedCalendar()) == nil)
        #expect(try QuickAdd.command(for: "", calendar: fixedCalendar()) == nil)
    }

    @Test("the named schedule dates are the core's readings, not seven-day arithmetic")
    func scheduleChoicesUseTheCoreWalks() throws {
        // 2026-07-25 is a Saturday, so "this weekend" is *today* — and "next
        // week" from a Saturday is the coming Monday, two days out rather than
        // seven. Both are Todoist's readings and both are the core's.
        let saturday = fixedCalendar(today: "2026-07-25")
        #expect(try ScheduleChoice.today.date(on: saturday) == "2026-07-25")
        #expect(try ScheduleChoice.tomorrow.date(on: saturday) == "2026-07-26")
        #expect(try ScheduleChoice.thisWeekend.date(on: saturday) == "2026-07-25")
        #expect(try ScheduleChoice.nextWeek.date(on: saturday) == "2026-07-27")
        #expect(try ScheduleChoice.none.date(on: saturday) == nil)

        // From a Wednesday: the weekend is three days out, next week is five.
        let wednesday = fixedCalendar(today: "2026-07-22")
        #expect(try ScheduleChoice.thisWeekend.date(on: wednesday) == "2026-07-25")
        #expect(try ScheduleChoice.nextWeek.date(on: wednesday) == "2026-07-27")
    }

    @Test("tomorrow crosses a month boundary rather than incrementing a day number")
    func tomorrowCrossesBoundaries() throws {
        #expect(
            try ScheduleChoice.tomorrow.date(on: fixedCalendar(today: "2026-07-31"))
                == "2026-08-01")
        #expect(
            try ScheduleChoice.tomorrow.date(on: fixedCalendar(today: "2026-12-31"))
                == "2027-01-01")
        // A leap year, which a naive "+1 to the day" would also get wrong.
        #expect(
            try ScheduleChoice.tomorrow.date(on: fixedCalendar(today: "2028-02-28"))
                == "2028-02-29")
    }

    @Test("clearing a date is a clear, never an unchanged")
    func clearingADateIsExpressible() {
        // The three-state update type is the whole reason a partial edit
        // cannot silently drop a field it did not mention — and the reason
        // "remove the due date" is sayable at all.
        guard case .set(let value) = UpdateTaskRequest.settingDue("2026-07-22").due else {
            Issue.record("expected a set")
            return
        }
        #expect(value == "2026-07-22")
        #expect(UpdateTaskRequest.settingDue(nil).due == .clear)
        #expect(UpdateTaskRequest.settingDue(nil).scheduled == .unchanged)
        #expect(UpdateTaskRequest.settingPriority(.high).due == .unchanged)
        #expect(UpdateTaskRequest.settingPriority(.high).priority == .high)
    }
}

/// The connection banner's copy, which is the only place a sync failure is ever
/// stated.
@Suite("Sync messages")
struct SyncMessageTests {
    private func status(_ state: SyncState, error: CoreError? = nil) -> SyncStatus {
        SyncStatus(state: state, lastError: error, nextRetryAt: nil)
    }

    @Test("a settled, empty queue says nothing at all")
    func silenceIsTheCommonCase() {
        #expect(
            SyncMessage.of(status: status(.idle), pendingCount: 0, storeError: nil) == nil)
        // Silent while a pass runs: the toolbar control already shows it, and
        // two indicators for one fact is noise.
        #expect(
            SyncMessage.of(status: status(.syncing), pendingCount: 3, storeError: nil) == nil)
    }

    @Test("a failed pass is a banner carrying the engine's own message")
    func aFailureBecomesABanner() throws {
        let message = try #require(
            SyncMessage.of(
                status: status(.backoff, error: .Connection(message: "connection refused")),
                pendingCount: 2,
                storeError: nil))
        #expect(message.tone == .degraded)
        #expect(message.title == "2 changes waiting to sync")
        #expect(message.detail == "connection refused")
        #expect(message.remedy == .retry)
    }

    @Test("a queue the engine is already draining offers nothing and alarms nobody")
    func aDrainingQueueIsInformationOnly() throws {
        // The defect this pins: an idle engine with queued work will drain that
        // work on its own, so a **Try Again** button here teaches that manual
        // retry is part of the normal loop. It is not, and the lesson would be
        // copied onto every remaining screen.
        let message = try #require(
            SyncMessage.of(status: status(.idle), pendingCount: 3, storeError: nil))
        #expect(message.tone == .informational)
        #expect(message.remedy == .none)
        #expect(message.detail == nil)
    }

    @Test("severity separates what the user must fix from what fixes itself")
    func toneTracksWhoHasToAct() throws {
        func tone(_ message: SyncMessage?) throws -> SyncMessage.Tone {
            try #require(message).tone
        }

        // Offline is transient and already being retried; an unconfigured
        // server is not going to configure itself. Drawing them identically —
        // which one shared `.failure` tone did — told the reader nothing about
        // which of the two was theirs to deal with.
        #expect(
            try tone(
                SyncMessage.of(
                    status: status(.backoff, error: .Connection(message: "refused")),
                    pendingCount: 1,
                    storeError: nil)) == .degraded)
        #expect(
            try tone(
                SyncMessage.of(
                    status: status(.unconfigured), pendingCount: 0, storeError: nil))
                == .attention)
        #expect(
            try tone(SyncMessage.of(status: status(.authError), pendingCount: 0, storeError: nil))
                == .attention)
    }

    @Test("every tone has its own glyph, so colour is never the only channel")
    func glyphsAreDistinctPerTone() throws {
        // Built through `of` rather than the initializer, because the point is
        // that the three tones a store can actually produce are distinguishable
        // without seeing colour at all.
        let messages = try [
            #require(SyncMessage.of(status: status(.idle), pendingCount: 3, storeError: nil)),
            #require(
                SyncMessage.of(
                    status: status(.backoff, error: .Connection(message: "refused")),
                    pendingCount: 1,
                    storeError: nil)),
            #require(
                SyncMessage.of(status: status(.unconfigured), pendingCount: 0, storeError: nil)),
        ]
        #expect(Set(messages.map(\.tone)).count == 3)
        #expect(Set(messages.map(\.systemImage)).count == 3)
    }

    @Test("a local failure wins over the engine's, because it is the actionable one")
    func aLocalFailureTakesPrecedence() throws {
        let message = try #require(
            SyncMessage.of(
                status: status(.backoff, error: .Network(message: "offline")),
                pendingCount: 1,
                storeError: .Validation(message: "that is not a date")))
        #expect(message.detail == "that is not a date")
    }

    @Test("an unconfigured engine points at Settings rather than blaming the network")
    func anUnconfiguredEngineSaysSo() throws {
        let message = try #require(
            SyncMessage.of(status: status(.unconfigured), pendingCount: 0, storeError: nil))
        #expect(message.title == "No server configured")
        // A retry cannot help when there is nothing to retry against; the
        // remedy is the window where the address is entered.
        #expect(message.remedy == .openSettings)
    }

    @Test("an HTTP status is shown, and an envelope failure's zero is not")
    func errorMessagesReadForAHuman() {
        #expect(CoreError.Api(message: "boom", status: 503).userMessage == "boom (HTTP 503)")
        #expect(CoreError.Api(message: "boom", status: 0).userMessage == "boom")
        #expect(
            CoreError.NotFound(message: "task not found: a.md").userMessage
                == "task not found: a.md")
    }
}
