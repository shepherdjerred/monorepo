import Foundation
import TaskNotesKit
import TaskNotesUniFFI

/// The seeded world every image snapshot is rendered against.
///
/// ## Everything here is pinned, and each pin buys something
///
/// The **instant** decides which rows are overdue and what the day heading
/// says. The **timezone** decides which civil day a zoned `due` value falls on.
/// The **locale** decides the words. A snapshot that read any of the three from
/// the machine would render differently in California and in Berlin, and
/// differently tomorrow than today — which is the whole failure mode an image
/// snapshot exists to catch.
///
/// ## Why the tasks arrive through the cache rather than through a dispatch
///
/// Seeding by dispatching creates would work, but every seeded task would then
/// be *pending* — an unacknowledged command against it — so every row would
/// carry the waiting-to-sync glyph and the screen would carry a queue banner.
/// That is a real state, and it is one of the states rendered below, but it is
/// not the resting state anybody wants to review a list in.
///
/// Writing `tasks.json` and letting `restore()` read it is the honest way to
/// get a settled store: it is the same file the engine writes after a real
/// sync, parsed by the same core function, so the tasks reaching the view are
/// exactly the shape a synced vault produces. No server, no network, no clock.
@MainActor
enum SnapshotFixtures {
    /// The viewer's day. A Wednesday, so the heading reads as a real one.
    static let today = "2026-07-22"

    /// 2026-07-22T12:00:00-07:00, as epoch seconds.
    private static let instant = Date(timeIntervalSince1970: 1_784_746_800)

    private static let timeZone = TimeZone(identifier: "America/Los_Angeles")!

    /// Where and when the viewer is standing, for anything derived by hand.
    static var calendar: ViewerCalendar {
        ViewerCalendar(today: today, utcOffsetSeconds: Int32(timeZone.secondsFromGMT(for: instant)))
    }

    /// The clock the store reads. Fixed instant, fixed zone.
    ///
    /// The instant is copied into a local first: this target's default
    /// isolation is `MainActor`, so the static property is main-actor-isolated
    /// and cannot be read from inside the `@Sendable` closure the clock stores.
    /// A local `Date` is `Sendable` and can.
    static func clock() -> SystemClock {
        let fixed = instant
        return SystemClock(timeZone: timeZone, instant: { fixed })
    }

    /// A settled store holding ``tasks``.
    static func populated() throws -> SeededStore {
        try seeded(with: tasks)
    }

    /// A settled store holding nothing.
    static func empty() throws -> SeededStore {
        try seeded(with: [])
    }

    /// One vault, seen by all four screens.
    ///
    /// A single corpus rather than four, because the four screens are
    /// *partitions of the same data* and reviewing them against different
    /// fixtures would hide the thing most worth seeing — that a task lands on
    /// exactly the screen it should. Reading down the list below, each task is
    /// annotated with where it surfaces.
    ///
    /// It is deliberately a mix rather than a dozen of the same thing: overdue
    /// and due-today at different priorities, a recurring occurrence still open
    /// and one already checked off, tasks with no metadata at all, dated tasks
    /// spread across tomorrow / this week / two separate later days, and two
    /// finished tasks that only a Browse screen should ever show. Between them
    /// they exercise every branch the row view has — strikethrough, the red
    /// overdue date, the priority ramp, the repeat mark, the trailing metadata,
    /// and a title long enough to truncate.
    ///
    /// ⚠️ 2026-07-22 is a **Wednesday**, so "this week" runs through Sunday the
    /// 26th and anything from the 27th is its own day heading. The dates below
    /// are chosen against that, not at random.
    static var tasks: [CoreTask] {
        [
            // Today — overdue, top of the priority ramp.
            coreTask(
                id: "Tasks/Renew passport.md",
                title: "Renew passport",
                priority: .highest,
                due: "2026-06-30",
                projects: ["[[Admin]]"]
            ),
            // Today — overdue, and long enough to truncate at narrow widths.
            coreTask(
                id: "Tasks/Reply to the landlord about the boiler inspection window.md",
                title: "Reply to the landlord about the boiler inspection window",
                priority: .high,
                due: "2026-07-19"
            ),
            // Today — a rule that fires today, scheduled-only and undated.
            coreTask(
                id: "Tasks/Stand-up.md",
                title: "Stand-up",
                priority: .medium,
                scheduled: today,
                recurrence: "FREQ=DAILY",
                contexts: ["work"]
            ),
            // Today.
            coreTask(
                id: "Tasks/Ship the release notes.md",
                title: "Ship the release notes",
                priority: .normal,
                due: "2026-07-22",
                projects: ["[[Website]]"],
                contexts: ["work"],
                tags: ["release"]
            ),
            // Today, already checked off — and *also* Upcoming, under
            // Tomorrow, because its next uncompleted occurrence is the 23rd.
            // The one fixture that proves a task can be finished on one screen
            // and still pending on another.
            coreTask(
                id: "Tasks/Take vitamins.md",
                title: "Take vitamins",
                priority: .low,
                scheduled: today,
                recurrence: "FREQ=DAILY",
                completeInstances: [today]
            ),
            // Today.
            coreTask(
                id: "Tasks/Water the plants.md",
                title: "Water the plants",
                priority: .low,
                due: "2026-07-22",
                contexts: ["home"]
            ),
            // Inbox — no project, no context, no date, no rule.
            coreTask(
                id: "Tasks/Draft the offsite agenda.md",
                title: "Draft the offsite agenda"
            ),
            // Inbox, flagged. Priority alone is not organisation.
            coreTask(
                id: "Tasks/Find a dentist.md",
                title: "Find a dentist",
                priority: .high
            ),
            // Upcoming — Tomorrow.
            coreTask(
                id: "Tasks/Team retro.md",
                title: "Team retro",
                priority: .normal,
                due: "2026-07-23",
                projects: ["[[Website]]"],
                contexts: ["work"]
            ),
            // Upcoming — This Week, and a recurring task shown at its *next*
            // occurrence rather than at the core's completion target. This is
            // the fixture behind the `about:` parameter on `TaskRowState`.
            coreTask(
                id: "Tasks/Water the ferns.md",
                title: "Water the ferns",
                priority: .low,
                scheduled: "2026-07-24",
                recurrence: "FREQ=WEEKLY;BYDAY=FR",
                contexts: ["home"]
            ),
            // Upcoming — This Week.
            coreTask(
                id: "Tasks/Submit expenses.md",
                title: "Submit expenses",
                priority: .medium,
                due: "2026-07-24",
                contexts: ["work"],
                tags: ["finance"]
            ),
            // Upcoming — its own day heading, beyond the current week.
            coreTask(
                id: "Tasks/Renew the domain.md",
                title: "Renew the domain",
                priority: .high,
                due: "2026-08-14",
                projects: ["[[Admin]]"],
                tags: ["admin"]
            ),
            // Upcoming — a second later heading, so the grouping is visibly a
            // run of days rather than one bucket called "Later".
            coreTask(
                id: "Tasks/Quarterly review.md",
                title: "Quarterly review",
                priority: .normal,
                due: "2026-08-31",
                projects: ["[[Work]]"]
            ),
            // Browse only — finished, so no other screen admits it.
            coreTask(
                id: "Tasks/Book the flights.md",
                title: "Book the flights",
                status: .done,
                priority: .normal,
                due: "2026-07-20",
                projects: ["[[Travel]]"]
            ),
            // Browse only — cancelled and undated, which is *not* Inbox: Inbox
            // is active work needing triage, and this is neither.
            coreTask(
                id: "Tasks/Rewrite the changelog script.md",
                title: "Rewrite the changelog script",
                status: .cancelled,
                priority: .low
            ),
        ]
    }

