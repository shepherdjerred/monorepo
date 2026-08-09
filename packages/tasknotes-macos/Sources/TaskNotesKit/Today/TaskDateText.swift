public import TaskNotesUniFFI

// `Locale` is public because it appears in this type's initializer, which a
// caller with a pinned locale — a snapshot test, most obviously — has to be
// able to name. The rest follow it: Swift requires every import of a given
// module within one file to agree on its access level, and disagreeing is an
// error rather than a warning under this package's settings.
public import struct Foundation.Calendar
public import struct Foundation.Date
public import struct Foundation.Locale
public import struct Foundation.TimeZone

/// Turning a civil date into words, in the viewer's locale.
///
/// This is the short list the plan names as **deliberately left out of the
/// core**, because it is locale-bound: `formatDate`, `formatDayHeading`, and
/// the date-rendering tail of `formatRelativeDate`. Everything that *decides*
/// something about a date — is it today, is it overdue, which bucket, which
/// occurrence a completion targets — stays in Rust. This type only spells the
/// answer.
///
/// ## Why everything is pinned to GMT
///
/// The input is a **civil date**: a bare `YYYY-MM-DD` with no instant and no
/// zone. Foundation has no civil-date type, so it has to be carried as a `Date`
/// — and the moment a zone enters, the carrier starts lying. Parsing
/// `2026-07-22` in the viewer's zone and formatting it in the viewer's zone
/// happens to round-trip, but parsing in one and formatting in another shifts
/// the day. Pinning both ends to GMT makes the `Date` a pure carrier whose
/// calendar components are exactly the string's, which is the same discipline
/// the core's recurrence engine applies for the same reason.
///
/// The *locale* is emphatically not pinned: month names, weekday names, and
/// component order are the user's.
public struct TaskDateText: Sendable {
    private let isoDate: Date.ISO8601FormatStyle
    private let monthDay: Date.FormatStyle
    private let weekdayName: Date.FormatStyle
    private let dayHeading: Date.FormatStyle

    /// A formatter for a locale, defaulting to the system's.
    ///
    /// `autoupdatingCurrent` rather than `current`: a user who changes their
    /// region while the app is running should see the change, and the value
    /// type is rebuilt per derivation anyway.
    public init(locale: Locale = .autoupdatingCurrent) {
        var calendar = Calendar.autoupdatingCurrent
        calendar.timeZone = .gmt
        calendar.locale = locale

        self.isoDate = Date.ISO8601FormatStyle(timeZone: .gmt).year().month().day()
        let base = Date.FormatStyle(locale: locale, calendar: calendar, timeZone: .gmt)
        self.monthDay = base.month(.abbreviated).day()
        self.weekdayName = base.weekday(.wide)
        self.dayHeading = base.weekday(.wide).month(.wide).day()
    }

    /// `Jul 22` — the row badge for a date outside the coming week.
    func monthAndDay(_ date: String) throws(CoreError) -> String {
        monthDay.format(try instant(of: date))
    }

    /// `Wednesday` — the row badge for a date inside the coming week.
    func weekday(_ date: String) throws(CoreError) -> String {
        weekdayName.format(try instant(of: date))
    }

    /// `Wednesday, July 22` — the Today screen's day heading.
    ///
    /// Ports `formatDayHeading`, which hard-codes `en-US`; this does not, and
    /// the difference is intentional. The TypeScript app hard-codes `en-US`
    /// throughout, so matching it here would mean shipping a macOS app that
    /// prints American dates to a German user in order to agree with an app
    /// they do not have.
    public func dayHeading(_ date: String) throws(CoreError) -> String {
        dayHeading.format(try instant(of: date))
    }

    /// The `Date` carrying a civil date's components in GMT.
    ///
    /// - Throws: `CoreError.Validation` when the string is not a civil date.
    ///   The strings reaching here come from the core, so that is an invariant
    ///   breach rather than user input — and a formatter that quietly printed
    ///   the epoch instead would put "Jan 1, 1970" in a task row.
    private func instant(of date: String) throws(CoreError) -> Date {
        try CoreErrors.validating("\(date) is not a civil date this shell can format") {
            try isoDate.parse(date)
        }
    }
}
