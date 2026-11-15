public import Foundation

/// Display text for Sessions window values.
public enum HistoryFormat {
  /// `$14.52`, or `≥ $0.88` when a model was unpriced and the cost is a
  /// lower bound.
  public static func cost(_ usage: HistoryUsage) -> String {
    let amount = dollars(usage.costUSD)
    return usage.costComplete ? amount : "≥ \(amount)"
  }

  /// A list-price estimate: `cost(_:)`, or `—` when nothing was priced.
  public static func estimate(_ usage: HistoryUsage) -> String {
    !usage.costComplete && usage.costUSD == 0 ? noUsage : cost(usage)
  }

  public static func dollars(_ value: Double) -> String {
    if value > 0, value < 0.005 { return "<$0.01" }
    return value.formatted(.currency(code: "USD").locale(Locale(identifier: "en_US")))
  }

  /// Why a cost is partial, for help text; `nil` when it is complete.
  public static func costNote(_ usage: HistoryUsage) -> String? {
    usage.costComplete
      ? nil
      : "Partial: at least one model has no list price, so this is a lower bound."
  }

  /// `52.5B`, `6.1M`, `40.2K`, `1K`, `912`.
  public static func tokens(_ count: Int) -> String {
    if count >= 999_950_000 {
      let tenths = (count / 1_000 * 10 + 500_000) / 1_000_000
      return "\(tenths / 10).\(tenths % 10)B"
    }
    guard count >= 1_000 else { return String(count) }
    if count >= 999_950 { return millions(count) }
    let tenths = roundedTenths(count, unit: 1_000)
    if tenths >= 10_000 { return millions(count) }
    if tenths.isMultiple(of: 10) { return "\(tenths / 10)K" }
    return "\(tenths / 10).\(tenths % 10)K"
  }

  private static func millions(_ count: Int) -> String {
    let tenths = roundedTenths(count, unit: 1_000_000)
    return "\(tenths / 10).\(tenths % 10)M"
  }

  private static func roundedTenths(_ count: Int, unit: Int) -> Int {
    (count * 10 + unit / 2) / unit
  }

  /// The last path component of a workspace, on either path separator.
  public static func workspaceName(_ path: String) -> String {
    let parts = path.split(whereSeparator: { $0 == "/" || $0 == "\\" })
    return parts.last.map(String.init) ?? path
  }

  public static func machine(_ machine: String?) -> String {
    HistoryMachine(key: machine).displayName
  }

  /// `3h ago` within a week, then the date.
  public static func updated(_ date: Date, relativeTo now: Date) -> String {
    guard now.timeIntervalSince(date) >= 7 * 86_400 else {
      return QuotaTimeFormatter.refreshAge(since: date, at: now)
    }
    return date.formatted(.dateTime.year().month(.abbreviated).day())
  }

  /// Shown instead of a token count or cost for a session whose source
  /// recorded no usage.
  public static let noUsage = "—"
  public static let noUsageNote = "This agent's transcripts record no token usage."

  /// A session's cost, or `—` when its source recorded no usage.
  public static func cost(of session: HistorySession) -> String {
    session.hasUsage ? cost(session.usage) : noUsage
  }

  /// A session's tokens (`6.1M tok`), or `—` when its source recorded none.
  public static func tokens(of session: HistorySession) -> String {
    session.hasUsage ? "\(tokens(session.usage.totalTokens)) tok" : noUsage
  }
}
