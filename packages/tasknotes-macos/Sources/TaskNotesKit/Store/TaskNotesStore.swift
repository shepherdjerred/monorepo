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
/// ⚠️ **"Can block" means every exported engine method, not only the drain.**
/// `FfiSyncEngine` is one mutex held for the whole of each call, so a
/// `dispatch`, a `snapshot` or a dead-letter decision made from the main actor
/// waits on whatever request the drain is currently inside. That is why the
/// methods below are `async`: they hand the call to ``EngineBox/run(_:)``,
/// which runs it on the engine's own serial queue and brings the new snapshot
/// back with it. The only synchronous engine calls left are the ones made
/// against an engine that is brand new, absent, or being disposed — and
/// `dispose()` abandons its in-flight requests before it takes the lock.
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

    /// The Keychain's refusal to hand over or store the server credential.
    ///
    /// ⚠️ **A third channel, and the reason is the retirement rule rather than
    /// the message.** ``lastStoreError`` is retired by the next successful
    /// dispatch, because every ``report(_:)`` call site is the failing half of a
    /// switch whose other half dispatches — the corrected action is the evidence
    /// the problem is over. A credential failure has no such pairing: renaming a
    /// task succeeds happily while the token is still unsaved, and putting this
    /// in the same slot would take the banner down while the thing it warned
    /// about is still true. Only ``clearCredentialFailure()``, called when a
    /// write actually lands, retires it.
    public private(set) var credentialError: CoreError?

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
                await self?.absorbFire(error)
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
    /// ⚠️ **It publishes a failure and nothing else — deliberately no
    /// ``refresh()``.** This is the one lifecycle call that can run while an
    /// engine is not only installed but *busy*: pressing Connect reaches it
    /// through `applyServerAddress`, ahead of the ``configure(serverURL:authToken:)``
    /// that cancels the old transport. Reading that engine's snapshot here
    /// would take its FFI lock on the main actor and freeze every window for
    /// the rest of an in-flight request's timeout. There is also nothing to
    /// show: a migration changes storage, never the running engine's view of
    /// it, so the state already on screen is the state that is still true, and
    /// the `configure` that follows a successful migration publishes the new
    /// engine's snapshot anyway.
    ///
    /// - Returns: whether storage is migrated, and therefore safe to configure
    ///   an engine over.
    public func migrate() -> Bool {
        let failure = Self.failure(
            of: Result {
                try runMigrations(storage: storage, clock: clock, random: randomness)
            }
        )
        record(failure)
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
        switch built {
        case .failure(let error)?:
            absorb(.failure(error))
        case .success?, nil:
            // A rebuilt API is what retires the previous address's refusal, and
            // nothing else can. This failure arrives through `absorb` rather
            // than ``report(_:)``, so ``dispatch(_:publishing:)``'s retirement does not
            // reach it, and ``SyncMessage`` ranks a store error above every
            // engine state — so a `localhost:3000` (which Foundation reads as a
            // scheme, and `urlSession` rejects), once corrected, would leave the
            // banner up over a genuinely connected engine until some unrelated
            // mutation happened to succeed and clear it by accident.
            clearReportedError()
        }
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

        // ⚠️ Restored *before* it is published, and published only if that
        // worked. `restore()` is what loads the durable queue and the id
        // counters; a replacement that failed it is sitting on counters of
        // zero. Installing it anyway leaves the UI dispatching through an
        // engine that mints ids the queue has already spent — which overwrites
        // the counter file, replays an already-acknowledged mutation, or lands
        // an edit on a different server task. A malformed `id-counters.json` is
        // enough to reach this. No engine at all is the safe answer: dispatch
        // then returns nil, which the shell already treats as "not recorded".
        let restored = Result { try replacement.restore() }
        let isUsable: Bool
        switch restored {
        case .success: isUsable = true
        case .failure: isUsable = false
        }

        let retired = engineBox.replace(with: isUsable ? replacement : nil)
        // Dispose *after* the swap, so nothing can observe an empty slot, and
        // before anything else runs, so the retired engine cannot arm a timer
        // whose fire would drive the replacement.
        if let retired {
            absorb(Result { try retired.dispose() })
        }
        if !isUsable {
            // It never became the active engine, so this is only about letting
            // go of anything its restore armed before it failed.
            absorb(Result { try replacement.dispose() })
        }
        // Last, so the restore failure is the error left standing rather than
        // one from a dispose above it.
        absorb(restored)
        refresh()
    }

    /// Whether an engine is installed and taking dispatches.
    ///
    /// ⚠️ **Not the same fact as "``configure(serverURL:authToken:)`` was
    /// called".** That method deliberately publishes no engine when the
    /// replacement's `restore()` fails, so a shell that recorded its own call
    /// instead would believe an engine exists over an empty slot — and, because
    /// that record is what makes launch idempotent across windows, would never
    /// build one again for as long as the app ran. Asking the slot is what lets
    /// a launch lost to a transient storage failure be retried by the next
    /// window rather than needing the user to press Connect.
    public var isEngineInstalled: Bool { engineBox.current != nil }

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
    /// ⚠️ **Only for a moment when the engine cannot be mid-drain**, which is
    /// why it is not public: `snapshot()` and `status()` take the engine's own
    /// lock, and `syncNow()` holds that lock for the length of a network round
    /// trip. Its two callers are ``configure(serverURL:authToken:)`` and
    /// ``shutdown()``, which are looking at an engine that has just been built
    /// and installed or at an empty slot. Everything else — including
    /// ``migrate()``, which runs *before* the old engine is replaced, and the
    /// scheduler's fire — takes its snapshot on the engine's own queue and
    /// hands it to ``publish(_:)``.
    private func refresh() {
        publish(engineBox.current.map(Self.observe))
    }

    /// Apply an already-taken snapshot to the observable properties.
    ///
    /// `nil` is the unconfigured reading — no engine answered, so there is
    /// nothing to show rather than nothing to change.
    private func publish(_ observed: Result<Observed, any Error>?) {
        guard let observed else {
            tasks = []
            pendingCount = 0
            pendingTaskIds = []
            deadLetters = []
            lastSyncTime = nil
            status = SyncStatus(state: .unconfigured, lastError: nil, nextRetryAt: nil)
            return
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
    public func resolve(_ id: TaskId) async -> TaskId {
        let resolved = await engineBox.run { engine in
            Result { try engine.resolveTaskId(id: id) }
        }
        switch resolved {
        case .success(let resolved)?: return resolved
        case .failure(let error)?:
            lastStoreError = Self.asCoreError(error)
            return id
        case nil: return id
        }
    }

    // ── Writes ─────────────────────────────────────────────────────────────

    /// Record a mutation, answering the optimistic result.
    ///
    /// The enqueue is the only wait — never the network. With `autoSync` on
    /// (it is), this also *arms* a pass without running it; call ``sync()`` or
    /// ``settle()`` to make work actually happen. That split is the core's, and
    /// it is what makes a burst of dispatches coalesce into one drain instead
    /// of one drain each.
    ///
    /// ⚠️ **`async` because the enqueue may not run on the main actor.** The
    /// core's `dispatch` takes the engine's one mutex, and a background pass
    /// holds that mutex for the whole of a blocking HTTP request — so a
    /// dispatch made from the main thread freezes every window until the
    /// request returns or times out. Bulk completion is the case that makes it
    /// certain rather than unlucky: the first row starts a settle, and the
    /// second row is dispatched into the drain it started. The call runs on the
    /// engine's serial queue instead, which also keeps a burst of dispatches in
    /// the order the user made them.
    ///
    /// - Parameters:
    ///   - input: the mutation to record.
    ///   - publishing: the scope the observable properties are updated in.
    ///     `withAnimation` is a *synchronous* scope, so a caller that wants the
    ///     row animation it had when this was synchronous has to hand the scope
    ///     in — the update now lands after a suspension point, and
    ///     `TaskNotesKit` has no SwiftUI to reach for.
    /// - Returns: the task as the UI will now see it, `nil` after a delete and
    ///   `nil` when nothing was recorded at all.
    @discardableResult
    public func dispatch(
        _ input: CommandInput,
        publishing: (() -> Void) -> Void = { apply in apply() }
    ) async -> CoreTask? {
        let performed = await engineBox.run { engine in
            Self.performing(engine) { try $0.dispatch(input: input) }
        }
        guard let performed else {
            lastStoreError = .Invariant(message: "no engine is configured")
            return nil
        }
        // A successful mutation is what retires a reported shell error. Those
        // arrive through ``report(_:)`` — an unparsable quick-add line, a
        // schedule choice the core refused — and ``SyncMessage`` renders a
        // store error with no remedy and above everything else, so nothing
        // else on screen could ever take the banner down. Cleared *before* the
        // snapshot is published, so a snapshot read that then fails still
        // reports itself.
        if case .success = performed.outcome { clearReportedError() }
        publishing { self.publish(performed.observed) }
        switch performed.outcome {
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
    ///
    /// That rests on the core recording **every** failing exit of a pass
    /// before it returns one — including the write that makes a completed pull
    /// durable, which is the one that fails with the network already behind
    /// it. `SyncEngine::sync_now` documents the guarantee and
    /// `a_pull_the_disk_refuses_is_recorded_like_any_other_failure` holds it
    /// to it; a pass that failed without recording itself would leave the
    /// banner reading "syncing" with nothing ever taking it down.
    public func sync() async {
        publish(await Self.drain(engineBox))
    }

    /// Run an already-armed pass, discarding its result.
    ///
    /// The counterpart of a fire-and-forget trigger. Does nothing when no pass
    /// is armed, so it is safe to call on a timer.
    public func settle() async {
        publish(await Self.runSettle(engineBox))
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
    /// Called by ``dispatch(_:publishing:)`` on the mutation that succeeds, which is the
    /// moment a reported shell error stops being true: every ``report(_:)``
    /// call site is the failing half of a switch whose other half dispatches,
    /// so the corrected action is the only evidence that the problem is over.
    /// Nothing else can take the banner down — the store error outranks every
    /// engine state in ``SyncMessage`` and carries no remedy — so without this
    /// one bad quick-add line left the message up until the app relaunched.
    public func clearReportedError() {
        lastStoreError = nil
    }

    /// Record that the Keychain would not hand over or store the credential.
    ///
    /// See ``credentialError`` for why this is not ``report(_:)``.
    public func reportCredentialFailure(_ error: CoreError) {
        credentialError = error
    }

    /// Retire the credential failure.
    ///
    /// The only thing that may call this is a credential write that succeeded —
    /// the one event that makes the previous failure untrue.
    public func clearCredentialFailure() {
        credentialError = nil
    }

    /// Move a parked command back onto the queue, and run the pass that arms.
    ///
    /// `async` rather than fire-and-forget because the core's
    /// `retry_dead_letter` requeues the command and sets `pass_requested`
    /// without running anything — exactly like a dispatch. Every other mutation
    /// surface pairs that with a settle; this one did not, so Retry moved the
    /// row out of Parked and left the command sitting in the queue behind an
    /// idle "waiting" banner, with nothing on screen able to start it. Awaiting
    /// here rather than spawning keeps the store free of lifetimes
    /// ``shutdown()`` cannot stop.
    public func retryDeadLetter(id: String) async {
        let performed = await engineBox.run { engine in
            Self.performing(engine) { try $0.retryDeadLetter(id: id) }
        }
        guard let performed else { return }
        absorb(performed)
        guard case .success = performed.outcome else { return }
        await settle()
    }

    /// Drop a parked command for good.
    ///
    /// `async` for the same reason ``dispatch(_:publishing:)`` is: the core's
    /// `discard_dead_letter` takes the engine's mutex, and a background pass
    /// can be holding it for the length of an HTTP request.
    public func discardDeadLetter(id: String) async {
        let performed = await engineBox.run { engine in
            Self.performing(engine) { try $0.discardDeadLetter(id: id) }
        }
        guard let performed else { return }
        absorb(performed)
    }

    // ── Plumbing ───────────────────────────────────────────────────────────

    /// Publish the outcome of an engine call and re-read the snapshot.
    ///
    /// Only for ``configure(serverURL:authToken:)`` and ``shutdown()``, for the
    /// reason ``refresh()`` gives: the re-read is synchronous.
    private func absorb(_ outcome: Result<Void, any Error>) {
        record(Self.failure(of: outcome))
        refresh()
    }

    /// Keep a failure, and leave the standing one alone when there is none.
    ///
    /// `lastStoreError` is retired by the mutation that succeeds — see
    /// ``clearReportedError()`` — never by an absence of news.
    private func record(_ error: CoreError?) {
        guard let error else { return }
        lastStoreError = error
    }

    /// Publish what one engine call left behind.
    ///
    /// The counterpart of ``absorb(_:)`` for a call that already brought its
    /// snapshot back with it, so nothing here re-reads the engine.
    private func absorb<Value>(_ performed: Performed<Value>) {
        if case .failure(let error) = performed.outcome {
            lastStoreError = Self.asCoreError(error)
        }
        publish(performed.observed)
    }

    /// Publish what a scheduler pass left behind.
    ///
    /// The snapshot is taken on the engine's own queue rather than here, for
    /// the reason ``refresh()`` gives: a timer fire and a user-triggered
    /// ``sync()`` can overlap, so the engine this reads may be inside the HTTP
    /// request the other one started.
    private func absorbFire(_ error: CoreError?) async {
        record(error)
        publish(await engineBox.run { Self.observe($0) })
    }

    nonisolated private static func failure(of outcome: Result<Void, any Error>) -> CoreError? {
        guard case .failure(let error) = outcome else { return nil }
        return asCoreError(error)
    }

    /// Everything one engine call leaves behind: its own answer, and the
    /// snapshot taken immediately afterwards.
    ///
    /// The pair is read in a single job on the engine's queue rather than as
    /// two calls, because the second one made from the main actor would be
    /// exactly the lock acquisition the first one was moved off it to avoid.
    private struct Performed<Value: Sendable>: Sendable {
        let outcome: Result<Value, any Error>
        let observed: Result<Observed, any Error>
    }

    nonisolated private static func performing<Value: Sendable>(
        _ engine: any FfiSyncEngineProtocol,
        _ body: (any FfiSyncEngineProtocol) throws -> Value
    ) -> Performed<Value> {
        Performed(outcome: Result { try body(engine) }, observed: observe(engine))
    }

    nonisolated private static func observe(
        _ engine: any FfiSyncEngineProtocol
    ) -> Result<Observed, any Error> {
        Result { Observed(snapshot: try engine.snapshot(), status: try engine.status()) }
    }

    /// `syncNow`, off the main actor, answering the snapshot it left behind.
    ///
    /// `@concurrent` is load-bearing rather than decorative. With
    /// `NonisolatedNonsendingByDefault` enabled — it is, in `Package.swift` — a
    /// plain `nonisolated async` function *inherits its caller's isolation*, so
    /// without this attribute the blocking HTTP request would run on the main
    /// thread. ``URLSessionTransport`` refuses a main-thread call outright, so
    /// getting this wrong is a loud test failure rather than a beachball.
    ///
    /// Not on ``EngineBox``'s serial queue, unlike every other engine call
    /// here: a drain is the long call, and putting it there would make the next
    /// dispatch wait behind a network round trip for a reason the Rust mutex
    /// does not itself impose.
    @concurrent
    private static func drain(_ box: EngineBox) async -> Result<Observed, any Error>? {
        guard let engine = box.current else { return nil }
        // The pass's own failure is discarded here by design — the engine
        // records every failing exit in `status()` before returning it, and
        // the read below carries that back. See ``sync()`` for why the direct
        // error must not become a second banner.
        _ = Result { try engine.syncNow() }
        return observe(engine)
    }

    @concurrent
    private static func runSettle(_ box: EngineBox) async -> Result<Observed, any Error>? {
        guard let engine = box.current else { return nil }
        _ = Result { try engine.settle() }
        return observe(engine)
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
}

extension TaskNotesStore {
    /// One reading of the engine: what it holds, and what it is doing.
    ///
    /// The pair is always taken together, in one job on the engine's queue, so
    /// the tasks on screen and the banner over them describe the same instant.
    private struct Observed: Sendable {
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
