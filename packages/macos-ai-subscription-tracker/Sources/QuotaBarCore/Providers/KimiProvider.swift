public import Foundation

public struct KimiProvider: UsageProvider {
  public let id = ProviderID.kimi
  private let client: ProviderHTTPClient
  private let endpoint: URL

  public init(client: ProviderHTTPClient, endpoint: URL) {
    self.client = client
    self.endpoint = endpoint
  }

  public func fetch() async throws -> UsageSnapshot {
    let data = try await client.get(
      provider: id,
      url: endpoint,
      headers: ["User-Agent": "QuotaBar/1.0"]
    )
    return try Self.parse(data: data)
  }

  public static func parse(data: Data, now: Date = .now) throws -> UsageSnapshot {
    let response = try ProviderDecoder.decode(KimiEnvelope.self, from: data, provider: .kimi)
    let payload = try response.payload()
    var windows: [UsageWindow] = []
    if let usage = payload.usage {
      windows.append(try subscriptionWindow(usage, now: now))
    }
    for (index, limit) in payload.limits.enumerated() {
      windows.append(try limitWindow(limit, index: index, now: now))
    }
    try appendRatioWindows(payload.usages, to: &windows, now: now)
    guard !windows.isEmpty else { throw QuotaError.unsupportedResponse(.kimi) }
    return UsageSnapshot(
      provider: .kimi,
      windows: windows,
      notes: ["Kimi Code subscriptions are separate from Kimi Open Platform API keys."],
      sourceTimestamp: now
    )
  }

  private static func subscriptionWindow(_ usage: KimiMetric, now: Date) throws -> UsageWindow {
    // The unscoped `usage` object does not name its period. Weekly and monthly pools
    // arrive as `limits` durations or `usages` keys, so this row stays unlabeled.
    try UsageWindow.validated(
      id: "kimi-subscription",
      label: "Subscription",
      kind: .providerDefined,
      usedPercent: try usage.calculatedPercentage(),
      resetAt: usage.resetAt,
      sourceTimestamp: now
    )
  }

  private static func limitWindow(
    _ limit: KimiLimit,
    index: Int,
    now: Date
  ) throws -> UsageWindow {
    let descriptor = try limit.window.descriptor()
    return try UsageWindow.validated(
      id: "kimi-\(index)-\(slug(descriptor.label))",
      label: descriptor.label,
      kind: descriptor.kind,
      usedPercent: try limit.detail.calculatedPercentage(),
      resetAt: limit.detail.resetAt,
      sourceTimestamp: now
    )
  }

  private static func appendRatioWindows(
    _ usages: [String: KimiRatio],
    to windows: inout [UsageWindow],
    now: Date
  ) throws {
    var seen = Set(windows.map(\.id))
    for key in usages.keys.sorted() {
      guard let ratio = usages[key] else { throw QuotaValidationError.emptyIdentifier }
      let descriptor = ratioDescriptor(for: key)
      let percent = ratio.usedPercent
      if descriptor.matchesFiveHour, let existing = windows.first(where: isFiveHour) {
        guard agrees(existing, percent: percent, resetAt: ratio.resetAt) else {
          throw QuotaValidationError.invalidPairedFields
        }
        continue
      }
      guard seen.insert(descriptor.id).inserted else { throw QuotaValidationError.emptyIdentifier }
      windows.append(
        try UsageWindow.validated(
          id: descriptor.id,
          label: descriptor.label,
          kind: descriptor.kind,
          usedPercent: percent,
          resetAt: ratio.resetAt,
          sourceTimestamp: now
        )
      )
    }
  }

  private static func isFiveHour(_ window: UsageWindow) -> Bool {
    if case let .rolling(durationSeconds) = window.kind, durationSeconds == 18_000 { return true }
    return window.label == "5-hour"
  }

  private static func agrees(_ window: UsageWindow, percent: Double?, resetAt: Date?) -> Bool {
    let percentAgrees: Bool
    switch (window.usedPercent, percent) {
    case (nil, nil): percentAgrees = true
    case let (left?, right?): percentAgrees = abs(left - right) <= 0.01
    default: percentAgrees = false
    }
    let resetAgrees: Bool
    switch (window.resetAt, resetAt) {
    case (nil, nil): resetAgrees = true
    case let (left?, right?): resetAgrees = abs(left.timeIntervalSince(right)) <= 2
    default: resetAgrees = false
    }
    return percentAgrees && resetAgrees
  }

