internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

/// The banner states, built through `SyncMessage.of` rather than by hand.
///
/// Going through the real derivation is the point: it is what decides the
/// wording, the tone, and whether a retry button appears at all, and a fixture
/// that constructed `SyncMessage` directly could draw a banner the store can
/// never produce.
///
/// The four are deliberately a **severity sequence**, not four independent
/// pictures, and they are reviewed as one: `pending` (nothing is wrong) below
/// `offline` (wrong, and fixing itself) below `unconfigured`/`authError`
/// (wrong, and yours to fix). If two of them look equally alarming, that is the
/// defect — one orange triangle used to sit on three of them.
enum BannerVariant: String, CaseIterable, Sendable {
    /// Offline: the server did not answer and the engine is backing off.
    case offline
    /// Something local failed — a write, or a command the shell could not build.
    case error
    /// Work is queued and the engine is idle. The common, unalarming case.
    case pending
    /// No server has been set up yet. What a fresh launch shows.
    case unconfigured
    /// A server that answered and refused. The other case that needs Settings.
    case authError
    /// Work the server refused for good. The engine is fine; the change is not.
    case parked
    /// A credential this Mac holds and would not hand over.
    case credential

    func message() -> SyncMessage? {
        switch self {
        case .parked, .credential, .error: thisMac()
        case .authError, .offline, .pending, .unconfigured: engineState()
        }
    }

    /// The states the engine itself reports.
    private func engineState() -> SyncMessage? {
        switch self {
        case .parked, .credential, .error: nil
        case .authError:
            SyncMessage.of(
                status: SyncStatus(
                    state: .authError,
                    lastError: .Api(message: "Unauthorized", status: 401),
                    nextRetryAt: nil
                ),
                pendingCount: 0,
                storeError: nil
            )
        case .offline:
            SyncMessage.of(
                status: SyncStatus(
                    state: .backoff,
                    lastError: .Connection(
                        message: "Could not reach the server at tasknotes.local."),
                    nextRetryAt: nil
                ),
                pendingCount: 1,
                storeError: nil
            )
        case .pending:
            SyncMessage.of(
                status: SyncStatus(state: .idle, lastError: nil, nextRetryAt: nil),
                pendingCount: 3,
                storeError: nil
            )
        case .unconfigured:
            SyncMessage.of(
                status: SyncStatus(state: .unconfigured, lastError: nil, nextRetryAt: nil),
                pendingCount: 0,
                storeError: nil
            )
        }
    }

    /// The three failures that belong to this Mac, which outrank whatever
    /// the engine is reporting underneath them.
    private func thisMac() -> SyncMessage? {
        switch self {
        case .authError, .offline, .pending, .unconfigured: nil
        case .error:
            SyncMessage.of(
                status: SyncStatus(state: .idle, lastError: nil, nextRetryAt: nil),
                pendingCount: 0,
                storeError: .Validation(
                    message: "“next fridayy” is not a date this shell can read.")
            )
        case .parked:
            // The engine is `.idle` and reports nothing wrong, which is the
            // whole difficulty: parking a command is what let the drain carry
            // on, so this banner is the only thing that knows the user's edit
            // still exists somewhere.
            SyncMessage.of(
                status: SyncStatus(state: .idle, lastError: nil, nextRetryAt: nil),
                pendingCount: 0,
                storeError: nil,
                parkedCount: 2
            )
        case .credential:
            SyncMessage.of(
                status: SyncStatus(
                    state: .authError,
                    lastError: .Api(message: "Unauthorized", status: 401),
                    nextRetryAt: nil
                ),
                pendingCount: 0,
                storeError: nil,
                credentialError: .Invariant(
                    message: "could not read the stored server token (Keychain status -25308)")
            )
        }
    }
}
