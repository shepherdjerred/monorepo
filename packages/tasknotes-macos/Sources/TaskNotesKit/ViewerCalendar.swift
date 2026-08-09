/// Where the viewer is standing, frozen at one instant.
///
/// The core is sans-I/O and reads no clock, so every date question it answers
/// takes "today" as an argument. It also cannot know the device's UTC offset,
/// which is what decides the civil date a zoned `due` value falls on. Both
/// facts come from the host, and bundling them into one value is what stops
/// half a screen being derived against one instant and half against the next —
/// a real hazard around midnight, where a list rebuilt mid-render would show a
/// task as both overdue and due today.
///
/// Deliberately a snapshot rather than a live source: a view derives its whole
/// state from one of these, and two derivations from the same value are
/// identical by construction.
public struct ViewerCalendar: Sendable, Equatable, Hashable {
    /// The viewer's today, as `YYYY-MM-DD`.
    ///
    /// The user's local calendar day, not UTC's. This is the only sensible key
    /// for "does this task belong on Today" and for "which day did I click the
    /// checkbox on".
    public let today: String

    /// The viewer's offset from UTC in seconds, at that same instant.
    ///
    /// Seconds rather than hours because offsets are not whole hours
    /// everywhere — Nepal is +05:45 — and not whole minutes historically.
    public let utcOffsetSeconds: Int32

    public init(today: String, utcOffsetSeconds: Int32) {
        self.today = today
        self.utcOffsetSeconds = utcOffsetSeconds
    }
}

/// The host capability of knowing where and when the viewer is.
///
/// Separate from the core's `Clock`, which answers epoch milliseconds and a
/// local `YYYY-MM-DD` for the *engine*'s benefit. This answers the same
/// question for the *UI*'s benefit and adds the UTC offset, which the engine
/// never needs and the presentation layer cannot work without.
public protocol ViewerCalendarSource: Sendable {
    /// The viewer's calendar, read now.
    func viewerCalendar() -> ViewerCalendar
}
