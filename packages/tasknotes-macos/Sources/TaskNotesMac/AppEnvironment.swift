public import Observation
public import TaskNotesKit
public import TaskNotesUniFFI

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

    /// Assemble over the sandbox container.
    public init() {
        self.navigation = NavigationState()
        self.store = TaskNotesStore.containerDefault()
    }

    /// Assemble over an explicit store, for previews and tests.
    public init(navigation: NavigationState, store: Result<TaskNotesStore, CoreError>) {
        self.navigation = navigation
        self.store = store
    }

    /// Bring the engine up.
    ///
    /// `migrate` must run before anything reads the queue, and
    /// `configure(serverURL: nil)` builds an *unconfigured* engine rather than
    /// none at all — the core treats "no server yet" as a state, and its queue
    /// accepts dispatches in that state, so the app is usable offline before a
    /// server has ever been entered.
    ///
    /// Idempotent, so calling it from a `.task` that re-runs is safe.
    public func start() {
        guard case .success(let store) = store else { return }
        store.migrate()
        store.configure(serverURL: nil)
    }
}
