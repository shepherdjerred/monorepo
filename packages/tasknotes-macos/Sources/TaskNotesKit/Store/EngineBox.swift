internal import Dispatch
internal import Synchronization
internal import TaskNotesUniFFI

/// The engine slot, shared between the main actor and the blocking passes.
///
/// A class rather than a bare `Mutex` property, and that is forced rather than
/// stylistic: `Mutex` is `~Copyable`, so it cannot be captured by a closure or
/// passed to a `@concurrent` function. Wrapping it in a `Sendable` final class
/// gives the one thing both of those need — a shared reference — while the lock
/// itself stays the only way to reach the value.
///
/// It also gives the swap-on-reconfigure its own name. The core is explicit
/// that exactly one engine exists per configured server and that the old one
/// must be disposed before the new one runs, and ``replace(with:)`` is the
/// single place that ordering is expressed.
internal final class EngineBox: Sendable {
    private let slot = Mutex<(any FfiSyncEngineProtocol)?>(nil)

    /// The one thread engine calls made through ``run(_:)`` run on.
    ///
    /// Serial, so two dispatches reach the queue in the order the user made
    /// them, and a `DispatchQueue` rather than the cooperative pool because the
    /// work parks a thread on a lock a network request is holding — which is
    /// exactly what the pool's fixed width must not be spent on.
    private let executor = DispatchQueue(label: "red.sjer.tasknotes.mac.engine")

    /// The engine currently installed, if any.
    var current: (any FfiSyncEngineProtocol)? {
        slot.withLock { $0 }
    }

    /// Run one call against the installed engine, off the calling thread.
    ///
    /// ⚠️ **`FfiSyncEngine` is one mutex, and `syncNow()` holds it for the
    /// whole of a blocking drain.** Every other exported method — `dispatch`,
    /// `snapshot`, `status`, the dead-letter pair — takes that same lock, so
    /// calling one from the main actor makes the main thread wait on a network
    /// round trip: every window freezes until the request returns or times out.
    /// This is how the main actor asks the engine for something without ever
    /// touching the lock itself.
    ///
    /// Answers `nil` for an empty slot rather than taking the engine as a
    /// parameter, so the emptiness check happens on the same side of the hop as
    /// the call it guards — a slot read on the main actor could be replaced
    /// before the work started.
    func run<Value: Sendable>(
        _ body: @escaping @Sendable (any FfiSyncEngineProtocol) -> Value
    ) async -> Value? {
        await withCheckedContinuation { continuation in
            executor.async {
                continuation.resume(returning: self.current.map(body))
            }
        }
    }

    /// Install an engine, answering the one it displaced.
    ///
    /// The swap is atomic so nothing can observe an empty slot mid-replacement.
    /// Disposing the retired engine is the caller's job, deliberately: it
    /// throws, and a lock is the wrong place to be running FFI calls that can
    /// fail.
    func replace(with engine: (any FfiSyncEngineProtocol)?) -> (any FfiSyncEngineProtocol)? {
        slot.withLock { installed in
            let previous = installed
            installed = engine
            return previous
        }
    }
}

/// A one-slot connection from the scheduler's queue back to the store.
///
/// It exists for one reason, and the reason is a Swift initialisation rule
/// rather than a design preference: the scheduler's fire closure needs to reach
/// the store, but `self` cannot be captured until every stored property —
/// including `scheduler` — is initialised. The relay is created first, captured
/// by the closure, and connected on the last line of `init`, which is the first
/// point at which escaping `self` is legal.
///
/// `CoreError` rather than `any Error` because the payload crosses an isolation
/// boundary and has to be `Sendable`; the generated bindings declare
/// `extension CoreError: Sendable`, and `any Error` is not.
internal final class FireRelay: Sendable {
    private let target = Mutex<(@Sendable (CoreError?) -> Void)?>(nil)

    func connect(_ handler: @escaping @Sendable (CoreError?) -> Void) {
        target.withLock { installed in
            installed = handler
        }
    }

    func fire(_ error: CoreError?) {
        let handler = target.withLock { $0 }
        handler?(error)
    }
}
