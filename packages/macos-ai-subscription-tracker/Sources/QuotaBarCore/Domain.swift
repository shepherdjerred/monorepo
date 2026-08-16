public import Foundation

public enum ProviderID: String, CaseIterable, Codable, Identifiable, Sendable {
  case claudeCode = "claude-code"
  case codex
  case kimi
  case grok

  public var id: String { rawValue }

  public var displayName: String {
    switch self {
    case .claudeCode: "Claude Code"
    case .codex: "Codex"
    case .kimi: "Kimi Code"
    case .grok: "Grok"
    }
  }

  public var usageURL: URL? {
    switch self {
    case .claudeCode: URL(string: "https://claude.ai/settings/usage")
    case .codex: URL(string: "https://chatgpt.com/codex/settings/usage")
    case .kimi: URL(string: "https://www.kimi.com/code/console")
    case .grok: URL(string: "https://grok.com/settings/usage?_s=usage")
    }
  }
}

public struct SubscriptionPlan: Identifiable, Equatable, Sendable {
  public var id: ProviderID { provider }
  public let provider: ProviderID
  public let monthlyCostUSD: Int

  public static let active: [SubscriptionPlan] = [
    SubscriptionPlan(provider: .claudeCode, monthlyCostUSD: 200),
    SubscriptionPlan(provider: .codex, monthlyCostUSD: 200),
    SubscriptionPlan(provider: .kimi, monthlyCostUSD: 40),
    SubscriptionPlan(provider: .grok, monthlyCostUSD: 30),
  ]

  public static var totalMonthlyCostUSD: Int {
    active.reduce(0) { total, plan in total + plan.monthlyCostUSD }
  }

  public static func plan(for provider: ProviderID) -> SubscriptionPlan {
    guard let plan = active.first(where: { $0.provider == provider }) else {
      preconditionFailure("Missing subscription plan for \(provider.rawValue)")
    }
    return plan
  }
}

public enum WindowKind: Equatable, Codable, Sendable {
  case rolling(durationSeconds: Int?)
  case weekly
  case monthly
  case modelScoped(model: String)
  case credits
  case providerDefined
  case entitlement
}

public struct UsageWindow: Identifiable, Equatable, Codable, Sendable {
  public let id: String
  public let label: String
  public let kind: WindowKind
  public let usedPercent: Double?
  public let resetAt: Date?
  public let sourceTimestamp: Date

  public var remainingPercent: Double? {
    usedPercent.map { 100 - $0 }
  }

  public var compactDisplayLabel: String {
    switch kind {
    case .rolling:
      return label == "5-hour" ? label : "Rolling"
    case .weekly:
      return label.count <= 18 ? label : "Weekly"
    case .monthly:
      return label.count <= 18 ? label : "Monthly"
    case .modelScoped(let model):
      if label.count <= 18 { return label }
      if label.localizedCaseInsensitiveContains("weekly") {
        return "Weekly · \(model)"
      }
      return model
    case .credits:
      return label.count <= 18 ? label : "Credits"
    case .providerDefined:
      let prefix = "Provider quota · "
      if label.hasPrefix(prefix) {
        let detail = String(label.dropFirst(prefix.count))
        return detail.count <= 18 ? detail : "Provider quota"
      }
      return label.count <= 18 ? label : "Provider window"
    case .entitlement:
      return label == "Fable 5 policy" ? "Provider quota" : "Policy"
    }
  }

