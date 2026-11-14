public import Foundation

/// How a quota window's remaining share compares with an even burn over its
/// whole duration, and when it runs out at the rate used so far.
///
/// `packages/toolkit/src/lib/brim/pace.ts` (`windowDurationSeconds` and
/// `computePace`) mirrors the duration and status rules for `toolkit brim`.
public struct WindowPacing: Equatable, Sendable {
  public enum Status: Equatable, Sendable {
    case ahead
    case onPace
    case behind
  }

  /// The time unit a pace is shown in: per hour for windows of a day or
  /// less, per day otherwise.
  public enum Unit: Equatable, Sendable {
    case hour
    case day

    public var seconds: TimeInterval {
      switch self {
      case .hour: 3_600
      case .day: 86_400
      }
    }

    fileprivate var suffix: String {
      switch self {
      case .hour: "h"
      case .day: "d"
      }
    }
  }

  public static let fiveHourDurationSeconds: TimeInterval = 5 * 3_600
  public static let weeklyDurationSeconds: TimeInterval = 7 * 86_400
  private static let onPaceTolerance = 0.15

  public let durationSeconds: TimeInterval
  public let secondsRemaining: TimeInterval
  public let unit: Unit
  /// Percent per `unit` that spends the whole window evenly.
  public let evenPace: Double
  /// Remaining percent per `unit` left until the reset.
  public let actualPace: Double
  public let status: Status
  /// When the window empties at the rate used since it began, if that is
  /// before its reset; `nil` when it lasts to the reset or nothing is used.
  public let runsOutAt: Date?

  public static func compute(window: UsageWindow, at date: Date) -> WindowPacing? {
    guard let remaining = window.remainingPercent,
      let resetAt = window.resetAt,
      let duration = duration(of: window)
    else {
      return nil
    }
    let secondsRemaining = resetAt.timeIntervalSince(date)
    guard secondsRemaining.isFinite, secondsRemaining > 0, secondsRemaining <= duration else {
      return nil
    }
    let unit: Unit = duration <= Unit.day.seconds ? .hour : .day
    let evenPace = 100 / (duration / unit.seconds)
    let actualPace = remaining / (secondsRemaining / unit.seconds)
    let status: Status
    if actualPace >= evenPace * (1 + onPaceTolerance) {
      status = .ahead
    } else if actualPace <= evenPace * (1 - onPaceTolerance) {
      status = .behind
    } else {
      status = .onPace
    }
    return WindowPacing(
      durationSeconds: duration,
      secondsRemaining: secondsRemaining,
      unit: unit,
      evenPace: evenPace,
      actualPace: actualPace,
      status: status,
      runsOutAt: runOut(
        remaining: remaining, elapsed: duration - secondsRemaining, at: date, resetAt: resetAt)
    )
  }

  /// A window's full duration: a rolling window's own, a week, the calendar
  /// month before the reset, or the period its label names (`5-hour`,
  /// `weekly`, `monthly`) for windows typed per model, such as
  /// Antigravity's buckets. `nil` for credits, policies, and unnamed periods.
  public static func duration(of window: UsageWindow) -> TimeInterval? {
    let label = window.label.lowercased()
    switch window.kind {
    case let .rolling(durationSeconds?):
      return TimeInterval(durationSeconds)
    case .entitlement:
      return nil
    case .weekly:
      return weeklyDurationSeconds
    case .monthly:
      return window.resetAt.flatMap(monthDuration(endingAt:))
    case .rolling, .modelScoped, .credits, .providerDefined:
      if label.contains("weekly") { return weeklyDurationSeconds }
      if label.contains("monthly") { return window.resetAt.flatMap(monthDuration(endingAt:)) }
      return label.contains("5-hour") ? fiveHourDurationSeconds : nil
    }
  }

  /// `20.0%/h` or `14.3%/d`.
  public func format(_ pace: Double) -> String {
    String(format: "%.1f%%/\(unit.suffix)", locale: Locale(identifier: "en_US_POSIX"), pace)
  }

  /// `runs out ~3:40 PM`, with the weekday when it is not today, or `nil`
  /// when the window lasts to its reset.
  public func runOutText(relativeTo date: Date, calendar: Calendar = .current) -> String? {
    guard let runsOutAt else { return nil }
    var style = Date.FormatStyle(date: .omitted, time: .shortened)
    style.timeZone = calendar.timeZone
    style.calendar = calendar
    if let locale = calendar.locale { style.locale = locale }
    if !calendar.isDate(runsOutAt, inSameDayAs: date) {
      style = style.weekday(.abbreviated)
    }
    return "runs out ~\(runsOutAt.formatted(style))"
  }

  private static func runOut(
    remaining: Double, elapsed: TimeInterval, at date: Date, resetAt: Date
  ) -> Date? {
    let used = 100 - remaining
    guard used > 0, remaining > 0, elapsed > 0 else { return nil }
    let runsOutAt = date.addingTimeInterval(remaining / (used / elapsed))
    return runsOutAt < resetAt ? runsOutAt : nil
  }

  private static func monthDuration(endingAt resetAt: Date) -> TimeInterval? {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .gmt
    return calendar.date(byAdding: .month, value: -1, to: resetAt).map {
      resetAt.timeIntervalSince($0)
    }
  }
}
