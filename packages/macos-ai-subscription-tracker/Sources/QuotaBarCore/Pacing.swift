public import Foundation

public struct WindowPacing: Equatable, Sendable {
  public enum Status: Equatable, Sendable {
    case ahead
    case onPace
    case behind
  }

  public static let weeklyDurationSeconds: TimeInterval = 7 * 86_400
  private static let onPaceTolerance = 0.15

  public let evenPacePerDay: Double
  public let actualPacePerDay: Double
  public let daysRemaining: Double
  public let status: Status

  public static func compute(window: UsageWindow, at date: Date) -> WindowPacing? {
    guard window.kind == .weekly,
      let remaining = window.remainingPercent,
      let resetAt = window.resetAt
    else {
      return nil
    }
    let secondsRemaining = resetAt.timeIntervalSince(date)
    guard secondsRemaining.isFinite, secondsRemaining > 0,
      secondsRemaining <= weeklyDurationSeconds
    else {
      return nil
    }
    let daysRemaining = secondsRemaining / 86_400
    let evenPace = 100 / (weeklyDurationSeconds / 86_400)
    let actualPace = remaining / daysRemaining
    let status: Status
    if actualPace >= evenPace * (1 + onPaceTolerance) {
      status = .ahead
    } else if actualPace <= evenPace * (1 - onPaceTolerance) {
      status = .behind
    } else {
      status = .onPace
    }
    return WindowPacing(
      evenPacePerDay: evenPace,
      actualPacePerDay: actualPace,
      daysRemaining: daysRemaining,
      status: status
    )
  }

  public static func format(_ pacePerDay: Double) -> String {
    String(format: "%.1f%%/d", locale: Locale(identifier: "en_US_POSIX"), pacePerDay)
  }
}
