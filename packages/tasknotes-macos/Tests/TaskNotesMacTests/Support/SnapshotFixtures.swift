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

    /// The rows the populated Today screen shows.
    ///
    /// Deliberately a mix rather than six of the same thing: two overdue at
    /// different priorities, three due today across the priority range, one
    /// recurring occurrence still open and one already checked off. Between
    /// them they exercise every branch the row view has — strikethrough, the
    /// red overdue badge, the priority tint, the project/context subtitle, and
    /// a title long enough to truncate.
    static var tasks: [CoreTask] {
        [
            coreTask(
                id: "Tasks/Renew passport.md",
                title: "Renew passport",
                priority: .highest,
                due: "2026-06-30",
                projects: ["[[Admin]]"]
            ),
            coreTask(
                id: "Tasks/Reply to the landlord about the boiler inspection window.md",
                title: "Reply to the landlord about the boiler inspection window",
                priority: .high,
                due: "2026-07-19"
            ),
            coreTask(
                id: "Tasks/Stand-up.md",
                title: "Stand-up",
                priority: .medium,
                scheduled: today,
                recurrence: "FREQ=DAILY",
                contexts: ["work"]
            ),
            coreTask(
                id: "Tasks/Ship the release notes.md",
                title: "Ship the release notes",
                priority: .normal,
                due: "2026-07-22",
                projects: ["[[Website]]"],
                contexts: ["work"]
            ),
            coreTask(
                id: "Tasks/Take vitamins.md",
                title: "Take vitamins",
                priority: .low,
                scheduled: today,
                recurrence: "FREQ=DAILY",
                completeInstances: [today]
            ),
            coreTask(
                id: "Tasks/Water the plants.md",
                title: "Water the plants",
                priority: .low,
                due: "2026-07-22",
                contexts: ["home"]
            ),
        ]
    }

    private static func seeded(with tasks: [CoreTask]) throws -> SeededStore {
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
    contexts: [ContextName] = []
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
        tags: [],
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
