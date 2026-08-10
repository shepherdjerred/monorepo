public import Observation
public import TaskNotesKit
public import TaskNotesUniFFI

public import struct Foundation.URL
// `UserDefaults` is only stored, never exposed, but Swift requires every import
// of a module within one file to agree on its access level — and `URL` is
// public because it is part of this type's surface.
public import class Foundation.UserDefaults

/// Everything the app owns for its whole lifetime, assembled in one place.
///
/// It exists so `App/TaskNotesApp.swift` can stay at entry-point scope. The
/// Xcode application target links only the `TaskNotesMac` product, and that is
/// deliberate: anything the `@main` file names has to be reachable from this
/// module, or `swift build` and `xcodebuild` stop compiling the same sources.
/// Assembling the store here rather than there keeps the entry point to an
/// `@main` attribute and a scene body.
///
/// ⚠️ **Everything here is app-scoped, and `NavigationState` deliberately is
/// not.** Every `WindowGroup` instance is handed this one object, so anything
/// stored on it is shared by every window whether or not that was intended —
/// which is exactly what a selection must not be. Navigation is created by
/// ``RootView`` instead, once per window, and published to the menu bar as a
/// focused scene value so commands act on the frontmost window rather than on
/// a singleton. Do not move it back here to save an injection.
@Observable
public final class AppEnvironment {
    /// The task store, or the failure that prevented building one.
    ///
    /// A `Result` rather than a force-unwrapped store: the only thing that can
    /// fail is creating the app container's Application Support directory, and
    /// a sandboxed app that cannot do that should say so rather than crash on
    /// launch with no explanation.
    public let store: Result<TaskNotesStore, CoreError>

    /// The stored queries, and the only thing that persists them.
    ///
    /// A third object rather than a field on either of the two above, on the
    /// same axis they are already split by: a saved view is neither a property
    /// of a window (every window lists the same ones) nor a property of the
    /// vault (the core has never heard of it). It is a preference, it lives in
    /// `UserDefaults`, and giving it its own object is what keeps it out of a
    /// store whose entire job is to be a projection of one core snapshot.
    public let savedViews: SavedViewStore

    /// The server address, as typed in Settings.
    ///
    /// Kept as the raw string rather than a `URL` so a half-typed address is
    /// representable while the user is typing one. Committing it is what turns
    /// it into an engine.
    public var serverAddress: String {
        didSet { defaults.set(serverAddress, forKey: Self.serverAddressKey) }
    }

    /// The server's bearer token, as typed in Settings.
    ///
    /// ⚠️ Written straight through to the **Keychain**, not to `UserDefaults`.
    /// Everything else this object persists is a preference; this is a
    /// credential that grants full read/write access to the vault, and a
    /// bearer token in a container plist is readable by anything that can read
    /// the container and lands verbatim in an unencrypted backup.
    ///
    /// The property itself holds the value only so SwiftUI can bind a field to
    /// it. Nothing reads it back out of here — `configure` takes it from the
    /// store, so the Keychain stays the single source of truth.
    public var authToken: String {
        didSet { reportFailedWrite(tokenStore.setToken(authToken)) }
    }

    /// The floating quick-add panel, and the global hotkey that opens it.
    ///
    /// Assembled here rather than in a scene because the requirement is that the
    /// hotkey works **with no windows open**. This object is the `@State` initial
    /// value of the `App` struct, so it is built at launch before any scene
    /// exists; a controller created by a view's `.task` would have tied a global
    /// capability to the lifetime of a window the user is allowed to close.
    let quickAdd: QuickAddPanelController

    /// The one pomodoro interval the app is running, if any.
    ///
    /// Here rather than in the timer window for the same shape of reason: a
    /// window is a *view* of a running interval, and closing it is not a way of
    /// saying stop.
    let pomodoro: PomodoroTimer

    private let defaults: UserDefaults

    /// Where the bearer token is kept. Injected so a test never touches the
    /// real Keychain — see ``ServerTokenStore``.
    private let tokenStore: any ServerTokenStore

