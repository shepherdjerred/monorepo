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

    /// The engine currently installed, if any.
    var current: (any FfiSyncEngineProtocol)? {
        slot.withLock { $0 }
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
