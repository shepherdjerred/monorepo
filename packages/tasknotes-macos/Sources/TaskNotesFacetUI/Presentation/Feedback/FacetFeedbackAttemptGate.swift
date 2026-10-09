/// A receipt is never delayed for decoration. Rapid physical cues are dropped,
/// including haptic-only mode, using the shared cue duration on a monotonic clock.
internal struct FacetFeedbackAttemptGate {
    private var occupiedUntil: ContinuousClock.Instant?
    mutating func claim(duration: Duration, now: ContinuousClock.Instant = .now) -> Bool {
        if let occupiedUntil, now < occupiedUntil { return false }
        occupiedUntil = now.advanced(by: duration)
        return true
    }
}
