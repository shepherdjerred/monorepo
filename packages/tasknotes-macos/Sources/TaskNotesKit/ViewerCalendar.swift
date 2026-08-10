// `internal`, unlike most files here: the core's `dateInstantMillis` is called
// from a method body and appears nowhere in this type's signatures.
internal import TaskNotesUniFFI

public import struct Foundation.Date
public import struct Foundation.TimeZone

/// Where the viewer is standing, frozen at one instant.
///
/// The core is sans-I/O and reads no clock, so every date question it answers
/// takes "today" as an argument. It also cannot know the device's timezone,
/// which is what decides the civil date a zoned `due` value falls on. Both
/// facts come from the host, and bundling them into one value is what stops
/// half a screen being derived against one instant and half against the next —
/// a real hazard around midnight, where a list rebuilt mid-render would show a
/// task as both overdue and due today.
///
/// Deliberately a snapshot rather than a live source: a view derives its whole
/// state from one of these, and two derivations from the same value are
/// identical by construction.
///
/// ## The zone is carried, not the offset it happens to have right now
///
/// A UTC offset is a property of a viewer *at an instant*, not of a viewer:
/// most zones move theirs twice a year. Carrying one captured offset and
/// spending it on every value a screen reads is an off-by-one-day bug for half
/// the year — in Los Angeles in January, `2026-07-10T07:30:00Z` resolves to the
/// 10th at that instant's `-07:00` and to the 9th at the reader's current
/// `-08:00`, so a July task lands in the wrong Today, the wrong Upcoming
/// window, and under the wrong day heading. ``utcOffsetSeconds(resolving:)`` is
/// what every date derivation goes through instead.
public struct ViewerCalendar: Sendable, Equatable, Hashable {
    /// The viewer's today, as `YYYY-MM-DD`.
    ///
    /// The user's local calendar day, not UTC's. This is the only sensible key
    /// for "does this task belong on Today" and for "which day did I click the
    /// checkbox on".
    public let today: String

    /// The zone the viewer is in, as the host's timezone database knows it.
    ///
    /// A `TimeZone` rather than an offset because it can answer for *any*
    /// instant, which is the whole point: the device's database is the same one
    /// the user's own clock reads, and it is the only thing that knows what the
    /// offset was on a date in another season.
    public let timeZone: TimeZone

    /// The instant this snapshot was taken at.
    ///
    /// What ``today`` was computed from, and the offset a value that names no
    /// instant of its own is resolved at.
    public let instant: Date

    public init(today: String, timeZone: TimeZone, instant: Date) {
        self.today = today
        self.timeZone = timeZone
        self.instant = instant
    }

    /// The viewer's offset from UTC in seconds, at the instant this snapshot
    /// was taken.
    ///
    /// Seconds rather than hours because offsets are not whole hours
    /// everywhere — Nepal is +05:45 — and not whole minutes historically.
    public var utcOffsetSeconds: Int32 {
        offsetSeconds(at: instant)
    }

    /// The offset to resolve one stored date value at.
    ///
    /// The core answers which instant a value names — `nil` for a civil date or
    /// a wall-clock reading, which it resolves without an offset at all — and
    /// the host's timezone database answers what the offset was *then*. Neither
    /// side can do both: the parse lives in the core so both clients read a
    /// frontmatter date the same way, and the database lives on the host so it
    /// is the same one the menu bar clock reads.
    ///
    /// A value naming no instant falls back to nothing: ``utcOffsetSeconds`` is
    /// the exact answer there, because the core is documented to ignore the
    /// offset for those two shapes.
    public func utcOffsetSeconds(resolving stored: String) -> Int32 {
        guard let millis = dateInstantMillis(raw: stored) else { return utcOffsetSeconds }
        return offsetSeconds(at: Date(timeIntervalSince1970: Double(millis) / 1000))
    }

    /// The zone's offset at one instant.
    ///
    /// The `Int32` conversion traps rather than clamping or truncating, which
    /// is the intended behaviour: `secondsFromGMT` is bounded well inside
    /// `Int32` by the tz database, so a value outside it means the platform
    /// broke a contract, and a clamped offset would silently move dates by a
    /// day rather than saying so.
    private func offsetSeconds(at instant: Date) -> Int32 {
        Int32(timeZone.secondsFromGMT(for: instant))
    }
}

/// The host capability of knowing where and when the viewer is.
///
/// Separate from the core's `Clock`, which answers epoch milliseconds and a
/// local `YYYY-MM-DD` for the *engine*'s benefit. This answers the same
/// question for the *UI*'s benefit and adds the timezone, which the engine
/// never needs and the presentation layer cannot work without.
public protocol ViewerCalendarSource: Sendable {
    /// The viewer's calendar, read now.
    func viewerCalendar() -> ViewerCalendar
}
