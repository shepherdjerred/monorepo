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
      headers: [
        "anthropic-beta": "oauth-2025-04-20",
        // Saved reset grants stay empty unless this request identifies as the Claude CLI.
        // A generic user agent is answered eligible:false, ineligible_reason:"surface".
        "User-Agent": "claude-cli/2.1.280 (external, cli)",
        "x-app": "cli",
      ]
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
    for limit in response.limits where !limit.isNimbusQuill {
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
    let resets = Self.resetInventory(from: data, now: now)
    return UsageSnapshot(
      provider: .claudeCode,
      plan: Self.plan(from: data),
      windows: windowsByID.values.sorted { $0.label < $1.label },
      resets: resets.resets,
      resetErrorMessage: resets.errorMessage,
      notes: notes,
      sourceTimestamp: now
    )
  }

  /// The plan tier (`claude_max_20x` → "Max 20x") from `cedar_ember.event_props`. The plan
  /// is supplementary, so an absent or unexpected block leaves it unset instead of failing.
  private static func plan(from data: Data) -> PlanInfo? {
    let tier = try? JSONDecoder().decode(ClaudePlanEnvelope.self, from: data).cedarEmber?
      .eventProps?.tier
    return PlanInfo(name: PlanName.humanized(tier, droppingPrefix: "claude"))
  }

  /// Reads `cedar_ember` from the same usage body. A missing or rejected inventory does not
  /// fail the quota windows; it becomes an explicit reset error instead of a fake empty list.
  private static func resetInventory(from data: Data, now: Date) -> ClaudeResetInventory {
    let envelope: ClaudeResetEnvelope
    do {
      envelope = try JSONDecoder().decode(ClaudeResetEnvelope.self, from: data)
    } catch {
      return ClaudeResetInventory(resets: [], errorMessage: ClaudeResetMessage.malformed)
    }
    switch envelope.state {
    case .missing, .null:
      return ClaudeResetInventory(resets: [], errorMessage: ClaudeResetMessage.missing)
    case .malformed:
      return ClaudeResetInventory(resets: [], errorMessage: ClaudeResetMessage.malformed)
    case let .parsed(block):
      if block.hasNoGrants {
        // "No grant" with grants listed contradicts itself.
        guard block.grants.isEmpty else {
          return ClaudeResetInventory(resets: [], errorMessage: ClaudeResetMessage.malformed)
        }
        return ClaudeResetInventory(resets: [], errorMessage: nil)
      }
      guard block.eligible else {
        return ClaudeResetInventory(resets: [], errorMessage: ClaudeResetMessage.ineligible)
      }
      return ClaudeResetInventory(resets: block.resets(at: now), errorMessage: nil)
    }
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
    // Every other top-level key is read as a usage window, so a new sibling object that is not
    // one must be listed here. `seven_day_breakdown` reports the weekly split per model as
    // `rows`, carrying neither a utilization nor a reset date, and the account surfaces the same
    // per-model figures through `seven_day_<model>` and `limits`. `weekly_scoped_shares` is the
    // same kind of sibling: an array of each scoped limit's share of the weekly allowance,
    // keyed by `limit_index`, with the per-model figures again carried by `limits`.
    // `iguana_necktie` is a codename dollar meter, not a session or weekly allowance.
    // `cedar_ember` is the saved usage-limit reset inventory and is parsed on its own.
    let metadataKeys = Set([
      "cedar_ember",
      "extra_usage",
      "iguana_necktie",
      "limits",
      "member_dashboard_available",
      "nimbus_quill",
      "seven_day_breakdown",
      "spend",
      "weekly_scoped_shares",
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

  var isNimbusQuill: Bool {
    guard kind == "weekly_scoped", let modelName else { return false }
    let normalized = modelName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return normalized == "nimbus quil" || normalized == "nimbus quill"
  }

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

private enum ClaudeResetMessage {
  static let missing = "Saved usage-limit resets were not returned."
  static let ineligible = "Saved usage-limit resets are not available for this account."
  static let malformed = "Saved usage-limit resets could not be read."
}

private struct ClaudeResetInventory {
  let resets: [Reset]
  let errorMessage: String?
}

private struct ClaudePlanEnvelope: Decodable {
  let cedarEmber: ClaudePlanBlock?
  enum CodingKeys: String, CodingKey { case cedarEmber = "cedar_ember" }
}

private struct ClaudePlanBlock: Decodable {
  let eventProps: ClaudePlanEventProps?
  enum CodingKeys: String, CodingKey { case eventProps = "event_props" }
}

private struct ClaudePlanEventProps: Decodable {
  let tier: String?
}

private struct ClaudeResetEnvelope: Decodable {
  enum State {
    case missing
    case null
    case malformed
    case parsed(ClaudeResetBlock)
  }

  let state: State

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let key = CodingKeys.cedarEmber
    guard container.contains(key) else {
      self.state = .missing
      return
    }
    if try container.decodeNil(forKey: key) {
      self.state = .null
      return
    }
    do {
      self.state = .parsed(try container.decode(ClaudeResetBlock.self, forKey: key))
    } catch {
      self.state = .malformed
    }
  }

  private enum CodingKeys: String, CodingKey {
    case cedarEmber = "cedar_ember"
  }
}

private struct ClaudeResetBlock: Decodable {
  let eligible: Bool
  let ineligibleReason: String?
  let grants: [ClaudeResetGrant]

  enum CodingKeys: String, CodingKey {
    case eligible
    case ineligibleReason = "ineligible_reason"
    case grants
  }

  /// `no_grant` answers the inventory: this account holds no saved resets right now.
  /// Any other ineligible reason (e.g. `surface`) means the inventory was withheld.
  var hasNoGrants: Bool { !eligible && ineligibleReason == "no_grant" }

  func resets(at now: Date) -> [Reset] {
    var resets: [Reset] = []
    for grant in grants where !grant.paused && grant.endsAt > now {
      for _ in 0..<grant.resetsLeft {
        resets.append(Reset(exp: grant.endsAt))
      }
    }
    return resets.sorted { $0.exp < $1.exp }
  }
}

private struct ClaudeResetGrant: Decodable {
  let resetsLeft: Int
  let endsAt: Date
  let paused: Bool

  enum CodingKeys: String, CodingKey {
    case resetsLeft = "resets_left"
    case endsAt = "ends_at"
    case paused
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let resetsLeft = try container.decode(Int.self, forKey: .resetsLeft)
    // One grant can carry several unused resets. Reject a corrupt count instead of
    // expanding it into an unbounded badge list. Grant ids and labels are never stored.
    guard (0...32).contains(resetsLeft) else { throw QuotaValidationError.invalidPairedFields }
    guard let endsAt = try ProviderDecoder.date(in: container, forKey: .endsAt) else {
      throw QuotaValidationError.invalidDate
    }
    self.resetsLeft = resetsLeft
    self.endsAt = endsAt
    self.paused = try container.decodeIfPresent(Bool.self, forKey: .paused) ?? false
  }
}
