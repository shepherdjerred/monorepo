internal import Dispatch
internal import Synchronization
public import TaskNotesUniFFI

public import struct Foundation.TimeInterval

/// The core's `RetryScheduler` over a serial dispatch queue.
///
/// ## How this avoids the no-cancellation trap
///
/// UniFFI 0.31 has no cancellation support for async calls at all, and the
/// repository's standing instruction is that cancellation must be an explicit
/// flag or `cancel()` call rather than something expected to propagate. This
/// implementation takes that literally:
///
/// **An armed timer is a `UInt64` in a set, and cancellation is its removal.**
/// There is no `_Concurrency.Task` to cancel, no `DispatchWorkItem` whose
/// `cancel()` races the dispatch, and no `Task.sleep` throwing `CancellationError`
/// that something has to remember to catch. The scheduled block always runs; it
/// then asks, under the same lock `cancel(timer:)` mutates, whether its id is
/// still armed, and returns without doing anything when it is not.
///
/// Three properties fall straight out of that, and each is a documented
/// requirement of the core's `RetryScheduler`:
///
///   * **`cancel` is idempotent.** `Set.remove` on an absent element is a no-op,
///     so cancelling an already-fired, already-cancelled, or entirely unknown
///     timer does nothing — which matters because the engine cancels the timer
///     it believes is armed at the top of every drain, *including the one that
///     just fired and caused that drain*.
///   * **A cancelled timer cannot fire.** The check and the removal happen in
///     one critical section, so `cancel` either wins (the block finds nothing
///     and returns) or loses (the block already removed the id and is
///     committed) — never both.
///   * **A fired timer cannot fire twice.** The fire path removes the id before
///     calling out, so a duplicate delivery finds nothing.
///
/// ## What fires
///
/// `onFire` is a Swift-side closure and stays on the Swift side. No closure
/// crosses the FFI boundary — UniFFI cannot express one, and a callback
/// interface with a throwing method reproduces uniffi-rs#2818. The host's job
/// is to turn the fire into a call to the engine's `requestSync()`.
///
/// The closure runs on this scheduler's private serial queue, never the main
/// thread. That is required rather than convenient: driving the engine calls
/// the synchronous ``URLSessionTaskApi``, which blocks.
public final class DispatchRetryScheduler: RetryScheduler {
    /// Everything mutable, behind one lock.
    private struct State {
        /// The next id to hand out. Starts at 1 so `0` is never a live handle.
        var nextTimerId: TimerId = 1

        /// Ids that have been armed and neither fired nor been cancelled.
        var armed: Set<TimerId> = []
    }

    private let state = Mutex(State())
    private let queue: DispatchQueue
    private let onFire: @Sendable (TimerId) -> Void

    /// A scheduler whose timers call `onFire` on a private serial queue.
    public init(
        label: String = "red.sjer.tasknotes.retry-scheduler",
        onFire: @escaping @Sendable (TimerId) -> Void
    ) {
        self.queue = DispatchQueue(label: label)
        self.onFire = onFire
    }

    public func arm(delayMillis: Int64) -> TimerId {
        let timer = state.withLock { current -> TimerId in
            let issued = current.nextTimerId
            current.nextTimerId += 1
            current.armed.insert(issued)
            return issued
        }

        // `Int(clamping:)` rather than `Int(_:)`: the engine's schedule tops out
        // at 60 s, but a host is not the place to trap on a value the core is
        // documented to clamp. libdispatch saturates a very large interval to
        // the distant future, which is the correct behaviour for one anyway.
        let delay = DispatchTimeInterval.milliseconds(Int(clamping: max(0, delayMillis)))
        queue.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self else { return }
            self.fire(timer)
        }
        return timer
    }

    public func cancel(timer: TimerId) {
        state.withLock { current in
            _ = current.armed.remove(timer)
        }
    }

    /// Drop every armed timer.
    ///
    /// What a host calls when it disposes the engine. Not part of the core's
    /// trait: the core cancels the single timer it tracks, and this covers the
    /// shutdown case where the host no longer has an engine to hand ids back
    /// to.
    public func cancelAll() {
        state.withLock { current in
            current.armed.removeAll()
        }
    }

    /// How many timers are armed right now.
    ///
    /// Exposed so a test can assert that a cancelled timer left no residue,
    /// which is the property most likely to rot silently.
    public var armedCount: Int {
        state.withLock { $0.armed.count }
    }

    private func fire(_ timer: TimerId) {
        let live = state.withLock { current in
            current.armed.remove(timer) != nil
        }
        guard live else { return }
        onFire(timer)
    }
}

extension DispatchRetryScheduler {
    /// The wall-clock delay a caller should expect for `delayMillis`.
    ///
    /// Exists so a test can wait on the same quantity the scheduler uses rather
    /// than a hard-coded sleep that drifts out of agreement with it.
    public static func interval(forDelayMillis delayMillis: Int64) -> TimeInterval {
        TimeInterval(max(0, delayMillis)) / 1000
    }
}