  private static func ratioDescriptor(for key: String) -> KimiRatioDescriptor {
    switch key {
    case "limit_5h":
      return KimiRatioDescriptor(
        id: "kimi-5-hour",
        label: "5-hour",
        kind: .rolling(durationSeconds: 18_000),
        matchesFiveHour: true
      )
    case "limit_month_total":
      return KimiRatioDescriptor(
        id: "kimi-monthly",
        label: "Monthly",
        kind: .monthly,
        matchesFiveHour: false
      )
    case "limit_month_code":
      return KimiRatioDescriptor(
        id: "kimi-monthly-code",
        label: "Monthly · Code",
        kind: .monthly,
        matchesFiveHour: false
      )
    default:
      let name = key.hasPrefix("limit_") ? String(key.dropFirst("limit_".count)) : key
      let label = title(name)
      return KimiRatioDescriptor(
        id: "kimi-usage-\(slug(label))",
        label: label,
        kind: .providerDefined,
        matchesFiveHour: false
      )
    }
  }
}

private struct KimiRatioDescriptor {
  let id: String
  let label: String
  let kind: WindowKind
  let matchesFiveHour: Bool
}

private struct KimiEnvelope: Decodable {
  let usage: KimiMetric?
  let limits: [KimiLimit]
  let usages: [String: KimiRatio]
  let data: KimiPayload?

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.usage = try container.decodeIfPresent(KimiMetric.self, forKey: .usage)
    self.limits = try container.decodeIfPresent([KimiLimit].self, forKey: .limits) ?? []
    self.usages = try container.decodeIfPresent([String: KimiRatio].self, forKey: .usages) ?? [:]
    self.data = try container.decodeIfPresent(KimiPayload.self, forKey: .data)
  }

  func payload() throws -> KimiPayload {
    if let data {
      guard usage == nil, limits.isEmpty, usages.isEmpty else {
        throw QuotaValidationError.invalidPairedFields
      }
      return data
    }
    return KimiPayload(usage: usage, limits: limits, usages: usages)
  }

  private enum CodingKeys: String, CodingKey {
    case usage
    case limits
    case usages
    case data
  }
}

private struct KimiPayload: Decodable {
  let usage: KimiMetric?
  let limits: [KimiLimit]
  let usages: [String: KimiRatio]

  init(usage: KimiMetric?, limits: [KimiLimit], usages: [String: KimiRatio]) {
    self.usage = usage
    self.limits = limits
    self.usages = usages
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.usage = try container.decodeIfPresent(KimiMetric.self, forKey: .usage)
    self.limits = try container.decodeIfPresent([KimiLimit].self, forKey: .limits) ?? []
    self.usages = try container.decodeIfPresent([String: KimiRatio].self, forKey: .usages) ?? [:]
  }

  private enum CodingKeys: String, CodingKey {
    case usage
    case limits
    case usages
  }
}

private struct KimiRatio: Decodable {
  let usedPercent: Double?
  let resetAt: Date?

  enum CodingKeys: String, CodingKey {
    case usedRatio = "used_ratio"
    case resetTime = "reset_time"
    case resetTimeCamel = "resetTime"
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    if let ratio = try Self.number(in: container, forKey: .usedRatio) {
      guard 0...1 ~= ratio else { throw QuotaValidationError.invalidPercentage }
      self.usedPercent = try ProviderDecoder.percentage(ratio * 100)
    } else {
      self.usedPercent = nil
    }
    let snake = try ProviderDecoder.date(in: container, forKey: .resetTime)
    let camel = try ProviderDecoder.date(in: container, forKey: .resetTimeCamel)
    if let snake, let camel, snake != camel { throw QuotaValidationError.invalidPairedFields }
    self.resetAt = snake ?? camel
    guard usedPercent != nil || resetAt != nil else { throw QuotaError.unsupportedResponse(.kimi) }
  }

  private static func number(
    in container: KeyedDecodingContainer<CodingKeys>,
    forKey key: CodingKeys
  ) throws -> Double? {
    guard container.contains(key), try !container.decodeNil(forKey: key) else { return nil }
    if let value = try? container.decode(Double.self, forKey: key) {
      guard value.isFinite else { throw QuotaValidationError.invalidPercentage }
      return value
    }
    if let string = try? container.decode(String.self, forKey: key),
      let value = Double(string), value.isFinite
    {
      return value
    }
    throw DecodingError.typeMismatch(
      Double.self,
      DecodingError.Context(
        codingPath: container.codingPath + [key],
        debugDescription: "Expected a finite number or numeric string."
      )
    )
  }
}

private struct KimiLimit: Decodable {
  let window: KimiWindow
  let detail: KimiMetric
}

private struct KimiWindow: Decodable {
  let duration: Int
  let timeUnit: String

