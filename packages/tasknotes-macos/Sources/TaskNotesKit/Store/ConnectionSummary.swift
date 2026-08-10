public import TaskNotesUniFFI

/// What the Settings pane says about the connection.
///
/// ## Why this is a type and not a `switch` in a view
///
/// There used to be two spellings of "what is the engine doing": ``SyncMessage``
/// for the banner, and a private `statusDescription` in `SettingsView`. They
/// diverged, as two spellings of one fact do. The Settings one reported `.idle`
/// as **"Connected"**, and `.idle` is also the state of an engine that has never
/// made a single request — so a fresh install with no address, a fresh install
/// with no token, and an app that had just failed to reach anything all read
/// "Connected". One reassuring word across four different situations, which is
/// worse than saying nothing.
///
/// Not folded into ``SyncMessage`` because they answer different questions.
/// `SyncMessage` decides whether to interrupt the screen at all, and is silent
/// in the common case; this always has an answer, because a field labelled
/// "Status" cannot be blank. It also needs a fact `SyncMessage` does not carry:
/// **`lastSyncTime`**. That is the whole distinguishing signal — an engine that
/// has never completed a pull has nothing to be connected *about*, whatever its
/// state says.
public struct ConnectionSummary: Sendable, Equatable {
    /// The situations the pane can be in.
    ///
    /// Seven, where the engine has five states, and the two extra ones are the
    /// point: a store that could not be built at all is not an engine state, and
    /// "idle, never synced" versus "idle, synced" is the split whose absence was
    /// the bug.
    public enum Reading: Sendable, Equatable, CaseIterable {
        /// The store itself could not be built — the app container is
        /// unwritable. Nothing below this matters until it is fixed.
        case unavailable

        /// Configured, no failure, and no completed pull yet.
        case neverSynced

        /// A pull has completed and nothing is wrong.
        case connected

        /// A pass is running right now.
        case syncing

        /// The last pass failed transiently; a retry is armed.
        case waitingToRetry

        /// The server rejected the credentials. No retry is armed.
        case authenticationFailed

        /// No server address has been entered.
        case noServer
    }

    public let reading: Reading

    /// The one string the pane shows.
    ///
    /// One title per reading, and no two readings share one — see
    /// `ConnectionSummaryTests`, which asserts that as a structural property
    /// rather than a list of expected strings. Collapsing two situations onto
    /// one word is not a cosmetic problem; it is exactly the defect this type
    /// exists to prevent.
    public var title: String {
        switch reading {
        case .unavailable: "Unavailable"
        case .neverSynced: "Not synced yet"
        case .connected: "Connected"
        case .syncing: "Syncing"
        case .waitingToRetry: "Waiting to retry"
        case .authenticationFailed: "Authentication failed"
        case .noServer: "No server configured"
        }
    }

    public init(reading: Reading) {
        self.reading = reading
    }

    /// Read an engine's state, plus the two facts that state alone cannot carry.
    ///
    /// - Parameters:
    ///   - status: the engine's own account of itself.
    ///   - lastSyncTime: when the last pull completed, or `nil` if none ever
    ///     has. ⚠️ This is what splits `.idle` in two, and leaving it out is the
    ///     bug.
    ///   - storeAvailable: whether there is an engine at all.
    /// - Returns: the one situation those three facts describe.
    ///
    /// Exhaustive over `SyncState`: `default:` is banned here precisely so a new
    /// state in the Rust enum becomes a compile error rather than silently
    /// rendering as one of the old ones.
    public static func of(
        status: SyncStatus,
        lastSyncTime: Int64?,
        storeAvailable: Bool
    ) -> ConnectionSummary {
        guard storeAvailable else { return ConnectionSummary(reading: .unavailable) }
        switch status.state {
        case .idle:
            return ConnectionSummary(reading: lastSyncTime == nil ? .neverSynced : .connected)
        case .syncing:
            return ConnectionSummary(reading: .syncing)
        case .backoff:
            return ConnectionSummary(reading: .waitingToRetry)
        case .authError:
            return ConnectionSummary(reading: .authenticationFailed)
        case .unconfigured:
            return ConnectionSummary(reading: .noServer)
        }
    }
}

extension ConnectionSummary {
    /// The summary for a store, or for the failure that prevented building one.
    ///
    /// `@MainActor` because the store's observable surface is, and this is the
    /// shape every caller in the shell actually has: a `Result` held by
    /// ``AppEnvironment``.
    @MainActor
    public static func of(store: Result<TaskNotesStore, CoreError>) -> ConnectionSummary {
        guard case .success(let store) = store else {
            return ConnectionSummary(reading: .unavailable)
        }
        return of(
            status: store.status,
            lastSyncTime: store.lastSyncTime,
            storeAvailable: true
        )
    }
}
