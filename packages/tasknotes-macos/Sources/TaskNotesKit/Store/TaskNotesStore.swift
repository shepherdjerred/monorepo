internal import Observation
internal import Synchronization
public import TaskNotesUniFFI

public import struct Foundation.URL

/// The app's task state, over the core's `FfiSyncEngine`.
///
/// Plain Observation, not TCA: the state machine already lives in Rust, so a
/// reducer layer would mostly forward to UniFFI calls at full ceremony cost.
/// Every field below is a projection of one `snapshot()` call — nothing here
/// decides anything, and any logic that appears in this file is a bug in the
/// layering rather than a feature.
///
/// It sits **alongside** `NavigationState`, never inside it. Navigation is a
/// property of the window — two windows have two selections — while task data
/// is a property of the vault and is shared by every window. Conflating them is
/// what makes a store impossible to test, and it is why this type lives in
/// `TaskNotesKit`, which has no SwiftUI at all, rather than next to the views.
///
/// ## The two isolation domains, and why the `Mutex` is not decoration
///
/// The observable surface is `@MainActor`, because that is what a SwiftUI view
/// reads. The engine is not, and must not be: the core's `HttpClient` is
/// synchronous, so `syncNow()` blocks its calling thread for the length of a
/// network round trip. Every call that can block therefore runs on a
/// `@concurrent` function, and `Mutex<Engine>` is what lets both domains hold
/// the same engine without `@unchecked Sendable`.
///
/// The engine is a *slot* rather than a stored constant because reconfiguring
/// the server replaces it. The core is explicit about that: construct exactly
/// one engine per configured server, and `dispose()` the old one before
/// building its replacement, or a failure already in flight can resurrect a
/// dead engine's retry timer.
///
/// ## Cancellation
///
/// There is none to propagate, deliberately. UniFFI 0.31 has no async
/// cancellation at all, so nothing in this stack may depend on it: stopping
/// work is ``shutdown()`` calling `dispose()` and ``DispatchRetryScheduler``
/// dropping its armed ids, both explicit calls.
@MainActor
@Observable
public final class TaskNotesStore {
    /// The tasks the UI renders, in the order the core produced them.
    ///
    /// **Never re-sorted here.** The core carries list order in an `IndexMap`
    /// and it crosses the FFI as an ordered `Vec`; that order is the user's,
    /// and a convenience sort on this side would silently override it.
    public private(set) var tasks: [CoreTask] = []

    /// How many commands are queued and not yet acknowledged.
    public private(set) var pendingCount: UInt32 = 0

    /// The ids of tasks with an unacknowledged command against them.
    public private(set) var pendingTaskIds: [TaskId] = []

    /// Commands the engine gave up on, awaiting a decision.
    public private(set) var deadLetters: [DeadLetterEntry] = []

    /// When the last successful pull completed, in epoch milliseconds.
    public private(set) var lastSyncTime: Int64?

    /// What the engine is doing, for the connection banner.
    public private(set) var status = SyncStatus(
        state: .unconfigured, lastError: nil, nextRetryAt: nil)

    /// The most recent failure this store itself could not attribute to the
    /// engine — a storage failure during `restore`, or a dispatch that threw.
    ///
    /// Separate from `status.lastError`, which is the engine's own view of the
    /// last *sync* failure. Merging them would let a local write failure
    /// masquerade as a network problem.
    public private(set) var lastStoreError: CoreError?

    private let storage: FileHostStorage
    private let clock: any CoreClock & ViewerCalendarSource
    private let randomness: any Randomness
    private let scheduler: DispatchRetryScheduler
    private let engineBox: EngineBox
    private let relay: FireRelay