  func descriptor() throws -> KimiWindowDescriptor {
    Self.descriptor(for: try durationSeconds())
  }

  private func durationSeconds() throws -> Int {
    guard duration > 0 else { throw QuotaValidationError.invalidDuration }
    let normalizedUnit = timeUnit.uppercased()
    let unit =
      normalizedUnit.hasPrefix("TIME_UNIT_")
      ? String(normalizedUnit.dropFirst("TIME_UNIT_".count)) : normalizedUnit
    let multiplier = try Self.unitSeconds(unit)
    let (seconds, overflow) = duration.multipliedReportingOverflow(by: multiplier)
    guard !overflow, seconds > 0 else { throw QuotaValidationError.invalidDuration }
    return seconds
  }

  private static func unitSeconds(_ unit: String) throws -> Int {
    switch unit {
    case "SECOND", "SECONDS": 1
    case "MINUTE", "MINUTES": 60
    case "HOUR", "HOURS": 3_600
    case "DAY", "DAYS": 86_400
    case "WEEK", "WEEKS": 604_800
    default: throw QuotaError.unsupportedResponse(.kimi)
    }
  }

  private static func descriptor(for seconds: Int) -> KimiWindowDescriptor {
    switch seconds {
    case 18_000:
      return KimiWindowDescriptor(
        label: "5-hour",
        kind: .rolling(durationSeconds: seconds)
      )
    case 86_400:
      return KimiWindowDescriptor(label: "Daily", kind: .rolling(durationSeconds: seconds))
    case 604_800:
      return KimiWindowDescriptor(label: "Weekly", kind: .weekly)
    case 2_419_200...2_678_400:
      return KimiWindowDescriptor(label: "Monthly", kind: .monthly)
    default:
      return KimiWindowDescriptor(
        label: "Provider window · \(seconds)s",
        kind: .rolling(durationSeconds: seconds)
      )
    }
  }
}

private struct KimiWindowDescriptor {
  let label: String
  let kind: WindowKind
}

private struct KimiMetric: Decodable {
  let limit: Double?
  let used: Double?
  let remaining: Double?
  let explicitPercentage: Double?
  let resetAt: Date?

  enum CodingKeys: String, CodingKey {
    case limit
    case used
    case remaining
    case usedPercent = "used_percent"
    case usagePercent = "usage_percent"
    case resetAt = "resetTime"
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.limit = try Self.number(in: container, forKey: .limit)
    self.used = try Self.number(in: container, forKey: .used)
    self.remaining = try Self.number(in: container, forKey: .remaining)
    let usedPercent = try Self.number(in: container, forKey: .usedPercent)
    let usagePercent = try Self.number(in: container, forKey: .usagePercent)
    if let usedPercent, let usagePercent, abs(usedPercent - usagePercent) > 0.01 {
      throw QuotaValidationError.invalidPairedFields
    }
    let percentage = usedPercent ?? usagePercent
    self.explicitPercentage = try ProviderDecoder.percentage(percentage)
    self.resetAt = try ProviderDecoder.date(in: container, forKey: .resetAt)
  }

  private static func number(
    in container: KeyedDecodingContainer<CodingKeys>,
    forKey key: CodingKeys
  ) throws -> Double? {
    guard container.contains(key), try !container.decodeNil(forKey: key) else { return nil }
    if let value = try? container.decode(Double.self, forKey: key) {
      guard value.isFinite else { throw QuotaValidationError.invalidPercentage }
      return value
    }
    if let string = try? container.decode(String.self, forKey: key),
      let value = Double(string), value.isFinite
    {
      return value
    }
    throw DecodingError.typeMismatch(
      Double.self,
      DecodingError.Context(
        codingPath: container.codingPath + [key],
        debugDescription: "Expected a finite number or numeric string."
      )
    )
  }

  func calculatedPercentage() throws -> Double? {
    let absolutePercentage: Double?
    if limit == nil, used != nil || remaining != nil {
      throw QuotaValidationError.invalidPairedFields
    }
    if let limit {
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
      if let used {
        absolutePercentage = used / limit * 100
      } else if let remaining {
        absolutePercentage = (limit - remaining) / limit * 100
      } else {
        absolutePercentage = nil
      }
    } else {
      absolutePercentage = nil
    }
    if let explicitPercentage, let absolutePercentage,
      abs(explicitPercentage - absolutePercentage) > 0.01
    {
      throw QuotaValidationError.invalidPairedFields
    }
    let result = explicitPercentage ?? absolutePercentage
    guard result != nil || resetAt != nil else { throw QuotaError.unsupportedResponse(.kimi) }
    return try ProviderDecoder.percentage(result)
  }
}
