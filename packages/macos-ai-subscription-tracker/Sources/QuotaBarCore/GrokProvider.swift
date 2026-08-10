public import Foundation

public struct GrokProvider: UsageProvider {
  public let id = ProviderID.grok
  private let client: ProviderHTTPClient
  private let userEndpoint: URL
  private let billingEndpoint: URL
  private let creditsEndpoint: URL

  public init(
    client: ProviderHTTPClient,
    userEndpoint: URL,
    billingEndpoint: URL,
    creditsEndpoint: URL
  ) {
    self.client = client
    self.userEndpoint = userEndpoint
    self.billingEndpoint = billingEndpoint
    self.creditsEndpoint = creditsEndpoint
  }

  public func fetch() async throws -> UsageSnapshot {
    let credential = try await client.resolveCredential(for: id)
    return try await fetch(usingCredential: credential)
  }

  /// Pins the identity, billing, and credits requests to one credential so a 401 on any single
  /// surface cannot leave the published snapshot combining an account label from one credential
  /// with usage data from another; a 401 on any surface restarts the complete fetch (identity
  /// included) with a replacement credential instead of letting each surface reload on its own.
  private func fetch(usingCredential credential: ProviderCredential) async throws -> UsageSnapshot {
    let identityData: Data
    do {
      identityData = try await client.get(
        provider: id, url: userEndpoint, credential: credential, headers: Self.headers())
    } catch QuotaError.unauthorized {
      return try await restartFetch(excluding: credential)
    }
    let identity = try Self.parseIdentity(data: identityData)
    let surfaceHeaders = Self.headers(userID: identity.userID)
    async let billingOutcome = captureAuthAwareSurface {
      try await client.get(
        provider: id, url: billingEndpoint, credential: credential, headers: surfaceHeaders)
    }
    async let creditsOutcome = captureAuthAwareSurface {
      try await client.get(
        provider: id, url: creditsEndpoint, credential: credential, headers: surfaceHeaders)
    }
    let billing = await billingOutcome
    let credits = await creditsOutcome
    if case .unauthorized = billing { return try await restartFetch(excluding: credential) }
    if case .unauthorized = credits { return try await restartFetch(excluding: credential) }
    return try Self.parse(
      billing: billing.surfaceResult,
      credits: credits.surfaceResult,
      accountLabel: identity.accountLabel
    )
  }

  private func restartFetch(excluding credential: ProviderCredential) async throws -> UsageSnapshot
  {
    let replacement = try await client.resolveCredential(for: id, excluding: credential)
    return try await fetch(usingCredential: replacement)
  }

  public static func parseIdentity(data: Data) throws -> GrokIdentity {
    let identity = try ProviderDecoder.decode(GrokIdentity.self, from: data, provider: .grok)
    guard !identity.userID.isEmpty else { throw QuotaValidationError.emptyIdentifier }
    return identity
  }

  public static func parseBilling(data: Data, now: Date = .now) throws -> [UsageWindow] {
    let response = try ProviderDecoder.decode(GrokBilling.self, from: data, provider: .grok)
    guard let limit = response.config.monthlyLimit, let used = response.config.used else {
      if response.config.monthlyLimit != nil || response.config.used != nil {
        throw QuotaValidationError.invalidPairedFields
      }
      throw QuotaError.unsupportedResponse(.grok)
    }
    guard limit > 0, 0...limit ~= used else { throw QuotaValidationError.invalidPairedFields }
    return [
      try UsageWindow.validated(
        id: "grok-monthly",
        label: "Monthly",
        kind: .monthly,
        usedPercent: used / limit * 100,
        resetAt: response.config.billingPeriodEnd,
        sourceTimestamp: now
      )
    ]
  }

