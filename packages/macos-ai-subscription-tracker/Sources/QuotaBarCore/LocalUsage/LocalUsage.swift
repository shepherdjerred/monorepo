public import Foundation

struct UsageTurn: Equatable, Sendable {
  var input = 0
  var output = 0
  var cacheCreate5m = 0
  var cacheCreate1h = 0
  var cacheCreateUnsplit = 0
  var cacheRead = 0
  var model = "unknown"
  var recordedCostUSD: Decimal?
  var timestamp = Date.distantPast

  var totalTokens: Int {
    input + output + cacheCreate5m + cacheCreate1h + cacheCreateUnsplit + cacheRead
  }

  var cacheCreateTokens: Int {
    cacheCreate5m + cacheCreate1h + cacheCreateUnsplit
  }
}

/// Today's usage on one other machine, read from its `brim sync` mirror.
public struct MachineDailyUsage: Equatable, Sendable {
  public let machineName: String
  public let totalTokens: Int
  public let estimatedCostUSD: Decimal?

  public init(machineName: String, totalTokens: Int, estimatedCostUSD: Decimal?) {
    self.machineName = machineName
    self.totalTokens = totalTokens
    self.estimatedCostUSD = estimatedCostUSD
  }
}

public struct LocalDailyUsage: Equatable, Sendable {
  public static let unreadableMessage = "Some local usage could not be read."
  public static let pricingUnavailableMessage = "API prices could not be loaded."
  public static let otherMachinesUnreadableMessage = "Other machines' usage could not be read."

  public let provider: ProviderID
  public let totalTokens: Int
  public let estimatedCostUSD: Decimal?
  public let unpricedModels: [String]
  public let unreadable: Bool
  public let pricingUnavailable: Bool
  /// Other machines with usage today, from the `brim sync` mirror.
  public let otherMachines: [MachineDailyUsage]
  public let otherMachinesUnreadable: Bool

  public init(
    provider: ProviderID,
    totalTokens: Int,
    estimatedCostUSD: Decimal?,
    unpricedModels: [String],
    unreadable: Bool,
    pricingUnavailable: Bool,
    otherMachines: [MachineDailyUsage] = [],
    otherMachinesUnreadable: Bool = false
  ) {
    self.provider = provider
    self.totalTokens = totalTokens
    self.estimatedCostUSD = estimatedCostUSD
    self.unpricedModels = unpricedModels
    self.unreadable = unreadable
    self.pricingUnavailable = pricingUnavailable
    self.otherMachines = otherMachines
    self.otherMachinesUnreadable = otherMachinesUnreadable
  }

  /// No usage on this Mac today; a base for other machines' totals.
  static func empty(_ provider: ProviderID) -> Self {
    Self(
      provider: provider,
      totalTokens: 0,
      estimatedCostUSD: .zero,
      unpricedModels: [],
      unreadable: false,
      pricingUnavailable: false
    )
  }

  func withOtherMachines(_ machines: [MachineDailyUsage], unreadable: Bool) -> Self {
    Self(
      provider: provider,
      totalTokens: totalTokens,
      estimatedCostUSD: estimatedCostUSD,
      unpricedModels: unpricedModels,
      unreadable: self.unreadable,
      pricingUnavailable: pricingUnavailable,
      otherMachines: machines,
      otherMachinesUnreadable: unreadable
    )
  }

  public var caption: String? {
    guard totalTokens > 0 else { return nil }
    return "Today: " + Self.amountText(tokens: totalTokens, cost: estimatedCostUSD)
  }

  /// This Mac plus every mirrored machine; `nil` until another one has usage.
  public var allMachinesCaption: String? {
    guard otherMachines.contains(where: { $0.totalTokens > 0 }) else { return nil }
    let tokens = totalTokens + otherMachines.reduce(0) { $0 + $1.totalTokens }
    var cost = totalTokens > 0 ? estimatedCostUSD : Decimal.zero
    for machine in otherMachines {
      cost = cost.flatMap { total in machine.estimatedCostUSD.map { total + $0 } }
    }
    return "All machines: " + Self.amountText(tokens: tokens, cost: cost)
  }

  public var helpText: String {
    var text =
      "API list-price estimate from local CLI logs for this Mac's calendar day. "
      + "It is not the subscription quota, not the monthly admin invoice, and not the credit balance."
    if !unpricedModels.isEmpty {
      text += " No list price is checked in for \(unpricedModels.joined(separator: ", "))."
    }
    return text
  }

  public var allMachinesHelpText: String {
    let parts = otherMachines.map {
      "\($0.machineName): " + Self.amountText(tokens: $0.totalTokens, cost: $0.estimatedCostUSD)
    }
    return "This Mac plus other machines' logs pulled by brim sync, counted for this Mac's "
      + "calendar day. " + parts.joined(separator: "; ") + "."
  }

  private static func amountText(tokens: Int, cost: Decimal?) -> String {
    let text = tokenText(tokens)
    guard let cost else { return "\(text) tok" }
    return "\(text) tok · ~\(cost.formatted(usd.locale(Locale(identifier: "en_US")))) API"
  }

  public static func tokenText(_ tokens: Int) -> String {
    guard tokens >= 1_000 else { return String(tokens) }
    if tokens >= 999_950 { return millions(tokens) }
    return thousands(tokens)
  }

  private static func millions(_ tokens: Int) -> String {
    let tenths = roundedTenths(tokens, unit: 1_000_000)
    return "\(tenths / 10).\(tenths % 10)M"
  }

  private static func thousands(_ tokens: Int) -> String {
    let tenths = roundedTenths(tokens, unit: 1_000)
    if tenths >= 10_000 { return millions(tokens) }
    if tenths.isMultiple(of: 10) { return "\(tenths / 10)K" }
    return "\(tenths / 10).\(tenths % 10)K"
  }

  private static func roundedTenths(_ tokens: Int, unit: Int) -> Int {
    (tokens * 10 + unit / 2) / unit
  }

  private static let usd = Decimal.FormatStyle.Currency(code: "USD")
}

enum LocalUsageMath {
  static func summarize(
    provider: ProviderID,
    turns: [UsageTurn],
    unreadable: Bool,
    pricingUnavailable: Bool,
    catalog: PricingCatalog?
  ) -> LocalDailyUsage? {
    let totals = totals(for: turns, catalog: catalog)
    guard totals.tokens > 0 || unreadable else { return nil }
    let missingPrice = pricingUnavailable && !totals.priced
    return LocalDailyUsage(
      provider: provider,
      totalTokens: totals.tokens,
      estimatedCostUSD: totals.priced ? totals.cost : nil,
      unpricedModels: totals.unpriced.sorted(),
      unreadable: unreadable,
      pricingUnavailable: missingPrice
    )
  }

  private static func totals(for turns: [UsageTurn], catalog: PricingCatalog?) -> DayTotals {
    var totals = DayTotals()
    for turn in turns {
      guard turn.totalTokens > 0 || turn.recordedCostUSD != nil else { continue }
      totals.tokens += turn.totalTokens
      guard let amount = PricingCatalog.cost(of: turn, using: catalog) else {
        totals.priced = false
        if catalog != nil { totals.unpriced.insert(turn.model) }
        continue
      }
      totals.cost += amount
    }
    return totals
  }

  private struct DayTotals {
    var tokens = 0
    var cost = Decimal.zero
    var priced = true
    var unpriced: Set<String> = []
  }
}
