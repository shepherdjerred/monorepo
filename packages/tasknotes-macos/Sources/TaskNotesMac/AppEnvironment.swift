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
/// Two objects, not one, and the split is the point:
///
///   * ``navigation`` is **per window**. Two windows have two selections.
///   * ``store`` is **per vault**, shared by every window.
///
/// They live side by side rather than nested, because folding navigation into
/// the store is what makes a store impossible to test without a window.
@Observable
public final class AppEnvironment {
    /// Which sidebar destination is selected.
    public let navigation: NavigationState

    /// The task store, or the failure that prevented building one.
    ///
    /// A `Result` rather than a force-unwrapped store: the only thing that can
    /// fail is creating the app container's Application Support directory, and
    /// a sandboxed app that cannot do that should say so rather than crash on
    /// launch with no explanation.
    public let store: Result<TaskNotesStore, CoreError>

    /// The server address, as typed in Settings.
    ///
    /// Kept as the raw string rather than a `URL` so a half-typed address is
    /// representable while the user is typing one. Committing it is what turns
    /// it into an engine.
    public var serverAddress: String {
        didSet { defaults.set(serverAddress, forKey: Self.serverAddressKey) }
    }

    private let defaults: UserDefaults

    /// Assemble over the sandbox container.
    public init(defaults: UserDefaults = .standard) {
        self.navigation = NavigationState()
        self.store = TaskNotesStore.containerDefault()
        self.defaults = defaults
        self.serverAddress = defaults.string(forKey: Self.serverAddressKey) ?? ""
    }

    /// Assemble over an explicit store, for previews and tests.
    public init(
        navigation: NavigationState,
        store: Result<TaskNotesStore, CoreError>,
        defaults: UserDefaults = .standard
    ) {
        self.navigation = navigation
        self.store = store
        self.defaults = defaults
        self.serverAddress = defaults.string(forKey: Self.serverAddressKey) ?? ""
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
    public func start() {
        guard case .success(let store) = store else { return }
        store.migrate()
        store.configure(serverURL: configuredServer)
    }

    /// Apply a newly entered address, replacing the running engine.
    ///
    /// Reconfiguring builds a new engine over the same storage, which is how a
    /// server change is meant to be applied: the durable queue survives because
    /// it is on disk rather than in the engine, so nothing queued while
    /// pointing at the old address is lost.
    public func applyServerAddress() {
        guard case .success(let store) = store else { return }
        store.configure(serverURL: configuredServer)
    }

    /// The address as a `URL`, or `nil` when there is not one yet.
    ///
    /// ⚠️ **No auth token.** The plan puts the token in the platform keychain
    /// and passes it at engine construction; that pane is not built yet, so
    /// this reaches only a server with authentication disabled. It is
    /// deliberately *not* stashed in `UserDefaults` in the meantime — a
    /// bearer token in a plist that every process on the machine can read is
    /// worse than not having the feature.
    private var configuredServer: URL? {
        let trimmed = serverAddress.trimmingWhitespace()
        guard !trimmed.isEmpty, let url = URL(string: trimmed), url.scheme != nil else {
            return nil
        }
        return url
    }

    private static let serverAddressKey = "red.sjer.tasknotes.serverAddress"
}