  public static func parseCredits(data: Data, now: Date = .now) throws -> [UsageWindow] {
    let response = try ProviderDecoder.decode(GrokCredits.self, from: data, provider: .grok)
    var windows = try sharedCreditWindows(config: response.config, now: now)
    var productIDs: Set<String> = []
    for (name, metric) in response.config.productUsage.sorted(by: { $0.key < $1.key }) {
      let id = "grok-product-\(slug(name))"
      guard productIDs.insert(id).inserted else {
        throw QuotaValidationError.emptyIdentifier
      }
      windows.append(
        try UsageWindow.validated(
          id: id,
          label: title(name),
          kind: .modelScoped(model: title(name)),
          usedPercent: try metric.calculatedPercentage(),
          resetAt: metric.resetAt,
          sourceTimestamp: now
        )
      )
    }
    if let extra = response.config.extraCredits {
      windows.append(
        try UsageWindow.validated(
          id: "grok-extra-credits",
          label: "Extra credits",
          kind: .credits,
          usedPercent: try extra.calculatedPercentage(),
          resetAt: extra.resetAt,
          sourceTimestamp: now
        )
      )
    }
    guard !windows.isEmpty else { throw QuotaError.unsupportedResponse(.grok) }
    return windows
  }

  private static func sharedCreditWindows(
    config: GrokCreditsConfig,
    now: Date
  ) throws -> [UsageWindow] {
    guard config.creditUsagePercent != nil || config.currentPeriod != nil else { return [] }
    let period = config.currentPeriod
    let isWeekly = period?.kind == .weekly
    return [
      try UsageWindow.validated(
        id: "grok-shared-credits",
        label: isWeekly ? "Weekly" : "Shared credits",
        kind: isWeekly ? .weekly : .credits,
        usedPercent: config.creditUsagePercent,
        resetAt: period?.end,
        sourceTimestamp: now
      )
    ]
  }

  static func parse(
    billing: SurfaceResult,
    credits: SurfaceResult,
    accountLabel: String?,
    now: Date = .now
  ) throws -> UsageSnapshot {
    var windows: [UsageWindow] = []
    var warnings: [String] = []
    switch billing {
    case let .success(data):
      windows += try parseBilling(data: data, now: now)
    case let .failure(message): warnings.append("Monthly usage: \(message)")
    }
    switch credits {
    case let .success(data):
      windows += try parseCredits(data: data, now: now)
    case let .failure(message): warnings.append("Credit usage: \(message)")
    }
    guard !windows.isEmpty else { throw QuotaError.unsupportedResponse(.grok) }
    return UsageSnapshot(
      provider: .grok,
      accountLabel: accountLabel,
      windows: windows,
      notes: warnings,
      sourceTimestamp: now
    )
  }

  private static func headers(userID: String? = nil) -> [String: String] {
    var headers = [
      "X-XAI-Token-Auth": "xai-grok-cli",
      "x-grok-client-version": "3.12.0",
      "x-grok-client-mode": "headless",
    ]
    if let userID { headers["x-userid"] = userID }
    return headers
  }
}

public struct GrokIdentity: Decodable, Equatable, Sendable {
  public let userID: String
  public let email: String?

  public var accountLabel: String? { email }

  enum CodingKeys: String, CodingKey {
    case userID = "userId"
    case email
  }
}

private struct GrokBilling: Decodable {
  let config: GrokBillingConfig
}

private struct GrokBillingConfig: Decodable {
  let monthlyLimit: Double?
  let used: Double?
  let billingPeriodEnd: Date?

  enum CodingKeys: String, CodingKey {
    case monthlyLimit
    case used
    case billingPeriodEnd
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.monthlyLimit = try container.decodeIfPresent(GrokNumber.self, forKey: .monthlyLimit)?.value
    self.used = try container.decodeIfPresent(GrokNumber.self, forKey: .used)?.value
    self.billingPeriodEnd = try ProviderDecoder.date(in: container, forKey: .billingPeriodEnd)
  }
}

private struct GrokCredits: Decodable {
  let config: GrokCreditsConfig
}

private struct GrokCreditsConfig: Decodable {
  let creditUsagePercent: Double?
  let currentPeriod: GrokPeriod?
  let productUsage: [String: GrokMetric]
  let extraCredits: GrokMetric?

