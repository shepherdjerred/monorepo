import Foundation
import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

/// The Today screen's three gestures, driven exactly as the view drives them,
/// against a real `tasknotes-server` over a real vault.
///
/// What this proves that the unit tests cannot: the command the screen builds
/// is the command the server applies, and the bytes that end up in the vault
/// are the ones a user would see in Obsidian. Everything in between — the
/// queue, the transport, the wire layer in Rust, the server's own frontmatter
/// writer — is real.
///
/// Serialized because each case spawns a server process.
@Suite("Today, end to end", .serialized)
@MainActor
struct TodayFlowTests {
    @Test("a task created from the compose field reaches the vault as markdown")
    func quickAddReachesTheVault() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let directory = try TemporaryDirectory()
        let store = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))
        let calendar = fixedCalendar(today: "2026-07-22")

        store.migrate()
        store.configure(serverURL: server.baseURL)

        // Exactly what pressing Return in the compose row does.
        let command = try #require(
            try QuickAdd.command(for: "Pay rent tomorrow !high", calendar: calendar))
        store.dispatch(command)
        await store.sync()

        #expect(try server.markdownFiles() == ["Pay rent.md"])
        let markdown = try server.contents(of: "Pay rent.md")
        #expect(markdown.contains("Pay rent"))
        #expect(markdown.contains("due: '2026-07-23'") || markdown.contains("due: 2026-07-23"))
        #expect(markdown.contains("priority: high"))
        #expect(store.pendingCount == 0)
    }

    /// The assertion this whole phase exists for.
    @Test("completing a recurring task records the scheduled occurrence, not the day of the click")
    func recurringCompletionLandsOnTheScheduledOccurrence() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let directory = try TemporaryDirectory()
        let store = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))

        store.migrate()
        store.configure(serverURL: server.baseURL)

        // A day far from any 1st, so "the day of the click" and "the scheduled
        // occurrence" can never coincide by luck.
        let clickDay = "2026-07-12"
        let calendar = fixedCalendar(today: clickDay)
        let occurrenceHint = "2026-07-01"

        store.dispatch(
            .create(
                payload: recurringRequest(
                    title: "Pay rent",
                    scheduled: occurrenceHint,
                    recurrence: "FREQ=MONTHLY;BYMONTHDAY=1")))
        await store.sync()

        let created = try #require(store.tasks.first)

        // ⚠️ Read the occurrence back rather than asserting the date the create
        // requested. The **server advances `scheduled` to the next occurrence**
        // — a task created with `scheduled: 2026-07-01` on a `BYMONTHDAY=1`
        // rule comes back scheduled for the next 1st after the server's own
        // today. That is the plugin's behaviour, it is the reason "the
        // scheduled occurrence" is a live pointer rather than a start date, and
        // hard-coding a date here would make this test a calendar bomb.
        let occurrence = String(try #require(created.scheduled).prefix(10))
        #expect(occurrence != clickDay, "the fixture must not accidentally click on the occurrence")

        let row = try TaskRowState(
            task: created, isPending: false, calendar: calendar, text: fixedText())
        #expect(row.isRecurring)
        #expect(
            row.completionTarget == occurrence,
            "the target is the scheduled occurrence, not the day of the click")

        // The gesture, verbatim.
        store.dispatch(row.completionCommand)
        await store.sync()

        let markdown = try server.contents(of: "Pay rent.md")
        #expect(
            markdown.contains(occurrence),
            "the scheduled occurrence must be the one recorded:\n\(markdown)")
        #expect(
            !markdown.contains(clickDay),
            "the day of the click must not appear anywhere:\n\(markdown)")

        // The occurrence is recorded and the task itself stays open, so the
        // series continues. That pair is the whole point of per-occurrence
        // completion.
        let settled = try #require(store.tasks.first)
        #expect(settled.completeInstances == [occurrence])
        #expect(settled.status == .open)

        // ⚠️ And the server has now advanced `scheduled` past the occurrence
        // that was just completed. Measured, not assumed — and it is the reason
        // the row derived *after* the round trip points at the **next**
        // occurrence and reads as open again.
        let advanced = String(try #require(settled.scheduled).prefix(10))
        #expect(advanced > occurrence, "the server moves `scheduled` on to the next occurrence")
        let after = try TaskRowState(
            task: settled, isPending: false, calendar: calendar, text: fixedText())
        #expect(after.completionTarget == advanced)
        #expect(after.isCompleted == false)
    }

    /// The consequence of the advance above, on the screen where it is visible.
    ///
    /// This pins a wart rather than celebrating one. A **daily** task completed
    /// today has its `scheduled` moved to tomorrow by the server, so the row —
    /// which stays on Today because the *rule* still fires today — re-derives
    /// against tomorrow's occurrence and its checkbox pops back to unchecked
    /// once the round trip lands.
    ///
    /// It is inherited, not introduced: `completionTargetDate` in the React
    /// Native app reads the same field and gets the same answer, which is why
    /// that app puts an Undo toast on this exact gesture and calls it "the one
    /// tap that's hard to reverse by hand". Diverging unilaterally would break
    /// the parity the shared core exists to guarantee, so the behaviour is
    /// asserted here and reported upward instead.
    @Test("a completed daily occurrence re-derives against tomorrow once the server answers")
    func aDailyOccurrenceAdvancesUnderTheRow() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let directory = try TemporaryDirectory()
        let store = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))

        store.migrate()
        store.configure(serverURL: server.baseURL)

        // The machine's real today, because the *server* resolves the rule and
        // advances the field against its own clock; a pinned date here would
        // ask the server about a day it does not think it is.
        let calendar = store.viewerCalendar()
        store.dispatch(
            .create(
                payload: recurringRequest(
                    title: "Stand-up", scheduled: calendar.today, recurrence: "FREQ=DAILY")))
        await store.sync()

        let created = try #require(store.tasks.first)
        let occurrence = String(try #require(created.scheduled).prefix(10))
        #expect(occurrence == calendar.today)

        // On its own day the row is on Today and reads as open.
        let before = try TaskListModel.build(
            section: .today,
            tasks: store.tasks, pendingTaskIds: [], calendar: calendar, text: fixedText())
        let row = try #require(before.rows.first)
        #expect(row.completionTarget == occurrence)
        #expect(row.isCompleted == false)

        // Optimistically, the completion is immediately visible — which is the
        // feedback the touch app describes as "felt".
        store.dispatch(row.completionCommand)
        let optimistic = try TaskListModel.build(
            section: .today,
            tasks: store.tasks, pendingTaskIds: store.pendingTaskIds, calendar: calendar,
            text: fixedText())
        #expect(optimistic.rows.first?.isCompleted == true)
        #expect(optimistic.rows.first?.isPending == true)

        await store.sync()

        // After the round trip the row is still on Today, because the rule
        // still fires today — but it now describes tomorrow's occurrence.
        let after = try TaskListModel.build(
            section: .today,
            tasks: store.tasks, pendingTaskIds: [], calendar: calendar, text: fixedText())
        let settled = try #require(after.rows.first)
        #expect(settled.task.completeInstances == [occurrence])
        #expect(settled.completionTarget != occurrence, "the server advanced `scheduled`")
        #expect(settled.isCompleted == false)
    }

    @Test("work done offline is queued, banners, and survives a relaunch")
    func offlineWorkSurvives() async throws {
        let directory = try TemporaryDirectory()
        let unreachable = try #require(URL(string: "http://127.0.0.1:9"))
        let calendar = fixedCalendar(today: "2026-07-22")

        // A first "launch" pointed at nothing that answers.
        do {
            let store = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))
            store.migrate()
            store.configure(serverURL: unreachable)

            // "today" is parsed off by the core and becomes the due date,
            // which is what puts the row on this screen at all.
            let command = try #require(
                try QuickAdd.command(for: "Written while offline today", calendar: calendar))
            store.dispatch(command)

            // Optimistic and immediate: the row is on screen before the network
            // is even attempted, and it is marked as not yet synced.
            let list = try TaskListModel.build(
                section: .today,
                tasks: store.tasks,
                pendingTaskIds: store.pendingTaskIds,
                calendar: calendar,
                text: fixedText())
            #expect(list.rows.map(\.task.title) == ["Written while offline"])
            #expect(list.rows.map(\.isPending) == [true])

            await store.sync()

            // A banner, not an exception. `sync()` did not throw; the engine
            // recorded the failure and the screen states it.
            let message = try #require(
                SyncMessage.of(
                    status: store.status,
                    pendingCount: store.pendingCount,
                    storeError: store.lastStoreError))
            #expect(message.tone == .degraded)
            #expect(message.title == "1 change waiting to sync")
            #expect(message.remedy == .retry)
            #expect(store.status.state == .backoff)
            #expect(store.pendingCount == 1)
            store.shutdown()
        }

        // A second "launch" over the same container, now with a server. The
        // only thing carrying the work across is the file-backed queue.
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let reopened = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))
        reopened.migrate()
        reopened.configure(serverURL: server.baseURL)
        #expect(reopened.pendingCount == 1)

        await reopened.sync()

        #expect(reopened.pendingCount == 0)
        #expect(try server.markdownFiles() == ["Written while offline.md"])
        #expect(
            SyncMessage.of(
                status: reopened.status,
                pendingCount: reopened.pendingCount,
                storeError: reopened.lastStoreError) == nil,
            "once everything has drained the banner goes away entirely")
    }

    @Test("scheduling and deleting from the row reach the vault")
    func rowActionsReachTheVault() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let directory = try TemporaryDirectory()
        let store = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))
        // A Saturday, so "this weekend" is today and "next week" is Monday.
        let calendar = fixedCalendar(today: "2026-07-25")

        store.migrate()
        store.configure(serverURL: server.baseURL)
        store.dispatch(.create(payload: createRequest(title: "Groceries")))
        await store.sync()

        let date = try #require(try ScheduleChoice.nextWeek.date(on: calendar))
        #expect(date == "2026-07-27")
        store.dispatch(.update(taskId: "Groceries.md", payload: .settingDue(date)))
        await store.sync()
        #expect(try server.contents(of: "Groceries.md").contains("2026-07-27"))

        // And it lands on the Today screen for that day, overdue-free.
        let onTheDay = try TaskListModel.build(
            section: .today,
            tasks: store.tasks,
            pendingTaskIds: [],
            calendar: fixedCalendar(today: "2026-07-27"),
            text: fixedText())
        #expect(onTheDay.rows.map(\.id) == ["Groceries.md"])
        #expect(onTheDay.rows.first?.due?.text == "Today")

        store.dispatch(.delete(taskId: "Groceries.md"))
        await store.sync()
        #expect(try server.markdownFiles().isEmpty)
    }
}
