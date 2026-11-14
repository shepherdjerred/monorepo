public import Foundation

/// The Analytics stacked cost and token charts: one bar per calendar period,
/// stacked by the selected breakdown dimension.
public struct UsagePeriodChart: Equatable, Sendable {
  /// The largest number of series shown; the rest are combined as `Other`.
  public static let maximumSeries = 8
  public static let otherSeries = "Other"

  /// One series' share of one period.
  public struct Point: Identifiable, Equatable, Sendable {
    public let periodStart: Date
    public let series: String
    public let costUSD: Double
    public let tokens: Int

    public var id: String { "\(periodStart.timeIntervalSince1970)|\(series)" }
  }

  public let period: HistoryUsagePeriod
  public let dimension: HistoryUsageDimension
  public let points: [Point]
  /// Series by total cost, then tokens, with `Other` last.
  public let series: [String]
  public let total: HistoryMeasuredUsage
  /// Periods with at least one usage event.
  public let activePeriods: Int
  public let unpricedModels: [String]

  public init(_ report: HistoryPeriodUsageReport, dimension: HistoryUsageDimension) {
    period = report.period
    self.dimension = dimension
    total = report.total.measured
    unpricedModels = report.total.unpricedModels
    activePeriods = report.periods.filter { $0.measured.events > 0 }.count

    var totals: [String: HistoryMeasuredUsage] = [:]
    for row in report.periods.flatMap(\.breakdown) {
      let label = Self.label(row.key(dimension), dimension: dimension)
      totals[label] = (totals[label] ?? .zero).adding(row.measured)
    }
    let ranked = totals.sorted { lhs, rhs in
      if lhs.value.usage.costUSD != rhs.value.usage.costUSD {
        return lhs.value.usage.costUSD > rhs.value.usage.costUSD
      }
      if lhs.value.totalTokens != rhs.value.totalTokens {
        return lhs.value.totalTokens > rhs.value.totalTokens
      }
      return lhs.key < rhs.key
    }
    .map(\.key)
    let shown =
      ranked.count > Self.maximumSeries
      ? Array(ranked.prefix(Self.maximumSeries - 1)) : ranked
    let shownSet = Set(shown)
    series = shown.count < ranked.count ? shown + [Self.otherSeries] : shown

    var points: [Point] = []
    for period in report.periods {
      var bySeries: [String: HistoryMeasuredUsage] = [:]
      for row in period.breakdown {
        let label = Self.label(row.key(dimension), dimension: dimension)
        let name = shownSet.contains(label) ? label : Self.otherSeries
        bySeries[name] = (bySeries[name] ?? .zero).adding(row.measured)
      }
      for name in series {
        guard let usage = bySeries[name] else { continue }
        points.append(
          Point(
            periodStart: period.start, series: name, costUSD: usage.usage.costUSD,
            tokens: usage.totalTokens))
      }
    }
    self.points = points
  }

  /// The display name of a breakdown key.
  public static func label(_ key: String?, dimension: HistoryUsageDimension) -> String {
    switch dimension {
    case .agent: key.flatMap(HistoryAgent.init(rawValue:))?.displayName ?? key ?? "Unknown agent"
    case .model: key ?? "Unknown model"
    case .project: key.map(HistoryFormat.workspaceName) ?? "No project"
    case .machine: HistoryFormat.machine(key)
    }
  }
}

/// The Analytics chart inputs that require a new `/v1/usage?period=…` read.
public struct UsagePeriodQuery: Hashable, Sendable {
  public let range: HistoryTimeRange
  public let period: HistoryUsagePeriod
  public let dimension: HistoryUsageDimension
}
