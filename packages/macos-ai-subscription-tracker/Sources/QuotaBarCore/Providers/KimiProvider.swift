public import Foundation

public struct KimiProvider: UsageProvider {
  public let id = ProviderID.kimi
  private let client: ProviderHTTPClient
  private let endpoint: URL
  private let meEndpoint: URL

  public init(client: ProviderHTTPClient, endpoint: URL, meEndpoint: URL) {
    self.client = client
    self.endpoint = endpoint
    self.meEndpoint = meEndpoint
  }

  private static let headers = ["User-Agent": "QuotaBar/1.0"]

  public func fetch() async throws -> UsageSnapshot {
    let credential = try await client.resolveCredential(for: id)
    return try await fetch(usingCredential: credential)
  }

  /// Usage and `/me` use one credential. Only a usage 401 restarts the fetch: the plan is
  /// supplementary, so its failures (401 included) leave it unset with a note.
  private func fetch(usingCredential credential: ProviderCredential) async throws -> UsageSnapshot {
    async let planResult = captureSurface {
      try await client.get(
        provider: id, url: meEndpoint, credential: credential, headers: Self.headers)
    }
    let usageData: Data
    do {
      usageData = try await client.get(
        provider: id, url: endpoint, credential: credential, headers: Self.headers)
    } catch QuotaError.unauthorized {
      _ = await planResult
      return try await restartFetch(excluding: credential)
    }
    let usage = try Self.parse(data: usageData)
    return PlanOutcome(await planResult, parse: Self.parsePlan).applied(to: usage)
  }

  private func restartFetch(excluding credential: ProviderCredential) async throws -> UsageSnapshot
  {
    do {
      let replacement = try await client.resolveCredential(for: id, excluding: credential)
      return try await fetch(usingCredential: replacement)
    } catch QuotaError.credentialsMissing {
      throw QuotaError.unauthorized(id)
    }
  }

  /// `/coding/v1/me` names the membership level: `user_level_name` ("Pro").
  public static func parsePlan(data: Data) throws -> PlanInfo? {
    PlanInfo(name: try JSONDecoder().decode(KimiMeResponse.self, from: data).levelName)
  }

  public static func parse(data: Data, now: Date = .now) throws -> UsageSnapshot {
    let response = try ProviderDecoder.decode(KimiEnvelope.self, from: data, provider: .kimi)
    let payload = try response.payload()
    var windows: [UsageWindow] = []
    if let usage = payload.usage {
      windows.append(try subscriptionWindow(usage, now: now))
    }
    // An absolute window counts whole units of its limit, so it is only as precise as
    // one unit (100 / limit percent); a ratio for the same window is exact.
    var unitPercent: [String: Double] = [:]
    for (index, limit) in payload.limits.enumerated() {
      let window = try limitWindow(limit, index: index, now: now)
      windows.append(window)
      if let units = limit.detail.limit { unitPercent[window.id] = 100 / units }
    }
    try appendRatioWindows(payload.usages, to: &windows, unitPercent: unitPercent, now: now)
    dropCodePoolMatchingTotal(from: &windows)
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
    unitPercent: [String: Double],
    now: Date
  ) throws {
    var seen = Set(windows.map(\.id))
    for key in usages.keys.sorted() {
      guard let ratio = usages[key] else { throw QuotaValidationError.emptyIdentifier }
      let descriptor = ratioDescriptor(for: key)
      let percent = ratio.usedPercent
      if descriptor.matchesFiveHour, let index = windows.firstIndex(where: isFiveHour) {
        let existing = windows[index]
        // The two may differ by the absolute window's rounding (one unit of its limit),
        // never by more: a larger gap is a contradictory response.
        let tolerance = max(0.01, unitPercent[existing.id] ?? 0)
        guard agrees(existing, percent: percent, resetAt: ratio.resetAt, tolerance: tolerance)
        else {
          throw QuotaValidationError.invalidPairedFields
        }
        if let percent {
          windows[index] = try UsageWindow.validated(
            id: existing.id,
            label: existing.label,
            kind: existing.kind,
            usedPercent: percent,
            resetAt: existing.resetAt,
            sourceTimestamp: existing.sourceTimestamp
          )
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

  /// The code pool is part of the monthly total. While all usage is code they report the
  /// same percentage and reset, so the code row repeats the total and is dropped; once
  /// they differ, both are shown.
  private static func dropCodePoolMatchingTotal(from windows: inout [UsageWindow]) {
    guard let total = windows.first(where: { $0.id == "kimi-monthly" }),
      let code = windows.first(where: { $0.id == "kimi-monthly-code" }),
      agrees(total, percent: code.usedPercent, resetAt: code.resetAt, tolerance: 0.01)
    else { return }
    windows.removeAll { $0.id == "kimi-monthly-code" }
  }

  private static func isFiveHour(_ window: UsageWindow) -> Bool {
    if case let .rolling(durationSeconds) = window.kind, durationSeconds == 18_000 { return true }
    return window.label == "5-hour"
  }

  private static func agrees(
    _ window: UsageWindow,
    percent: Double?,
    resetAt: Date?,
    tolerance: Double
  ) -> Bool {
    let percentAgrees: Bool
    switch (window.usedPercent, percent) {
    case (nil, nil): percentAgrees = true
    case let (left?, right?): percentAgrees = abs(left - right) <= tolerance
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

private struct KimiMeResponse: Decodable {
  let levelName: String?
  enum CodingKeys: String, CodingKey { case levelName = "user_level_name" }
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
