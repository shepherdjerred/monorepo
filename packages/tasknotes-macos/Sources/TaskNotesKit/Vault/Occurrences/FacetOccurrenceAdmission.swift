import Synchronization

/// A pass may stop before actor admission without changing already owned receipts.
/// The final check inside the engine is the admission point for a new attempt.
public final class FacetOccurrenceAdmission: Sendable {
    private let cancelled = Mutex(false)
    public init() {}
    public var isCancelled: Bool { cancelled.withLock { $0 } }
    public func cancel() { cancelled.withLock { $0 = true } }
    internal func requireAdmission() throws {
        if isCancelled { throw CancellationError() }
    }
}
