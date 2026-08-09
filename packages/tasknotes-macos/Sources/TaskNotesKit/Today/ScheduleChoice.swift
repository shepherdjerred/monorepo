public import TaskNotesUniFFI

internal import struct Foundation.Calendar
internal import struct Foundation.Date
internal import struct Foundation.DateComponents
internal import struct Foundation.TimeZone

/// The named dates a scheduling popover offers.
///
/// Three of the four resolve through the core, including the two that look like
/// trivial arithmetic. They are not: "this weekend" is *today* when it is
/// already Saturday, and "next week" on a Monday is the following Monday rather
/// than seven days out. Both readings are Todoist's, both are already ported
/// and tested in Rust, and re-deriving either here would be a second opinion on
/// a question the core has answered.
///
/// ⚠️ **"Tomorrow" is the exception, and it is a core gap rather than a
/// choice.** The core exports weekday *walks* (`dateNextMonday`,
/// `dateNextSaturday`, `dateNextWeekday`) but no plain day arithmetic — there
/// is no `date_add_days`, and `dateNextWeekday` is strictly-in-the-future so it
/// cannot be coaxed into answering "+1 day" without first knowing today's
/// weekday, which is also not exported. So tomorrow is computed here, against a
/// GMT-pinned proleptic Gregorian calendar where a civil day is exactly 86,400
/// seconds and no DST rule can shorten it. That is correct, and it is still one
/// more date rule a second shell would have to reproduce; it should move into
/// the core.
public enum ScheduleChoice: String, CaseIterable, Sendable, Hashable {
    /// Today.
    case today
    /// Tomorrow.
    case tomorrow
    /// The coming Saturday, or today when it is already Saturday.
    case thisWeekend
    /// The next Monday, always strictly in the future.
    case nextWeek
    /// Remove the date entirely.
    case none

    /// The menu label.
    public var title: String {
        switch self {
        case .today: "Today"
        case .tomorrow: "Tomorrow"
        case .thisWeekend: "This Weekend"
        case .nextWeek: "Next Week"
        case .none: "No Date"
        }
    }

    /// The SF Symbol beside the label.
    ///
    /// A symbol *name* rather than an `Image`, so this target stays free of
    /// SwiftUI.
    public var systemImage: String {
        switch self {
        case .today: "calendar"
        case .tomorrow: "sun.horizon"
        case .thisWeekend: "beach.umbrella"
        case .nextWeek: "calendar.badge.plus"
        case .none: "calendar.badge.minus"
        }
    }

    /// The date this choice means, as `YYYY-MM-DD`, or `nil` for ``none``.
    ///
    /// - Throws: `CoreError` when the viewer's today is unusable, or when a
    ///   walk runs off the end of the representable calendar — which no
    ///   four-digit year reaches, and which is reported rather than clamped
    ///   because there is no honest date to answer with.
    public func date(on calendar: ViewerCalendar) throws(CoreError) -> String? {
        switch self {
        case .none:
            return nil
        case .today:
            return calendar.today
        case .tomorrow:
            return try CivilDate.adding(days: 1, to: calendar.today)
        case .thisWeekend:
            return try walk("This Weekend") { try dateNextSaturday(from: calendar.today) }
        case .nextWeek:
            return try walk("Next Week") { try dateNextMonday(from: calendar.today) }
        }
    }

    /// ``date(on:)``, as a `Result`.
    ///
    /// See `TodayList.of` for why the wrapping happens in this module rather
    /// than at the SwiftUI call site.
    public func resolving(on calendar: ViewerCalendar) -> Result<String?, CoreError> {
        CoreErrors.capturing { () throws(CoreError) -> String? in
            try date(on: calendar)
        }
    }

    /// Run one of the core's weekday walks, reporting the end of the calendar.
    private func walk(
        _ what: String,
        _ body: () throws -> String?
    ) throws(CoreError) -> String {
        let walked = try CoreErrors.rethrowingCore("resolving \(what)", body)
        guard let walked else {
            throw CoreError.Invariant(
                message: "\(what) runs off the end of the representable calendar"
            )
        }
        return walked
    }
}

/// Civil-date arithmetic, pinned so a day is always a day.
///
/// Everything here operates in GMT on a proleptic Gregorian calendar, which is
/// what ISO 8601 `YYYY-MM-DD` already means. Pinning removes DST — the reason
/// "add 86,400 seconds" is wrong twice a year in most of the world — and
/// removes any dependence on the user's calendar preference, which must not
/// change what date a task is due.
enum CivilDate {
    private static let iso = Date.ISO8601FormatStyle(timeZone: .gmt).year().month().day()

    private static let gregorian: Calendar = {
        var pinned = Calendar(identifier: .gregorian)
        pinned.timeZone = .gmt
        return pinned
    }()

    /// `date` shifted by whole days.
    ///
    /// - Throws: `CoreError.Validation` when `date` is not a civil date, or
    ///   `CoreError.Invariant` when the shift leaves the representable
    ///   calendar. Neither is clamped: a silently shifted date is the failure
    ///   the whole shared-core exercise exists to prevent.
    static func adding(days: Int, to date: String) throws(CoreError) -> String {
        let start = try CoreErrors.validating("\(date) is not a civil date") {
            try iso.parse(date)
        }
        guard let shifted = gregorian.date(byAdding: DateComponents(day: days), to: start) else {
            throw CoreError.Invariant(
                message: "shifting \(date) by \(days) days leaves the representable calendar"
            )
        }
        return iso.format(shifted)
    }
}
