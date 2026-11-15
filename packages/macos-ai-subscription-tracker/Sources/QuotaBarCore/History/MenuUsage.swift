public import Foundation

/// One other machine's usage today.
public struct MachineDailyUsage: Equatable, Sendable {
  public let machine: String
  public let usage: HistoryMeasuredUsage
}

/// One provider's usage today from the history daemon: this Mac, and every
/// machine once another one has usage today.
public struct ProviderDailyUsage: Equatable, Sendable {
  /// This Mac's usage, or `nil` when it has none today.
  public let thisMac: HistoryMeasuredUsage?
  /// This Mac plus every mirrored machine, or `nil` until another machine
  /// has usage today.
  public let allMachines: HistoryMeasuredUsage?
  /// Each other machine with usage today, most tokens first.
  public let otherMachines: [MachineDailyUsage]
  /// Models this provider used today that have no list price.
  public let unpricedModels: [String]

  /// `Today: 1.2M tok · $4.20`, or `nil` when this Mac has no usage today.
  public var caption: String? {
    thisMac.map { "Today: " + Self.amount($0) }
  }

  /// `All machines: 1.5M tok · ≥ $5.10`, or `nil` with no other machine.
  public var allMachinesCaption: String? {
    allMachines.map { "All machines: " + Self.amount($0) }
  }

  public var helpText: String {
    "Today's tokens and their API list-price estimate on this Mac, from the toolkit history "
      + "index. Not the subscription quota, the monthly invoice, or a credit balance."
      + unpricedNote
  }

  public var allMachinesHelpText: String {
    let parts = otherMachines.map { "\($0.machine): " + Self.amount($0.usage) }
    return "This Mac plus the machines brim sync mirrors, for this Mac's calendar day. "
      + parts.joined(separator: "; ") + "." + unpricedNote
  }

  private var unpricedNote: String {
    unpricedModels.isEmpty
      ? ""
      : " No list price for \(unpricedModels.joined(separator: ", ")), so the cost is a lower bound."
  }

  /// `1.2M tok · $4.20`, `≥ $4.20` when a model was unpriced, and `—` when
  /// nothing could be priced.
  static func amount(_ measured: HistoryMeasuredUsage) -> String {
    "\(HistoryFormat.tokens(measured.totalTokens)) tok · \(HistoryFormat.estimate(measured.usage))"
  }
}

/// Today's usage per provider, from one `/v1/usage?period=day` report broken
/// down by agent, model, and machine.
public struct DailyUsageSummary: Equatable, Sendable {
  public static let breakdown: [HistoryUsageDimension] = [.agent, .model, .machine]

  public let providers: [ProviderID: ProviderDailyUsage]

  public init(_ report: HistoryPeriodUsageReport) {
    var rows: [ProviderID: [HistoryUsageBreakdownRow]] = [:]
    for row in report.periods.flatMap(\.breakdown) {
      guard let provider = row.agent?.provider, row.measured.events > 0 else { continue }
      rows[provider, default: []].append(row)
    }
    let unpriced = Set(report.total.unpricedModels)
    providers = rows.mapValues { Self.summarize($0, unpriced: unpriced) }
  }

  public subscript(provider: ProviderID) -> ProviderDailyUsage? {
    providers[provider]
  }

  private static func summarize(
    _ rows: [HistoryUsageBreakdownRow], unpriced: Set<String>
  ) -> ProviderDailyUsage {
    var byMachine: [String?: HistoryMeasuredUsage] = [:]
    for row in rows {
      byMachine[row.machine] = (byMachine[row.machine] ?? .zero).adding(row.measured)
    }
    var others: [MachineDailyUsage] = []
    for case let (machine?, usage) in byMachine {
      others.append(MachineDailyUsage(machine: machine, usage: usage))
    }
    others.sort { lhs, rhs in
      if lhs.usage.totalTokens != rhs.usage.totalTokens {
        return lhs.usage.totalTokens > rhs.usage.totalTokens
      }
      return lhs.machine < rhs.machine
    }
    let all = byMachine.values.reduce(HistoryMeasuredUsage.zero) { $0.adding($1) }
    var models: Set<String> = []
    for row in rows where !row.measured.usage.costComplete {
      if let model = row.model, unpriced.contains(model) { models.insert(model) }
    }
    return ProviderDailyUsage(
      thisMac: byMachine[String?.none],
      allMachines: others.isEmpty ? nil : all,
      otherMachines: others,
      unpricedModels: models.sorted())
  }
}

/// What the menu bar reads from the history daemon on each refresh.
public struct MenuHistoryUsage: Equatable, Sendable {
  public let today: DailyUsageSummary
  /// Each provider's active 5-hour block across every machine.
  public let activeBlocks: [ProviderID: HistoryUsageBlock]

  public init(today: DailyUsageSummary, activeBlocks: [ProviderID: HistoryUsageBlock]) {
    self.today = today
    self.activeBlocks = activeBlocks
  }
}

extension HistoryUsageBlock {
  /// `Block $2.20 · $1.10/h · 2h 20m left`: the cost so far, the burn rate
  /// since the first event, and the time to the block's end.
  public func menuCaption(at date: Date) -> String {
    var parts = ["Block \(HistoryFormat.estimate(measured.usage))"]
    if let projection, isPriced {
      parts.append("\(HistoryFormat.dollars(projection.costPerHour))/h")
    }
    parts.append("\(QuotaTimeFormatter.compactCountdown(to: end, from: date)) left")
    return parts.joined(separator: " · ")
  }

  /// `Claude Code · $2.20 so far · $1.10/h · projected $4.77 · 2h 20m left`.
  public func timelineSummary(at date: Date) -> String {
    var parts = [agent.displayName, "\(HistoryFormat.estimate(measured.usage)) so far"]
    if let projection {
      if isPriced {
        parts.append("\(HistoryFormat.dollars(projection.costPerHour))/h")
        parts.append(
          "projected \(HistoryFormat.dollars(projection.projectedCostUSD)) · "
            + "\(HistoryFormat.tokens(projection.projectedTokens)) tok")
      } else {
        parts.append("projected \(HistoryFormat.tokens(projection.projectedTokens)) tok")
      }
    }
    parts.append("\(QuotaTimeFormatter.compactCountdown(to: end, from: date)) left")
    return parts.joined(separator: " · ")
  }

  /// Whether any of the block's usage has a list price; a rate or projected
  /// cost of an entirely unpriced block would read as free.
  private var isPriced: Bool {
    measured.usage.costComplete || measured.usage.costUSD > 0
  }

  /// The projection and what the block covers, for help text.
  public var helpText: String {
    var text =
      "This agent's current 5-hour usage block: \(HistoryFormat.tokens(measured.totalTokens)) "
      + "tokens and \(HistoryFormat.estimate(measured.usage)) at API list prices so far"
    if let projection {
      text +=
        ", \(HistoryFormat.tokens(Int(projection.tokensPerMinute.rounded()))) tokens a minute. "
        + "At this rate it reaches \(HistoryFormat.tokens(projection.projectedTokens)) tokens"
        + (isPriced ? " and \(HistoryFormat.dollars(projection.projectedCostUSD))" : "")
        + " by its end"
    }
    text += alignedToQuota ? ". It matches the provider's 5-hour quota window." : "."
    return text
  }
}
