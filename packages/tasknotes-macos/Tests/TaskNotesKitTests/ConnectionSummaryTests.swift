import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

/// Every situation the Settings pane can be in, and the words it uses for them.
///
/// ## Why the full cross product
///
/// The bug was never in a single input. `.idle` on its own is not wrong, and
/// "Connected" on its own is not wrong; the defect lived in the *combination*
/// `.idle` **and** `lastSyncTime == nil` — an engine that has never made a
/// request, described as connected. A table of one row per `SyncState` would
/// have passed. So the table below is every `SyncState` × `lastSyncTime ∈ {nil,
/// set}` × store ∈ {available, unavailable}: twenty rows, each with its expected
/// reading written out here rather than derived from the implementation.
@Suite("What Settings says about the connection")
struct ConnectionSummaryTests {
    /// One row of the cross product.
    private struct Row {
        let state: SyncState
        let lastSyncTime: Int64?
        let storeAvailable: Bool
        /// Written by hand. Deriving it would make this file a mirror of the
        /// implementation and therefore incapable of disagreeing with it.
        let expected: ConnectionSummary.Reading

        var summary: ConnectionSummary {
            ConnectionSummary.of(
                status: SyncStatus(state: state, lastError: nil, nextRetryAt: nil),
                lastSyncTime: lastSyncTime,
                storeAvailable: storeAvailable
            )
        }

        var label: String {
            let sync = lastSyncTime == nil ? "never synced" : "synced"
            let store = storeAvailable ? "store available" : "store unavailable"
            return "\(state), \(sync), \(store)"
        }
    }

    private static let synced: Int64 = 1_753_000_000_000

    /// Every `SyncState`, listed by hand.
    ///
    /// UniFFI does not emit `CaseIterable`, so there is no `allCases` to read.
    /// A sixth case in the Rust enum is caught by the exhaustive switch in
    /// ``ConnectionSummary/of(status:lastSyncTime:storeAvailable:)`` — a compile
    /// error, which is strictly better than a test failure.
    private static let states: [SyncState] = [
        .idle, .syncing, .backoff, .authError, .unconfigured,
    ]

    /// Every combination, spelled out. Twenty rows, no loops generating them:
    /// a generated table would need a rule, and the rule is the thing under
    /// test.
    private static let rows: [Row] = [
        // ── The store could not be built. Nothing else can matter yet. ──────
        Row(state: .idle, lastSyncTime: nil, storeAvailable: false, expected: .unavailable),
        Row(state: .idle, lastSyncTime: synced, storeAvailable: false, expected: .unavailable),
        Row(state: .syncing, lastSyncTime: nil, storeAvailable: false, expected: .unavailable),
        Row(state: .syncing, lastSyncTime: synced, storeAvailable: false, expected: .unavailable),
        Row(state: .backoff, lastSyncTime: nil, storeAvailable: false, expected: .unavailable),
        Row(state: .backoff, lastSyncTime: synced, storeAvailable: false, expected: .unavailable),
        Row(state: .authError, lastSyncTime: nil, storeAvailable: false, expected: .unavailable),
        Row(state: .authError, lastSyncTime: synced, storeAvailable: false, expected: .unavailable),
        Row(state: .unconfigured, lastSyncTime: nil, storeAvailable: false, expected: .unavailable),
        Row(
            state: .unconfigured, lastSyncTime: synced, storeAvailable: false,
            expected: .unavailable
        ),

        // ── ⚠️ The pair the bug lived in. Same state, opposite answers. ─────
        Row(state: .idle, lastSyncTime: nil, storeAvailable: true, expected: .neverSynced),
        Row(state: .idle, lastSyncTime: synced, storeAvailable: true, expected: .connected),

        // ── The states that describe themselves. ────────────────────────────
        Row(state: .syncing, lastSyncTime: nil, storeAvailable: true, expected: .syncing),
        Row(state: .syncing, lastSyncTime: synced, storeAvailable: true, expected: .syncing),
        Row(state: .backoff, lastSyncTime: nil, storeAvailable: true, expected: .waitingToRetry),
        Row(state: .backoff, lastSyncTime: synced, storeAvailable: true, expected: .waitingToRetry),
        Row(
            state: .authError, lastSyncTime: nil, storeAvailable: true,
            expected: .authenticationFailed
        ),
        Row(
            state: .authError, lastSyncTime: synced, storeAvailable: true,
            expected: .authenticationFailed
        ),
        Row(state: .unconfigured, lastSyncTime: nil, storeAvailable: true, expected: .noServer),
        Row(state: .unconfigured, lastSyncTime: synced, storeAvailable: true, expected: .noServer),
    ]

    @Test("the table covers the whole cross product")
    func theTableIsComplete() {
        #expect(Self.rows.count == Self.states.count * 2 * 2)
        #expect(Set(Self.rows.map(\.label)).count == Self.rows.count, "no duplicate rows")
    }

    @Test("every situation reads the way it should")
    func everySituationReadsCorrectly() {
        for row in Self.rows {
            #expect(row.summary.reading == row.expected, "\(row.label)")
        }
    }

    /// ⚠️ **The structural assertion, and the only one here that is not a
    /// restatement of the implementation.**
    ///
    /// Two situations the table says are *different* must never produce the
    /// same words. That is the bug stated as a property rather than as a list of
    /// expected strings: "Connected" appearing for four unrelated situations was
    /// not a wrong string, it was a collision — and a collision is invisible to
    /// any assertion that only checks one row at a time.
    ///
    /// Verified by mutation: making `.idle` render "Connected" unconditionally
    /// turns this red, because the never-synced row and the synced row then
    /// share a title while the table says they are different situations.
    @Test("no two different situations share a title")
    func noTwoDifferentSituationsShareATitle() {
        for (leftIndex, left) in Self.rows.enumerated() {
            for right in Self.rows.dropFirst(leftIndex + 1) {
                guard left.expected != right.expected else { continue }
                #expect(
                    left.summary.title != right.summary.title,
                    """
                    "\(left.summary.title)" is used for both \(left.label) and \(right.label), \
                    which the table says are different situations.
                    """
                )
            }
        }
    }

    /// The same property one level down: the enum→string map itself is
    /// injective, so a reading added later cannot quietly borrow an existing
    /// word.
    @Test("every reading has its own title")
    func everyReadingHasItsOwnTitle() {
        let titles = ConnectionSummary.Reading.allCases.map { ConnectionSummary(reading: $0).title }
        #expect(Set(titles).count == titles.count, "\(titles)")
        #expect(titles.allSatisfy { !$0.isEmpty })
    }

    /// The `Result`-shaped entry point the shell actually calls, over the one
    /// input it can fail on.
    @Test("a store that could not be built reads as unavailable")
    @MainActor
    func aFailedStoreReadsAsUnavailable() {
        let failed: Result<TaskNotesStore, CoreError> = .failure(
            .Invariant(message: "Application Support is unwritable")
        )
        #expect(ConnectionSummary.of(store: failed).reading == .unavailable)
        #expect(ConnectionSummary.of(store: failed).title == "Unavailable")
    }
}