    /// A store over the given host capabilities.
    ///
    /// Everything is injected rather than constructed here, because "which
    /// clock" and "which directory" are decisions the app makes once at launch
    /// and a test makes per case; a store that reached for `FileManager` itself
    /// would force every test through the real container.
    public init(
        storage: FileHostStorage,
        clock: any CoreClock & ViewerCalendarSource = SystemClock(),
        randomness: any Randomness = SystemRandomness()
    ) {
        self.storage = storage
        self.clock = clock
        self.randomness = randomness

        // The box is created before the scheduler and before any engine,
        // because both of them have to reach it: the scheduler's fire closure
        // looks the engine up through it, and `configure` puts the engine into
        // it. That ordering is what breaks the otherwise circular
        // engine-needs-scheduler-needs-engine dependency.
        let box = EngineBox()
        let fireRelay = FireRelay()
        self.engineBox = box
        self.relay = fireRelay

        // The closure captures `box` and `fireRelay`, never `self`. That is forced
        // rather than tidy: `self` cannot be captured until every stored
        // property is initialised, and `scheduler` is one of them — so a
        // `[weak self]` here is a use-before-initialisation error. The relay is
        // connected at the bottom of this initialiser instead, which is the
        // first point at which escaping `self` is legal.
        self.scheduler = DispatchRetryScheduler { _ in
            // Already on the scheduler's private serial queue, which is exactly
            // where a blocking drain belongs. `requestSync` arms a pass and
            // `settle` runs it.
            guard let engine = box.current else { return }
            let outcome = Result {
                try engine.requestSync()
                try engine.settle()
            }
            // `settle` discards the *pass's* failure by design — the engine
            // records it in `status()`, which `refresh()` publishes. What is
            // relayed here is only a failure of the calls themselves, which
            // means a poisoned lock rather than a failed sync.
            fireRelay.fire(Self.failure(of: outcome))
        }

        fireRelay.connect { [weak self] error in
            _Concurrency.Task { @MainActor [weak self] in
                self?.absorbFire(error)
            }
        }
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    /// Run the v0 → v2 storage migration.
    ///
    /// Call once at launch, **before** ``configure(serverURL:authToken:)``:
    /// the core requires migrations to complete before anything reads the
    /// queue. Idempotent — it returns immediately once the stored version is
    /// current.
    ///
    /// ⚠️ **The answer is a precondition, not a status line, and it is
    /// deliberately not discardable.** Configuring over storage that failed to
    /// migrate leaves a legacy queue in place while the engine accepts
    /// dispatches; the first one writes the v2 queue, and the *next* launch's
    /// migration finds that queue, concludes the conversion already happened,
    /// and deletes the legacy commands it never converted. Continuing past
    /// `false` is what turns a transient storage failure into lost work.
    ///
    /// - Returns: whether storage is migrated, and therefore safe to configure
    ///   an engine over.
    public func migrate() -> Bool {
        let failure = Self.failure(
            of: Result {
                try runMigrations(storage: storage, clock: clock, random: randomness)
            }
        )
        absorbFire(failure)
        return failure == nil
    }

    /// Point the store at a server, replacing any engine already running.
    ///
    /// Pass `nil` to build an unconfigured engine: the core treats "no server
    /// yet" as a state (`SyncState.unconfigured`), deliberately not an error
    /// and deliberately not something a retry timer can fix. The queue still
    /// accepts dispatches in that state; they simply do not drain.
    public func configure(serverURL: URL?, authToken: String? = nil) {
        // A bad address is reported now, not fifteen seconds into the first sync.
        let built = serverURL.map { url in
            Result(catching: {
                try TaskNotesApi.urlSession(serverURL: url, authToken: authToken)
            })
        }
        if case .failure(let error)? = built { absorb(.failure(error)) }
        let api: TaskNotesApi? = if case .success(let ready)? = built { ready } else { nil }
        let replacement = FfiSyncEngine(
            api: api,
            queueStorage: storage,
            cacheStorage: storage,
            clock: clock,
            scheduler: scheduler,
            random: randomness,
            autoSync: true
        )

        let retired = engineBox.replace(with: replacement)
        // Dispose *after* the swap, so nothing can observe an empty slot, and
        // before anything else runs, so the retired engine cannot arm a timer
        // whose fire would drive the replacement.
        if let retired {
            absorb(Result { try retired.dispose() })
        }
        absorb(Result { try replacement.restore() })
        refresh()
    }

    /// Stop the engine and release every armed timer.
    public func shutdown() {
        let retired = engineBox.replace(with: nil)
        if let retired {
            absorb(Result { try retired.dispose() })
        }
        scheduler.cancelAll()
        refresh()
    }

    // ── Reads ──────────────────────────────────────────────────────────────

    /// Re-read the engine's snapshot into the observable properties.
    ///
    /// Cheap and non-blocking: `snapshot()` and `status()` only take the
    /// engine's own lock. Every mutating method here ends with one.
    public func refresh() {
        guard let engine = engineBox.current else {
            tasks = []
            pendingCount = 0
            pendingTaskIds = []
            deadLetters = []
            lastSyncTime = nil
            status = SyncStatus(state: .unconfigured, lastError: nil, nextRetryAt: nil)
            return
        }

        let observed = Result {
            Observed(snapshot: try engine.snapshot(), status: try engine.status())
        }
        switch observed {
        case .success(let value):
            tasks = value.snapshot.tasks
            pendingCount = value.snapshot.pendingCount
            pendingTaskIds = value.snapshot.pendingTaskIds
            deadLetters = value.snapshot.deadLetters
            lastSyncTime = value.snapshot.lastSyncTime
            status = value.status
        case .failure(let error):
            lastStoreError = Self.asCoreError(error)
        }
    }

    /// Where and when the viewer is, read now.
    ///
    /// Every date-dependent derivation takes one of these rather than reading
    /// the clock itself, so a whole screen is derived against a single instant.
    /// Around midnight that is the difference between a coherent list and one
    /// where a task is simultaneously overdue and due today.
    public func viewerCalendar() -> ViewerCalendar {
        clock.viewerCalendar()
    }

    /// Follow a temp id through the alias map recorded when its create was
    /// acked, or answer the id unchanged.
    ///
    /// A UI surface holding an id from before a create was acked — an open
    /// inspector, a deep link, a restored window — stays valid because of this.
    public func resolve(_ id: TaskId) -> TaskId {
        guard let engine = engineBox.current else { return id }
        switch Result(catching: { try engine.resolveTaskId(id: id) }) {
        case .success(let resolved): return resolved
        case .failure(let error):
            lastStoreError = Self.asCoreError(error)
            return id
        }
    }

    // ── Writes ─────────────────────────────────────────────────────────────

    /// Record a mutation, returning the optimistic result immediately.
    ///
    /// The enqueue is the only wait — never the network. With `autoSync` on
    /// (it is), this also *arms* a pass without running it; call ``sync()`` or
    /// ``settle()`` to make work actually happen. That split is the core's, and
    /// it is what makes a burst of dispatches coalesce into one drain instead
    /// of one drain each.
    @discardableResult
    public func dispatch(_ input: CommandInput) -> CoreTask? {
        guard let engine = engineBox.current else {
            lastStoreError = .Invariant(message: "no engine is configured")
            return nil
        }
        let outcome = Result { try engine.dispatch(input: input) }
        // A successful mutation is what retires a reported shell error. Those
        // arrive through ``report(_:)`` — an unparsable quick-add line, a
        // schedule choice the core refused — and ``SyncMessage`` renders a
        // store error with no remedy and above everything else, so nothing
        // else on screen could ever take the banner down. Cleared *before*
        // `refresh`, so a snapshot read that then fails still reports itself.
        if case .success = outcome { clearReportedError() }
        refresh()
        switch outcome {
        case .success(let optimistic): return optimistic
        case .failure(let error):
            lastStoreError = Self.asCoreError(error)
            return nil
        }
    }

    /// Arm a pass and run the drain loop to quiescence.
    ///
    /// Blocking work runs off the main actor; only the snapshot read comes
    /// back. The pass's own failure is *not* rethrown — a UI wants a banner
    /// rather than an exception.
    ///
    /// It is also deliberately **not** copied into ``lastStoreError``.
    /// `syncNow()` throws the very failure the engine has already recorded in
    /// `status().lastError`, so storing it twice would make one network problem
    /// render as two unrelated ones — and would break the rule that
    /// `lastStoreError` means "something the engine did not already account
    /// for".
    public func sync() async {
        _ = await Self.drain(engineBox)
        refresh()
    }

    /// Run an already-armed pass, discarding its result.
    ///
    /// The counterpart of a fire-and-forget trigger. Does nothing when no pass
    /// is armed, so it is safe to call on a timer.
    public func settle() async {
        _ = await Self.runSettle(engineBox)
        refresh()
    }

    /// Record a failure the shell hit while preparing a command.
    ///
    /// Parsing a quick-add line and resolving a named schedule date both run in
    /// the shell and both call into the core, so both can fail before anything
    /// is dispatched. They go into the same channel as a storage failure
    /// because they are the same kind of thing — something this Mac could not
    /// do — and not into `status.lastError`, which is the engine's account of
    /// the network and must not be polluted by a local problem.
    public func report(_ error: CoreError) {
        lastStoreError = error
    }

    /// Retire the local failure.
    ///
    /// Called by ``dispatch(_:)`` on the mutation that succeeds, which is the
    /// moment a reported shell error stops being true: every ``report(_:)``
    /// call site is the failing half of a switch whose other half dispatches,
    /// so the corrected action is the only evidence that the problem is over.
    /// Nothing else can take the banner down — the store error outranks every
    /// engine state in ``SyncMessage`` and carries no remedy — so without this
    /// one bad quick-add line left the message up until the app relaunched.
    public func clearReportedError() {
        lastStoreError = nil
    }

    /// Move a parked command back onto the queue.
    public func retryDeadLetter(id: String) {
        guard let engine = engineBox.current else { return }
        absorb(Result { try engine.retryDeadLetter(id: id) })
    }

    /// Drop a parked command for good.
    public func discardDeadLetter(id: String) {
        guard let engine = engineBox.current else { return }
        absorb(Result { try engine.discardDeadLetter(id: id) })
    }

    // ── Plumbing ───────────────────────────────────────────────────────────

    /// Publish the outcome of an engine call and re-read the snapshot.
    private func absorb(_ outcome: Result<Void, any Error>) {
        absorbFire(Self.failure(of: outcome))
    }

    private func absorbFire(_ error: CoreError?) {
        if let error {
            lastStoreError = error
        }
        refresh()
    }

    nonisolated private static func failure(of outcome: Result<Void, any Error>) -> CoreError? {
        guard case .failure(let error) = outcome else { return nil }
        return asCoreError(error)
    }

    /// `syncNow`, off the main actor.
    ///
    /// `@concurrent` is load-bearing rather than decorative. With
    /// `NonisolatedNonsendingByDefault` enabled — it is, in `Package.swift` — a
    /// plain `nonisolated async` function *inherits its caller's isolation*, so
    /// without this attribute the blocking HTTP request would run on the main
    /// thread. ``URLSessionTransport`` refuses a main-thread call outright, so
    /// getting this wrong is a loud test failure rather than a beachball.
    @concurrent
    private static func drain(_ box: EngineBox) async -> Result<Void, any Error> {
        guard let engine = box.current else { return .success(()) }
        return Result { try engine.syncNow() }
    }

    @concurrent
    private static func runSettle(_ box: EngineBox) async -> Result<Void, any Error> {
        guard let engine = box.current else { return .success(()) }
        return Result { try engine.settle() }
    }

    /// Recover the `CoreError` the bindings actually threw.
    ///
    /// UniFFI emits plain `throws` even for a Rust function whose only failure
    /// type is `CoreError`, so the error arriving here is an `any Error` that
    /// is already one. Anything else means the bindings threw something
    /// undocumented, which is an invariant violation rather than a caller
    /// mistake.
    nonisolated private static func asCoreError(_ error: any Error) -> CoreError {
        guard let coreError = error as? CoreError else {
            return .Invariant(message: "the core threw an unexpected error: \(error)")
        }
        return coreError
    }

    private struct Observed {
        let snapshot: TaskStoreSnapshot
        let status: SyncStatus
    }
}

extension TaskNotesStore {
    /// Where durable client state is being kept, for a diagnostics pane.
    ///
    /// A path rather than a boolean: the single most useful thing to see when
    /// the sandbox redirects a container somewhere unexpected is the container
    /// it actually chose.
    public var storageDescription: String {
        storage.root.path(percentEncoded: false)
    }
}