  public static func validated(
    id: String,
    label: String,
    kind: WindowKind,
    usedPercent: Double?,
    resetAt: Date?,
    sourceTimestamp: Date
  ) throws -> UsageWindow {
    guard !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw QuotaValidationError.emptyIdentifier
    }
    guard !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw QuotaValidationError.emptyLabel
    }
    if let usedPercent {
      guard usedPercent.isFinite, 0...100 ~= usedPercent else {
        throw QuotaValidationError.invalidPercentage
      }
    }
    if case let .rolling(durationSeconds) = kind, let durationSeconds, durationSeconds <= 0 {
      throw QuotaValidationError.invalidDuration
    }
    return UsageWindow(
      id: id,
      label: label,
      kind: kind,
      usedPercent: usedPercent,
      resetAt: resetAt,
      sourceTimestamp: sourceTimestamp
    )
  }

  private init(
    id: String,
    label: String,
    kind: WindowKind,
    usedPercent: Double?,
    resetAt: Date?,
    sourceTimestamp: Date
  ) {
    self.id = id
    self.label = label
    self.kind = kind
    self.usedPercent = usedPercent
    self.resetAt = resetAt
    self.sourceTimestamp = sourceTimestamp
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self = try Self.validated(
      id: container.decode(String.self, forKey: .id),
      label: container.decode(String.self, forKey: .label),
      kind: container.decode(WindowKind.self, forKey: .kind),
      usedPercent: container.decodeIfPresent(Double.self, forKey: .usedPercent),
      resetAt: container.decodeIfPresent(Date.self, forKey: .resetAt),
      sourceTimestamp: container.decode(Date.self, forKey: .sourceTimestamp)
    )
  }
}

public struct Reset: Equatable, Codable, Sendable {
  public let exp: Date

  public init(exp: Date) {
    self.exp = exp
  }
}

public enum SnapshotFreshness: Equatable, Codable, Sendable {
  case current
  case stale(reason: String)
}

public struct UsageSnapshot: Equatable, Codable, Sendable {
  public let provider: ProviderID
  public let accountLabel: String?
  public let windows: [UsageWindow]
  public let resets: [Reset]
  public let resetErrorMessage: String?
  public let notes: [String]
  public let sourceTimestamp: Date
  public let freshness: SnapshotFreshness

  public init(
    provider: ProviderID,
    accountLabel: String? = nil,
    windows: [UsageWindow],
    resets: [Reset] = [],
    resetErrorMessage: String? = nil,
    notes: [String] = [],
    sourceTimestamp: Date,
    freshness: SnapshotFreshness = .current
  ) {
    self.provider = provider
    self.accountLabel = accountLabel
    self.windows = windows
    self.resets = resets
    self.resetErrorMessage = resetErrorMessage
    self.notes = notes
    self.sourceTimestamp = sourceTimestamp
    self.freshness = freshness
  }

  public func activeResets(at date: Date = .now) -> [Reset] {
    resets.filter { $0.exp > date }.sorted { $0.exp < $1.exp }
  }

  public func markedStale(reason: String) -> UsageSnapshot {
    UsageSnapshot(
      provider: provider,
      accountLabel: accountLabel,
      windows: windows,
      resets: resets,
      resetErrorMessage: resetErrorMessage,
      notes: notes,
      sourceTimestamp: sourceTimestamp,
      freshness: .stale(reason: reason)
    )
  }

  public var quotaStatus: QuotaStatus {
    guard freshness == .current else { return .unavailable }
    let remaining = windows.compactMap(\.remainingPercent)
    guard let lowest = remaining.min() else { return .unavailable }
    return QuotaStatus.forRemaining(lowest)
  }
}

public enum QuotaStatus: Int, Equatable, Sendable {
  case healthy
  case warning
  case unavailable
  case critical

  public static func forRemaining(_ remaining: Double) -> QuotaStatus {
    if remaining < 10 { return .critical }
    if remaining < 30 { return .warning }
    return .healthy
  }
}

public enum QuotaValidationError: Error, Equatable, Sendable {
  case emptyIdentifier
  case emptyLabel
  case invalidPercentage
  case invalidDuration
  case invalidDate
  case invalidPairedFields
}

public enum ProviderDisplayState: Equatable, Sendable {
  case disabled
  case loading
  case available(UsageSnapshot)
  case unavailable(message: String)
  case unauthenticated(message: String)

  public var quotaStatus: QuotaStatus {
    switch self {
    case .available(let snapshot): snapshot.quotaStatus
    case .disabled, .loading, .unavailable, .unauthenticated: .unavailable
    }
  }
}