    /// Whether a UI test asked this process to disown stored credentials.
    ///
    /// ⚠️ See ``UITesting`` for why. A test that forgets the flag still reaches
    /// the real Keychain, which is why the UI tests funnel every launch through
    /// one helper rather than calling `app.launch()` directly.
    private nonisolated static var isUITesting: Bool {
        CommandLine.arguments.contains(UITesting.flagArgument)
    }

    /// Assemble over the sandbox container.
    ///
    /// The token store defaults to the Keychain, except under
    /// ``UITesting/flagArgument`` — see ``isUITesting``.
    public init(
        defaults: UserDefaults = .standard,
        tokenStore: (any ServerTokenStore)? = nil
    ) {
        // Named distinctly rather than shadowing the parameter: the whole
        // point of this line is that the resolved store may differ from the
        // one passed in, and shadowing would hide exactly that.
        let resolvedTokenStore =
            tokenStore ?? (Self.isUITesting ? InMemoryTokenStore() : KeychainTokenStore())
        let container = TaskNotesStore.containerDefault()
        self.store = container
        self.quickAdd = QuickAddPanelController(store: container)
        self.pomodoro = PomodoroTimer()
        self.savedViews = SavedViewStore(defaults: defaults)
        self.defaults = defaults
        self.tokenStore = resolvedTokenStore
        self.serverAddress = defaults.string(forKey: Self.serverAddressKey) ?? ""
        // A read failure leaves the field empty rather than reporting here:
        // there is no store to report *to* until `bringUp`, which re-reads and
        // routes the failure to the banner.
        self.authToken = Self.editableToken(resolvedTokenStore)

        // Claimed at launch, and **only** from this initializer. The other one
        // exists for previews and tests, and a test process that registered a
        // system-wide hotkey would take a key combination off whoever is using
        // the Mac for as long as the suite runs.
        quickAdd.installHotkey()
    }

    /// Assemble over an explicit store, for previews and tests.
    public init(
        store: Result<TaskNotesStore, CoreError>,
        defaults: UserDefaults = .standard,
        tokenStore: any ServerTokenStore = InMemoryTokenStore()
    ) {
        self.store = store
        self.quickAdd = QuickAddPanelController(store: store)
        self.pomodoro = PomodoroTimer()
        self.savedViews = SavedViewStore(defaults: defaults)
        self.defaults = defaults
        self.tokenStore = tokenStore
        self.serverAddress = defaults.string(forKey: Self.serverAddressKey) ?? ""
        self.authToken = Self.editableToken(tokenStore)
    }

    /// The stored token as the Settings field's initial text.
    ///
    /// An unreadable credential shows as empty, which is the only honest thing
    /// a text field can say about bytes nobody could decode. It is not the
    /// place the failure is *reported* — ``bringUp()`` does that.
    private nonisolated static func editableToken(_ store: any ServerTokenStore) -> String {
        guard case .success(let token) = store.token() else { return "" }
        return token ?? ""
    }

    /// Bring the engine up.
    ///
    /// `migrate` must run before anything reads the queue, and an empty or
    /// unparsable address builds an *unconfigured* engine rather than none at
    /// all — the core treats "no server yet" as a state, and its queue accepts
    /// dispatches in that state, so the app is usable offline before a server
    /// has ever been entered.
    ///
    /// Idempotent, so calling it from a `.task` that re-runs is safe.
    ///
    /// Returns the fetch it started. Production call sites discard it — the
    /// `@discardableResult` is what keeps them unchanged — but a test cannot
    /// otherwise observe a detached task with no handle, and the alternative is
    /// polling, which is how a test becomes flaky and then gets deleted.
    @discardableResult
    public func start() -> _Concurrency.Task<Void, Never> {
        bringUp()
    }

    /// Apply a newly entered address, replacing the running engine.
    ///
    /// Reconfiguring builds a new engine over the same storage, which is how a
    /// server change is meant to be applied: the durable queue survives because
    /// it is on disk rather than in the engine, so nothing queued while
    /// pointing at the old address is lost.
    @discardableResult
    public func applyServerAddress() -> _Concurrency.Task<Void, Never> {
        bringUp()
    }

