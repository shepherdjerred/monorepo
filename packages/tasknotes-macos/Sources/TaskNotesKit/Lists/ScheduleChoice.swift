public import TaskNotesUniFFI

/// The named dates a scheduling popover offers.
///
/// All of them resolve through the core, including the two that look like
/// trivial arithmetic. They are not: "this weekend" is *today* when it is
/// already Saturday, and "next week" on a Monday is the following Monday rather
/// than seven days out. Both readings are Todoist's, both are already ported
/// and tested in Rust, and re-deriving either here would be a second opinion on
/// a question the core has answered.
///
/// All four now resolve through the core. "Tomorrow" used to be the exception —
/// there was no `date_add_days`, and `dateNextWeekday` is strictly-in-the-future
/// so it could not be coaxed into answering "+1 day" — so it was computed here
/// against a GMT-pinned proleptic Gregorian calendar. That was correct and it
/// was still one more date rule a second shell would have had to reproduce.
/// The core exports `dateAddDays` now, and this asks it.
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
            return try walk("Tomorrow") { try dateAddDays(from: calendar.today, days: 1) }
        case .thisWeekend:
            return try walk("This Weekend") { try dateNextSaturday(from: calendar.today) }
        case .nextWeek:
            return try walk("Next Week") { try dateNextMonday(from: calendar.today) }
        }
    }

    /// ``date(on:)``, as a `Result`.
    ///
    /// See `TaskListModel.of` for why the wrapping happens in this module rather
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
