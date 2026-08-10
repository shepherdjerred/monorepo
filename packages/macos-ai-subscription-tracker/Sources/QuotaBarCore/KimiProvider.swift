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
      windows.append(
        try UsageWindow.validated(
          id: "kimi-shared-usage",
          label: "Shared usage",
          kind: .providerDefined,
          usedPercent: try usage.calculatedPercentage(),
          resetAt: usage.resetAt,
          sourceTimestamp: now
        )
      )
    }
    for (index, limit) in payload.limits.enumerated() {
      let descriptor = try limit.window.descriptor()
      windows.append(
        try UsageWindow.validated(
          id: "kimi-\(index)-\(slug(descriptor.label))",
          label: descriptor.label,
          kind: descriptor.kind,
          usedPercent: try limit.detail.calculatedPercentage(),
          resetAt: limit.detail.resetAt,
          sourceTimestamp: now
        )
      )
    }
    guard !windows.isEmpty else { throw QuotaError.unsupportedResponse(.kimi) }
    return UsageSnapshot(
      provider: .kimi,
      windows: windows,
      notes: ["Kimi Code subscriptions are separate from Kimi Open Platform API keys."],
      sourceTimestamp: now
    )
  }
}

private struct KimiEnvelope: Decodable {
  let usage: KimiMetric?
  let limits: [KimiLimit]
  let data: KimiPayload?

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.usage = try container.decodeIfPresent(KimiMetric.self, forKey: .usage)
    self.limits = try container.decodeIfPresent([KimiLimit].self, forKey: .limits) ?? []
    self.data = try container.decodeIfPresent(KimiPayload.self, forKey: .data)
  }

  func payload() throws -> KimiPayload {
    if let data {
      guard usage == nil, limits.isEmpty else { throw QuotaValidationError.invalidPairedFields }
      return data
    }
    return KimiPayload(usage: usage, limits: limits)
  }

  private enum CodingKeys: String, CodingKey {
    case usage
    case limits
    case data
  }
}

private struct KimiPayload: Decodable {
  let usage: KimiMetric?
  let limits: [KimiLimit]
}

private struct KimiLimit: Decodable {
  let window: KimiWindow
  let detail: KimiMetric
}

private struct KimiWindow: Decodable {
  let duration: Int
  let timeUnit: String

  func descriptor() throws -> KimiWindowDescriptor {
    guard duration > 0 else { throw QuotaValidationError.invalidDuration }
    let normalizedUnit = timeUnit.uppercased()
    let unit =
      normalizedUnit.hasPrefix("TIME_UNIT_")
      ? String(normalizedUnit.dropFirst("TIME_UNIT_".count)) : normalizedUnit
    let multiplier: Int
    switch unit {
    case "SECOND", "SECONDS": multiplier = 1
    case "MINUTE", "MINUTES": multiplier = 60
    case "HOUR", "HOURS": multiplier = 3_600
    case "DAY", "DAYS": multiplier = 86_400
    default: throw QuotaError.unsupportedResponse(.kimi)
    }
    let (seconds, overflow) = duration.multipliedReportingOverflow(by: multiplier)
    guard !overflow, seconds > 0 else { throw QuotaValidationError.invalidDuration }
    switch seconds {
    case 18_000:
      return KimiWindowDescriptor(
        label: "5-hour",
        kind: .rolling(durationSeconds: seconds)
      )
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
    let percentage =
      try Self.number(in: container, forKey: .usedPercent)
      ?? Self.number(in: container, forKey: .usagePercent)
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
