/// The parts-per-million scale the core's `Randomness` capability is defined
/// against.
///
/// The core takes an integer rather than a `Double` in `[0, 1)` on purpose. The
/// only consumer is the retry backoff's jitter, which has to produce an integer
/// millisecond delay, and parts-per-million arithmetic is exact — so the backoff
/// schedule is reproducible bit-for-bit across platforms, which is the point of
/// the cross-platform determinism check.
///
/// ⚠️ Declared here because the core's `UNIT_PPM` and `HALF_UNIT_PPM` are `pub
/// const`s that UniFFI does not export — there is no `unitPpm()` free function
/// in the bindings. These two values are therefore a transcription, and the
/// only defence against them drifting is that `HALF_UNIT_PPM` has an observable
/// consequence: it is the value that makes the jitter factor exactly 1.0, so a
/// test that pins ``FixedRandomness`` to ``half`` and asserts the bare
/// `[1000, 2000, … 60000]` schedule fails the moment either side moves.
public enum UnitPpm {
    /// One part per million: the divisor a drawn value is scaled against.
    public static let unit: UInt32 = 1_000_000

    /// The parts-per-million spelling of `0.5`.
    ///
    /// The shared scenario fixtures pin the TypeScript `Math.random()`
    /// injection to exactly `0.5`, so this is its exact counterpart.
    public static let half: UInt32 = 500_000
}