    /// A settled store holding exactly these tasks.
    ///
    /// Internal rather than private so a suite whose subject is the *shape* of
    /// the corpus — the board, whose columns are statuses the shared vault
    /// barely uses — can seed its own without changing the vault every other
    /// screen is reviewed against.
    static func seeded(with tasks: [CoreTask]) throws -> SeededStore {
        let scratch = try ScratchDirectory()
        let storage = try FileHostStorage(directory: scratch.url)
        try storage.writeTasks(tasks: tasks)

        let store = TaskNotesStore(storage: storage, clock: clock())
        // A configured engine, so the banner is silent: an unconfigured one
        // reports `SyncState.unconfigured`, which is a legitimate state and is
        // rendered separately rather than leaking into every other image.
        // Nothing is ever sent — `configure` restores from storage and arms a
        // pass without running it, and no test here calls `sync()`.
        store.configure(serverURL: URL(string: "http://127.0.0.1:9")!)
        return SeededStore(store: store, scratch: scratch)
    }
}

/// A store with the scratch directory it is backed by held alongside it.
///
/// The directory removes itself when the last reference goes, so a caller that
/// drops the store before rendering cannot leave `/tmp` behind — and, more
/// usefully, cannot pull the storage out from under a store still in use.
@MainActor
struct SeededStore {
    let store: TaskNotesStore
    private let scratch: ScratchDirectory

    init(store: TaskNotesStore, scratch: ScratchDirectory) {
        self.store = store
        self.scratch = scratch
    }
}

/// A scratch directory that removes itself.
final class ScratchDirectory: Sendable {
    let url: URL

    init() throws {
        url = FileManager.default.temporaryDirectory
            .appending(path: "tasknotes-snapshot-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    deinit {
        // Explicitly discarded rather than `try?`, which is banned for hiding
        // the error: `deinit` cannot propagate, and a leftover scratch
        // directory is not a test failure.
        _ = Result { try FileManager.default.removeItem(at: url) }
    }
}

/// A task carrying only the fields a snapshot cares about.
///
/// The generated memberwise initializer takes twenty-eight, because UniFFI
/// emits no defaults. Restating those at every call site would bury the two or
/// three that decide what the row looks like.
func coreTask(
    id: String,
    title: String,
    status: TaskStatus = .open,
    priority: Priority = .normal,
    due: String? = nil,
    scheduled: String? = nil,
    recurrence: String? = nil,
    completeInstances: [String] = [],
    projects: [ProjectName] = [],
    contexts: [ContextName] = [],
    tags: [TagName] = []
) -> CoreTask {
    CoreTask(
        id: id,
        path: id,
        title: title,
        status: status,
        priority: priority,
        due: due,
        scheduled: scheduled,
        contexts: contexts,
        projects: projects,
        tags: tags,
        recurrence: recurrence,
        recurrenceAnchor: nil,
        completeInstances: completeInstances,
        skippedInstances: [],
        completedDate: nil,
        dateCreated: nil,
        dateModified: nil,
        timeEstimate: nil,
        timeEntries: [],
        blockedBy: [],
        reminders: [],
        archived: false,
        totalTrackedTime: 0,
        isBlocked: false,
        isBlocking: false,
        extraFields: "{}",
        details: nil
    )
}
