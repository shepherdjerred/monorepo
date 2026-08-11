public import Foundation

public struct ClaudeCodeProvider: UsageProvider {
  public let id = ProviderID.claudeCode
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
      headers: ["anthropic-beta": "oauth-2025-04-20"]
    )
    return try Self.parse(data: data)
  }

  public static func parse(data: Data, now: Date = .now) throws -> UsageSnapshot {
    let response = try ProviderDecoder.decode(
      ClaudeUsageResponse.self, from: data, provider: .claudeCode)
    var windowsByID: [String: UsageWindow] = [:]

    for (key, payload) in response.windows.sorted(by: { $0.key < $1.key }) {
      let descriptor = descriptor(for: key)
      let window = try UsageWindow.validated(
        id: descriptor.id,
        label: descriptor.label,
        kind: descriptor.kind,
        usedPercent: payload.usedPercent,
        resetAt: payload.resetAt,
        sourceTimestamp: now
      )
      try insert(window, into: &windowsByID)
    }
    for limit in response.limits {
      let descriptor = try descriptor(for: limit)
      let window = try UsageWindow.validated(
        id: descriptor.id,
        label: descriptor.label,
        kind: descriptor.kind,
        usedPercent: limit.usedPercent,
        resetAt: limit.resetAt,
        sourceTimestamp: now
      )
      try insert(window, into: &windowsByID)
    }

    let fableReturned = windowsByID.values.contains { window in
      window.id.contains("fable") || window.label.lowercased().contains("fable")
    }
    if !fableReturned {
      windowsByID["fable-policy"] = try UsageWindow.validated(
        id: "fable-policy",
        label: "Fable 5 policy",
        kind: .entitlement,
        usedPercent: nil,
        resetAt: nil,
        sourceTimestamp: now
      )
    }
    guard !response.windows.isEmpty || !response.limits.isEmpty else {
      throw QuotaError.unsupportedResponse(.claudeCode)
    }

    let notes =
      fableReturned
      ? []
      : ["Fable 5 may use up to 50% of the weekly allowance; no separate counter was returned."]
    return UsageSnapshot(
      provider: .claudeCode,
      windows: windowsByID.values.sorted { $0.label < $1.label },
      notes: notes,
      sourceTimestamp: now
    )
  }

  private static func descriptor(for key: String) -> WindowDescriptor {
    switch key {
    case "five_hour":
      return WindowDescriptor(
        id: "five-hour",
        label: "5-hour",
        kind: .rolling(durationSeconds: 18_000)
      )
    case "seven_day":
      return WindowDescriptor(id: "weekly", label: "Weekly", kind: .weekly)
    case let key where key.hasPrefix("seven_day_"):
      let model = title(key.replacingOccurrences(of: "seven_day_", with: ""))
      return WindowDescriptor(
        id: "weekly-\(slug(model))",
        label: "Weekly · \(model)",
        kind: .modelScoped(model: model)
      )
    default:
      let label = title(key)
      return WindowDescriptor(
        id: "provider-\(slug(label))",
        label: "Provider quota · \(label)",
        kind: .providerDefined
      )
    }
  }

  private static func descriptor(for limit: ClaudeLimit) throws -> WindowDescriptor {
    switch limit.kind {
    case "session":
      return WindowDescriptor(
        id: "five-hour",
        label: "5-hour",
        kind: .rolling(durationSeconds: 18_000)
      )
    case "weekly_all":
      return WindowDescriptor(id: "weekly", label: "Weekly", kind: .weekly)
    case "weekly_scoped":
      guard let modelName = limit.modelName,
        !modelName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      else {
        throw QuotaValidationError.invalidPairedFields
      }
      return scopedDescriptor(model: modelName)
    default:
      throw QuotaError.unsupportedResponse(.claudeCode)
    }
  }

  private static func scopedDescriptor(model: String) -> WindowDescriptor {
    WindowDescriptor(
      id: "weekly-\(slug(model))",
      label: "Weekly · \(model)",
      kind: .modelScoped(model: model)
    )
  }

  private static func insert(
    _ window: UsageWindow,
    into windowsByID: inout [String: UsageWindow]
  ) throws {
    if let existing = windowsByID[window.id], existing != window {
      throw QuotaValidationError.invalidPairedFields
    }
    windowsByID[window.id] = window
  }
}

private struct WindowDescriptor {
  let id: String
  let label: String
  let kind: WindowKind
}

private struct ClaudeUsageResponse: Decodable {
  let windows: [String: ClaudeWindow]
  let limits: [ClaudeLimit]

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: DynamicCodingKey.self)
    let limitsKey = DynamicCodingKey("limits")
    self.limits = try container.decodeIfPresent([ClaudeLimit].self, forKey: limitsKey) ?? []
    let metadataKeys = Set([
      "extra_usage",
      "limits",
      "member_dashboard_available",
      "spend",
    ])
    var windows: [String: ClaudeWindow] = [:]
    for key in container.allKeys {
      let name = key.stringValue
      guard !metadataKeys.contains(name), try !container.decodeNil(forKey: key) else { continue }
      if let window = try container.decodeIfPresent(ClaudeWindow.self, forKey: key) {
        windows[name] = window
      }
    }
    self.windows = windows
  }
}

private struct ClaudeWindow: Decodable {
  let usedPercent: Double?
  let resetAt: Date?

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: DynamicCodingKey.self)
    let percentageKeys = ["utilization", "used_percentage", "used_percent", "usage_percent"]
    let percentages = try percentageKeys.compactMap { name in
      try ProviderDecoder.number(in: container, forKey: DynamicCodingKey(name))
    }
    if let percentage = percentages.first,
      percentages.dropFirst().contains(where: { abs($0 - percentage) > 0.01 })
    {
      throw QuotaValidationError.invalidPairedFields
    }
    self.usedPercent = try ProviderDecoder.percentage(percentages.first)
    let resetDates = try ["resets_at", "reset_at", "resetAt"].compactMap { name in
      try ProviderDecoder.date(in: container, forKey: DynamicCodingKey(name))
    }
    if let resetAt = resetDates.first, resetDates.dropFirst().contains(where: { $0 != resetAt }) {
      throw QuotaValidationError.invalidPairedFields
    }
    self.resetAt = resetDates.first
    guard usedPercent != nil || resetAt != nil else {
      throw QuotaError.unsupportedResponse(.claudeCode)
    }
  }
}

private struct ClaudeLimit: Decodable {
  let kind: String
  let usedPercent: Double?
  let resetAt: Date?
  let modelName: String?

  enum CodingKeys: String, CodingKey {
    case kind
    case percent
    case resetAt = "resets_at"
    case scope
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.kind = try container.decode(String.self, forKey: .kind)
    guard !kind.isEmpty else { throw QuotaValidationError.emptyIdentifier }
    self.usedPercent = try ProviderDecoder.percentage(
      ProviderDecoder.number(in: container, forKey: .percent)
    )
    self.resetAt = try ProviderDecoder.date(in: container, forKey: .resetAt)
    self.modelName = try container.decodeIfPresent(ClaudeScope.self, forKey: .scope)?.model?
      .displayName
    guard usedPercent != nil || resetAt != nil else {
      throw QuotaError.unsupportedResponse(.claudeCode)
    }
  }
}

private struct ClaudeScope: Decodable {
  let model: ClaudeModel?
}

private struct ClaudeModel: Decodable {
  let displayName: String

  enum CodingKeys: String, CodingKey {
    case displayName = "display_name"
  }
}