    /// Migrate, configure, fetch — the one sequence both public entry points
    /// are, and the reason they share a body rather than differing by a line.
    ///
    /// ⚠️ **Migration failure ends this, and that is the whole point of the
    /// guard.** An engine configured over unmigrated storage still accepts
    /// dispatches; the first one writes the v2 queue, and the next launch's
    /// migration reads that queue as proof the conversion already happened and
    /// deletes the legacy commands it never converted. Pressing Connect after a
    /// failed launch used to reach `configure` without ever having migrated,
    /// which is why the check cannot live in `start()` alone.
    ///
    /// The failure is not silent: ``TaskNotesStore/migrate()`` records it, and
    /// the connection banner renders a store error above every engine state.
    private func bringUp() -> _Concurrency.Task<Void, Never> {
        guard case .success(let store) = store else { return alreadyFinished() }
        guard store.migrate() else { return alreadyFinished() }
        switch tokenStore.token() {
        case .success(let token):
            store.configure(serverURL: configuredServer, authToken: token)
            return pull(store)
        case .failure(let error):
            // ⚠️ **A credential this Mac would not hand over is not an absent
            // one.** Configuring the server anyway sends every request
            // unauthenticated: the drain then takes 401s, which classify as
            // permanent, and the queued mutations get parked in the dead-letter
            // list over a Keychain that was merely locked. An unconfigured
            // engine still restores the cache and still accepts dispatches, so
            // the app stays usable while the banner says what actually happened.
            store.configure(serverURL: nil, authToken: nil)
            store.report(error)
            return alreadyFinished()
        }
    }

    /// Put a failed credential write where the user will see it.
    ///
    /// A Keychain that refuses the token is the one failure the Settings pane
    /// cannot leave implicit: the field shows what was typed either way, so
    /// without this the app claims a credential it does not have and the next
    /// sync fails as an unexplained 401.
    private func reportFailedWrite(_ error: CoreError?) {
        guard let error, case .success(let store) = store else { return }
        store.report(error)
    }

    /// Fetch once, now.
    ///
    /// ⚠️ **Configuring an engine does not fetch anything**, and nothing else
    /// was asking it to. `configure` calls `restore()`, which reads the *local
    /// cache*, and `refresh()`, which re-reads the engine's in-memory snapshot;
    /// neither touches the network. The engine's `autoSync` arms a pass **on
    /// dispatch** — its own test is named "auto sync arms a pass on dispatch
    /// without running it" — so a client that only ever reads would sit on an
    /// empty cache indefinitely.
    ///
    /// The result was that a fresh install showed an empty list forever while
    /// Settings reported "Connected", which is what being stuck looks like.
    /// Reported from real use; no test caught it because every test either
    /// seeds the cache or dispatches a mutation first.
    ///
    /// Both callers are the moments the app becomes configured: launch, and
    /// committing a new address or token. Failure needs no handling here — a
    /// sync records its own error on `status`, which the banner and the
    /// Settings pane already read.
    ///
    /// ⚠️ `_Concurrency.Task`, spelled in full. `Task` alone resolves to the
    /// core's own domain type here — the thing this app is a list of — and the
    /// resulting error is 26 missing arguments rather than anything mentioning
    /// concurrency.
    private func pull(_ store: TaskNotesStore) -> _Concurrency.Task<Void, Never> {
        _Concurrency.Task { await store.sync() }
    }

    /// A handle to nothing, for the paths where there is no store to fetch for.
    ///
    /// Returning a finished task rather than an optional keeps `await
    /// environment.start().value` a single unconditional line at every call
    /// site, including the one where the container could not be created.
    private func alreadyFinished() -> _Concurrency.Task<Void, Never> {
        _Concurrency.Task {}
    }

    /// The address as a `URL`, or `nil` when there is not one yet.
    private var configuredServer: URL? {
        let trimmed = serverAddress.trimmingWhitespace()
        guard !trimmed.isEmpty, let url = URL(string: trimmed), url.scheme != nil else {
            return nil
        }
        return url
    }

    /// Shared with the UI tests so a launch-argument override cannot drift
    /// from the key the app reads. See ``UITesting``.
    private static let serverAddressKey = UITesting.serverAddressDefaultsKey
}
