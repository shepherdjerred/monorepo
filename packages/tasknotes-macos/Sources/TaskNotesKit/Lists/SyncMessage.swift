public import TaskNotesUniFFI

/// What the connection banner says, if anything.
///
/// ## A sync failure is a banner, never an exception
///
/// `syncNow()` records its failure in `status().lastError` and the store
/// publishes it; nothing throws out to a view. That is the whole offline-first
/// posture in one sentence — the work is queued and durable, the user is told
/// quietly, and the app keeps working. A modal alert here would be a lie about
/// how bad the situation is.
///
/// ## Two error channels, deliberately not merged
///
/// `status.lastError` is the *engine*'s view of the last sync failure.
/// `lastStoreError` is everything the store could not attribute to the engine —
/// a storage write that failed, a dispatch that was refused. Merging them would
/// let a local disk problem render as a network problem, so they stay separate
/// and the local one wins, because it is the one the user can act on.
public struct SyncMessage: Sendable, Equatable {
    /// How loudly to say it.
    ///
    /// Three levels rather than two, because "offline" and "no server
    /// configured" are not the same news and drawing them identically taught
    /// the wrong thing: one resolves itself in a minute and the other resolves
    /// itself never. The scale is severity in the only sense that matters to a
    /// reader — **how much of this is mine to fix.**
    public enum Tone: Sendable, Equatable, CaseIterable {
        /// Nothing is wrong. Work is queued and the engine will drain it.
        ///
        /// The quietest level on purpose: this state is *the app working*, and
        /// dressing it as a warning is how a user learns to distrust warnings.
        case informational

        /// The app cannot reach the server right now. Transient, self-healing,
        /// and already being retried on a backoff schedule.
        case degraded

        /// Sync cannot work until the user does something.
        case attention
    }

    /// What, if anything, the banner should offer the reader to do.
    ///
    /// A `Bool` could only say "retry / no retry", which is what put a **Try
    /// Again** button on a purely informational message and taught that a
    /// self-draining queue needs prodding. Naming the remedy makes the wrong
    /// pairing unspellable: ``Remedy/none`` is a real answer, and it is the
    /// right one whenever the app is already handling it.
    public enum Remedy: Sendable, Equatable, CaseIterable {
        /// Nothing to offer. Either it is already resolving itself, or no
        /// button on this banner could change the outcome.
        case none

        /// A manual pass now, rather than waiting out the backoff.
        case retry

        /// The Settings window, where the missing piece is entered.
        case openSettings
    }

    public let tone: Tone
    public let title: String

    /// The detail line, or `nil` when the title says everything.
    public let detail: String?

    /// What the banner offers the reader.
    ///
    /// Never a retry while a pass is already running — a second button press
    /// that does nothing teaches the user the button does nothing.
    public let remedy: Remedy

    /// The SF Symbol beside the message.
    ///
    /// Distinct per tone, so the glyph is a second channel carrying the same
    /// ordering as the colour rather than a decoration repeated across all
    /// three.
    ///
    /// ⚠️ **Informational is a straight arrow, not a circular one, and that is
    /// a fix rather than a preference.** Three near-identical two-arrow
    /// circular glyphs used to coexist in this app — `repeat` on a recurring
    /// row, `arrow.triangle.2.circlepath` on a queued row and on this banner,
    /// and `exclamationmark.arrow.triangle.2.circlepath` for a failing pass —
    /// so a recurring task waiting to sync drew two of them, at similar sizes
    /// in similar greys, meaning unrelated things. Queued work is going **up**
    /// to the server, which is a direction and not a loop; ``TaskRowView`` uses
    /// the same glyph for the same fact. Circular arrows are now spent on the
    /// one thing that genuinely goes round: retrying, and repeating.
    public var systemImage: String {
        switch tone {
        case .informational: "arrow.up.circle"
        case .degraded: "exclamationmark.arrow.triangle.2.circlepath"
        case .attention: "exclamationmark.triangle.fill"
        }
    }

    /// The banner for a store's current state, or `nil` when there is nothing
    /// worth interrupting the screen for.
    ///
    /// Silence is the common case and it is load-bearing: a banner that is
    /// always present is furniture, and furniture is invisible.
    public static func of(
        status: SyncStatus,
        pendingCount: UInt32,
        storeError: CoreError?
    ) -> SyncMessage? {
        if let storeError {
            return SyncMessage(
                tone: .attention,
                title: "Something went wrong on this Mac",
                detail: storeError.userMessage,
                remedy: .none
            )
        }

        switch status.state {
        case .authError:
            // Credentials are entered in Settings and nowhere else, so that is
            // the one place this banner can usefully send someone.
            return SyncMessage(
                tone: .attention,
                title: "The server rejected this app's credentials",
                detail: status.lastError?.userMessage,
                remedy: .openSettings
            )
        case .backoff:
            // Degraded rather than attention: the queue is durable, the engine
            // is already retrying on its own schedule, and the only thing a
            // reader gains by acting is not waiting out the backoff. That is
            // worth a button and not worth an alarm.
            return SyncMessage(
                tone: .degraded,
                title: pendingCount == 0 ? "Not syncing" : queuedTitle(pendingCount),
                detail: status.lastError?.userMessage ?? "Waiting to retry.",
                remedy: .retry
            )
        case .unconfigured:
            return SyncMessage(
                tone: .attention,
                title: "No server configured",
                detail: "Add the address of your TaskNotes server in Settings.",
                remedy: .openSettings
            )
        case .syncing:
            // Deliberately silent. The toolbar's refresh control already shows
            // a running pass, and two indicators for one fact is noise.
            return nil
        case .idle:
            guard pendingCount > 0 else { return nil }
            // ⚠️ **No remedy, deliberately.** The engine is idle with work
            // queued, which means a pass is already armed and will drain it
            // without anyone touching anything. A **Try Again** button here
            // would teach that manual retry is part of the normal loop, and the
            // lesson would then be carried across all fourteen remaining
            // screens.
            return SyncMessage(
                tone: .informational,
                title: queuedTitle(pendingCount),
                detail: nil,
                remedy: .none
            )
        }
    }

    private static func queuedTitle(_ count: UInt32) -> String {
        count == 1 ? "1 change waiting to sync" : "\(count) changes waiting to sync"
    }
}

extension CoreError {
    /// The message inside, without the enum's own debug spelling.
    ///
    /// UniFFI's `LocalizedError` conformance answers `String(reflecting:)`,
    /// which renders as `Api(message: "…", status: 503)` — accurate, and not
    /// something to put in front of a user. The exhaustive switch is on purpose:
    /// a seventh variant in the Rust enum must be a compile error here rather
    /// than silently falling into a generic sentence.
    public var userMessage: String {
        switch self {
        case .Invariant(let message): message
        case .Network(let message): message
        case .Api(let message, let status): status == 0 ? message : "\(message) (HTTP \(status))"
        case .Validation(let message): message
        case .NotFound(let message): message
        case .Connection(let message): message
        }
    }
}
