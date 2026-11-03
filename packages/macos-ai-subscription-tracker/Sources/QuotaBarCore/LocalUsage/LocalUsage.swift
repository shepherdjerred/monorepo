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

public struct LocalDailyUsage: Equatable, Sendable {
  public static let unreadableMessage = "Some local usage could not be read."
  public static let pricingUnavailableMessage = "API prices could not be loaded."

  public let provider: ProviderID
  public let totalTokens: Int
  public let estimatedCostUSD: Decimal?
  public let unpricedModels: [String]
  public let unreadable: Bool
  public let pricingUnavailable: Bool

  public init(
    provider: ProviderID,
    totalTokens: Int,
    estimatedCostUSD: Decimal?,
    unpricedModels: [String],
    unreadable: Bool,
    pricingUnavailable: Bool
  ) {
    self.provider = provider
    self.totalTokens = totalTokens
    self.estimatedCostUSD = estimatedCostUSD
    self.unpricedModels = unpricedModels
    self.unreadable = unreadable
    self.pricingUnavailable = pricingUnavailable
  }

  public var caption: String? {
    guard totalTokens > 0 else { return nil }
    let tokens = Self.tokenText(totalTokens)
    guard let estimatedCostUSD else { return "Today: \(tokens) tok" }
    let amount = estimatedCostUSD.formatted(Self.usd.locale(Locale(identifier: "en_US")))
    return "Today: \(tokens) tok · ~\(amount) API"
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
