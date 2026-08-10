public import TaskNotesUniFFI

public import struct Foundation.Date
public import struct Foundation.TimeZone

/// The core's `Clock` over the system clock and the device's timezone database.
///
/// Both the instant source and the timezone are injectable, and both default to
/// the system's. That is not test scaffolding bolted on afterwards — it is the
/// same seam the Rust core has, and it is the only way to assert `localYmd`
/// against a timezone the developer's machine is not in.
public final class SystemClock: CoreClock {
    /// Where "now" comes from. A closure rather than a stored `Date` so a fixed
    /// clock and a live one are the same type.
    private let instant: @Sendable () -> Date

    /// `YYYY-MM-DD` in a fixed zone.
    ///
    /// `Date.ISO8601FormatStyle` rather than a `DateFormatter` because it is a
    /// value type and therefore `Sendable`: a `DateFormatter` stored on a class
    /// that has to be `Sendable` would need either a lock or a fresh instance
    /// per call. It is also locale-independent by construction, which a
    /// `DateFormatter` only is once someone remembers `en_US_POSIX`.
    private let ymd: Date.ISO8601FormatStyle

    /// The zone the viewer is in. Retained separately from ``ymd`` because the
    /// UTC offset cannot be read back out of a format style.
    private let timeZone: TimeZone

    /// A clock over the given timezone, reading the given instant source.
    public init(
        timeZone: TimeZone = .current,
        instant: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.instant = instant
        self.timeZone = timeZone
        self.ymd = Date.ISO8601FormatStyle(timeZone: timeZone).year().month().day()
    }

    public func nowMillis() -> Int64 {
        Self.millis(from: instant())
    }

    public func localYmd(millis: Int64) -> String {
        ymd.format(Self.date(fromMillis: millis))
    }

    /// Whole milliseconds since the epoch, rounding toward negative infinity.
    ///
    /// Floor rather than truncation so the conversion is monotone across the
    /// epoch: truncating toward zero would map both `-0.5 ms` and `+0.5 ms` to
    /// `0`, which puts a one-millisecond plateau at 1970 and makes the clock
    /// non-monotone there. `Date.now()` in JavaScript floors for the same
    /// reason.
    private static func millis(from date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1000).rounded(.down))
    }

    private static func date(fromMillis millis: Int64) -> Date {
        Date(timeIntervalSince1970: Double(millis) / 1000)
    }
}

extension SystemClock: ViewerCalendarSource {
    /// The viewer's day and zone, read at one instant.
    ///
    /// One `instant()` call for the day and the snapshot instant rather than
    /// two, so the pair cannot straddle a DST transition or a midnight and
    /// describe two different moments.
    ///
    /// The **zone** travels rather than the offset it has right now. An offset
    /// is a property of a viewer at an instant, and a task's date may fall in
    /// the other half of the year; ``ViewerCalendar`` resolves the offset per
    /// value against this zone's own database.
    public func viewerCalendar() -> ViewerCalendar {
        let now = instant()
        return ViewerCalendar(today: ymd.format(now), timeZone: timeZone, instant: now)
    }
}
