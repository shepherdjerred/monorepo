/// Six seconds of visible, unattended time. Focus/hover/Undo suspend expiry.
internal struct FacetFeedbackLifetime {
    private var identity: String?
    private var remaining: Duration = .seconds(6)
    private var deadline: ContinuousClock.Instant?

    mutating func select(_ id: String) {
        guard identity != id else { return }
        identity = id
        remaining = .seconds(6)
        deadline = nil
    }
    mutating func pause(now: ContinuousClock.Instant = .now) {
        if let deadline { remaining = max(.zero, now.duration(to: deadline)) }
        deadline = nil
    }
    mutating func resume(now: ContinuousClock.Instant = .now) -> Duration {
        if let deadline { return max(.zero, now.duration(to: deadline)) }
        deadline = now.advanced(by: remaining)
        return remaining
    }
}
