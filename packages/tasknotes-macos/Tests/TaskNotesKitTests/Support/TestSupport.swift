import Foundation
import TaskNotesKit
import TaskNotesUniFFI

/// Run blocking work off the main thread.
///
/// Not a convenience. `URLSessionTransport` refuses a main-thread call outright,
/// because the core's `HttpClient` is synchronous and blocking the main thread
/// would freeze the UI for a network round trip. Swift Testing does not promise
/// which thread a test body runs on, and with
/// `NonisolatedNonsendingByDefault` enabled a plain `nonisolated async` helper
/// would inherit its caller's isolation — so a `@MainActor` test calling one
/// would still be on the main thread. `Task.detached` is what actually
/// guarantees the global executor.
///
/// Spelled `_Concurrency.Task` because the core exports a record named `Task`
/// and this file imports it; a bare `Task` here resolves to the record.
func offMainThread<T: Sendable>(_ body: @escaping @Sendable () throws -> T) async throws -> T {
    try await _Concurrency.Task.detached(priority: .userInitiated, operation: body).value
}

/// A create request carrying nothing but a title.
///
/// The generated memberwise initializer takes all thirteen fields, because
/// UniFFI does not emit defaults. Restating that at every call site would bury
/// the one field a test actually cares about.
func createRequest(title: String, status: TaskStatus? = nil) -> CreateTaskRequest {
    CreateTaskRequest(
        title: title,
        details: nil,
        status: status,
        priority: nil,
        due: nil,
        scheduled: nil,
        contexts: nil,
        projects: nil,
        tags: nil,
        recurrence: nil,
        recurrenceAnchor: nil,
        timeEstimate: nil,
        extraFields: nil
    )
}

/// A full host environment over a scratch directory and a real server.
///
/// Assembles the same six capabilities the app does, so an integration test
/// exercises the production implementations rather than a parallel set built
/// for testing.
struct HostFixture {
    let storage: FileHostStorage
    let clock: SystemClock
    let randomness: FixedRandomness
    let scheduler: DispatchRetryScheduler
    let api: TaskNotesApi

    /// - Parameters:
    ///   - directory: where durable client state goes.
    ///   - baseURL: the server to talk to.
    ///   - authToken: the bearer credential to present, or `nil` for none.
    ///     Pass `TaskNotesServerProcess.authToken` so one value spells the
    ///     secret on both sides.
    ///   - onFire: what a fired retry timer should do. Defaults to nothing, so
    ///     a test that never wants a background drain does not get one.
    /// - Throws: `CoreError` when the storage directory cannot be created.
    init(
        directory: URL,
        baseURL: URL,
        authToken: String? = nil,
        onFire: @escaping @Sendable (TimerId) -> Void = { _ in }
    ) throws {
        storage = try FileHostStorage(directory: directory)
        clock = SystemClock()
        // Pinned to the parts-per-million spelling of 0.5, which is what the
        // shared scenario corpus injects — it makes the backoff jitter factor
        // exactly 1.0, so any delay a test observes is the bare schedule.
        // Force-unwrapped deliberately, and only legal here: `Tests/.swiftlint.yml`
        // relaxes `force_unwrapping` because in a test a trap *is* the
        // assertion. `UnitPpm.half` is in range by construction, so a `nil`
        // means the constant moved and the suite should stop loudly.
        randomness = FixedRandomness(ppm: UnitPpm.half)!
        scheduler = DispatchRetryScheduler(onFire: onFire)
        api = try TaskNotesApi(
            transport: URLSessionTransport(authToken: authToken),
            baseUrl: baseURL.absoluteString,
            requestTimeoutMillis: apiDefaultTimeoutMillis()
        )
    }

    /// An engine wired over this fixture.
    func engine(autoSync: Bool = true) -> FfiSyncEngine {
        FfiSyncEngine(
            api: api,
            queueStorage: storage,
            cacheStorage: storage,
            clock: clock,
            scheduler: scheduler,
            random: randomness,
            autoSync: autoSync
        )
    }
}

/// A task carrying only the fields a test cares about.
///
/// The generated memberwise initializer takes twenty-eight, because UniFFI
/// emits no defaults. Restating those at every call site would bury the one or
/// two that carry the assertion.
func coreTask(
    id: String,
    title: String? = nil,
    status: TaskStatus = .open,
    priority: Priority = .normal,
    due: String? = nil,
    scheduled: String? = nil,
    recurrence: String? = nil,
    recurrenceAnchor: RecurrenceAnchor? = nil,
    completeInstances: [String] = [],
    archived: Bool = false,
    projects: [ProjectName] = [],
    contexts: [ContextName] = [],
    tags: [TagName] = []
) -> CoreTask {
    CoreTask(
        id: id,
        path: id,
        title: title ?? id,
        status: status,
        priority: priority,
        due: due,
        scheduled: scheduled,
        contexts: contexts,
        projects: projects,
        tags: tags,
        recurrence: recurrence,
        recurrenceAnchor: recurrenceAnchor,
        completeInstances: completeInstances,
        skippedInstances: [],
        completedDate: nil,
        dateCreated: nil,
        dateModified: nil,
        timeEstimate: nil,
        timeEntries: [],
        blockedBy: [],
        reminders: [],
        archived: archived,
        totalTrackedTime: 0,
        isBlocked: false,
        isBlocking: false,
        extraFields: "{}",
        details: nil
    )
}

/// A viewer standing in a fixed place at a fixed time.
///
/// All three are pinned because all three change answers: the day decides which
/// tasks are overdue, the zone decides which civil day a zoned `due` falls on,
/// and the instant decides which side of a daylight-saving transition the zone
/// is read at. A test that read any of them from the machine would pass in
/// California and fail in Berlin.
///
/// The default zone is a real place rather than a fixed offset, because a fixed
/// offset cannot express the thing most worth testing here: that a value in the
/// other half of the year is resolved at *its own* offset.
func fixedCalendar(
    today: String = "2026-07-22",
    timeZone: TimeZone = losAngeles,
    instant: Date = wednesdayNoon
) -> ViewerCalendar {
    ViewerCalendar(today: today, timeZone: timeZone, instant: instant)
}

/// The zone every date fixture stands in: `-07:00` in summer, `-08:00` in
/// winter, so the two are distinguishable.
let losAngeles = TimeZone(identifier: "America/Los_Angeles")!

/// 2026-07-22T12:00:00-07:00, the instant ``fixedCalendar``'s default day was
/// read at.
let wednesdayNoon = Date(timeIntervalSince1970: 1_784_746_800)

/// The formatter every list test uses, pinned to one locale.
///
/// `en_US_POSIX` rather than the machine's: month and weekday names are what
/// these assertions read, and they are locale-dependent by design.
func fixedText() -> TaskDateText {
    TaskDateText(locale: Locale(identifier: "en_US_POSIX"))
}

/// A create request for a recurring task.
///
/// `scheduled` matters here in a way it does not elsewhere: it is what the
/// completion target resolves to, and what the server advances as each
/// occurrence is completed.
func recurringRequest(
    title: String,
    scheduled: String,
    recurrence: String
) -> CreateTaskRequest {
    CreateTaskRequest(
        title: title,
        details: nil,
        status: nil,
        priority: nil,
        due: nil,
        scheduled: scheduled,
        contexts: nil,
        projects: nil,
        tags: nil,
        recurrence: recurrence,
        recurrenceAnchor: nil,
        timeEstimate: nil,
        extraFields: nil
    )
}