  enum CodingKeys: String, CodingKey {
    case creditUsagePercent
    case currentPeriod
    case productUsage
    case productBreakdown
    case extraCredits
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.creditUsagePercent = try ProviderDecoder.percentage(
      ProviderDecoder.number(in: container, forKey: .creditUsagePercent)
    )
    self.currentPeriod = try container.decodeIfPresent(GrokPeriod.self, forKey: .currentPeriod)
    let productUsage = try container.decodeIfPresent(
      [String: GrokMetric].self,
      forKey: .productUsage
    )
    let productBreakdown = try container.decodeIfPresent(
      [String: GrokMetric].self,
      forKey: .productBreakdown
    )
    if let productUsage, let productBreakdown, productUsage != productBreakdown {
      throw QuotaValidationError.invalidPairedFields
    }
    self.productUsage = productUsage ?? productBreakdown ?? [:]
    self.extraCredits = try container.decodeIfPresent(GrokMetric.self, forKey: .extraCredits)
  }
}

private struct GrokPeriod: Decodable {
  let kind: GrokPeriodKind
  let end: Date

  enum CodingKeys: String, CodingKey {
    case type
    case end
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.kind = try container.decode(GrokPeriodKind.self, forKey: .type)
    guard let end = try ProviderDecoder.date(in: container, forKey: .end) else {
      throw QuotaValidationError.invalidPairedFields
    }
    self.end = end
  }
}

private enum GrokPeriodKind: String, Decodable {
  case weekly
}

private struct GrokMetric: Decodable, Equatable {
  let limit: Double?
  let used: Double?
  let remaining: Double?
  let explicitPercentage: Double?
  let resetAt: Date?

  enum CodingKeys: String, CodingKey {
    case limit
    case used
    case remaining
    case creditUsagePercent
    case resetAt
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.limit = try ProviderDecoder.number(in: container, forKey: .limit)
    self.used = try ProviderDecoder.number(in: container, forKey: .used)
    self.remaining = try ProviderDecoder.number(in: container, forKey: .remaining)
    self.explicitPercentage = try ProviderDecoder.percentage(
      ProviderDecoder.number(in: container, forKey: .creditUsagePercent)
    )
    self.resetAt = try ProviderDecoder.date(in: container, forKey: .resetAt)
  }

  func calculatedPercentage() throws -> Double? {
    let calculated = try percentageFromAbsoluteCounters()
    if let explicitPercentage, let calculated,
      abs(explicitPercentage - calculated) > 0.01
    {
      throw QuotaValidationError.invalidPairedFields
    }
    let result = explicitPercentage ?? calculated
    guard result != nil || resetAt != nil else { throw QuotaError.unsupportedResponse(.grok) }
    return try ProviderDecoder.percentage(result)
  }

  private func percentageFromAbsoluteCounters() throws -> Double? {
    if limit == nil, used != nil || remaining != nil {
      throw QuotaValidationError.invalidPairedFields
    }
    guard let limit else { return nil }
    guard limit > 0 else { throw QuotaValidationError.invalidPairedFields }
    if let used {
      guard 0...limit ~= used else { throw QuotaValidationError.invalidPairedFields }
    }
    if let remaining {
      guard 0...limit ~= remaining else { throw QuotaValidationError.invalidPairedFields }
    }
    if let used, let remaining, abs(used + remaining - limit) > 0.01 {
      throw QuotaValidationError.invalidPairedFields
    }
    if let used { return used / limit * 100 }
    if let remaining { return (limit - remaining) / limit * 100 }
    return nil
  }
}

private struct GrokNumber: Decodable {
  let value: Double

  init(from decoder: any Decoder) throws {
    if let container = try? decoder.singleValueContainer(),
      let value = try? container.decode(Double.self)
    {
      self.value = value
      return
    }
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.value = try container.decode(Double.self, forKey: .value)
    guard value.isFinite else { throw QuotaValidationError.invalidPairedFields }
  }

  enum CodingKeys: String, CodingKey {
    case value = "val"
  }
}
