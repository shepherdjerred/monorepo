public import TaskNotesUniFFI

/// The core's `Randomness` over the system's cryptographically secure generator.
///
/// `UInt32.random(in:)` draws from `SystemRandomNumberGenerator` and is
/// uniform over the half-open range with no modulo bias — which is the whole
/// requirement, since the only consumer is the retry backoff's jitter.
public final class SystemRandomness: Randomness {
    /// A generator over the system source.
    public init() {}

    public func nextUnitPpm() -> UInt32 {
        UInt32.random(in: 0..<UnitPpm.unit)
    }
}

/// The core's `Randomness`, always returning the same value.
///
/// The counterpart of the shared scenario corpus pinning `Math.random()` to
/// `0.5`: constructed with ``UnitPpm/half`` it yields a jitter factor of
/// exactly 1.0, so the engine's observed delays are the bare
/// `[1000, 2000, … 60000]` backoff schedule and a retry test can assert exact
/// numbers instead of a range.
///
/// Not test-only, and not in the test target on purpose: a deterministic
/// randomness source is also what a diagnostic or replay build wants, and the
/// value it returns is validated on the way in rather than trusted.
public final class FixedRandomness: Randomness {
    private let value: UInt32

    /// A source that always yields `ppm`.
    ///
    /// Returns `nil` when `ppm` is outside `[0, UnitPpm.unit)`. A failable
    /// initializer rather than a clamp: the core clamps defensively at its own
    /// boundary, but a host that was *asked* for an out-of-range constant has
    /// been given a broken value, and silently substituting a different one is
    /// the fallback this repository exists to avoid.
    public init?(ppm: UInt32) {
        guard ppm < UnitPpm.unit else { return nil }
        self.value = ppm
    }

    public func nextUnitPpm() -> UInt32 {
        value
    }
}
