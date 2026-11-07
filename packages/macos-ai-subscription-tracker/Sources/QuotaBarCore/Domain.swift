public import Foundation

public enum ProviderID: String, CaseIterable, Codable, Identifiable, Sendable {
  case claudeCode = "claude-code"
  case codex
  case antigravity
  case cursor
  case grok
  case kimi
  case muse

  public static let standard: Set<ProviderID> = [
    .claudeCode, .codex, .antigravity, .cursor, .grok, .kimi, .muse,
  ]
  public static let legacy: Set<ProviderID> = []

  public var id: String { rawValue }

  public var displayName: String {
    switch self {
    case .claudeCode: "Claude Code"
    case .codex: "Codex"
    case .antigravity: "Google Antigravity"
    case .cursor: "Cursor"
    case .grok: "Grok"
    case .kimi: "Kimi Code"
    case .muse: "Meta Muse"
    }
  }

  public var usageURL: URL? {
    switch self {
    case .claudeCode: URL(string: "https://claude.ai/settings/usage")
    case .codex: URL(string: "https://chatgpt.com/codex/settings/usage")
    case .antigravity: URL(string: "https://antigravity.google/docs/cli/commands/usage")
    case .cursor: URL(string: "https://prod.cursor.com/help/models-and-usage/usage-limits")
    case .grok: URL(string: "https://grok.com/settings/usage?_s=usage")
    case .kimi: URL(string: "https://www.kimi.com/code/console")
    // Meta Muse has no public usage page: quota is visible only inside the signed-in
    // CLI (`/usage`), and the accountscenter page requires an interactive login.
    case .muse: nil
    }
  }

  public var supportsManualCredentialOverride: Bool {
    switch self {
    case .claudeCode, .codex, .grok, .kimi: true
    case .antigravity, .cursor, .muse: false
    }
  }

  public var tracksBankedResets: Bool {
    switch self {
    case .claudeCode, .codex, .grok: true
    case .antigravity, .cursor, .kimi, .muse: false
    }
  }
}

public struct SubscriptionPlan: Identifiable, Equatable, Sendable {
  public var id: ProviderID { provider }
  public let provider: ProviderID
  public let monthlyCostUSD: Int

  public static let standard: [SubscriptionPlan] = [
    SubscriptionPlan(provider: .claudeCode, monthlyCostUSD: 200),
    SubscriptionPlan(provider: .codex, monthlyCostUSD: 200),
    SubscriptionPlan(provider: .antigravity, monthlyCostUSD: 20),
    SubscriptionPlan(provider: .cursor, monthlyCostUSD: 20),
    SubscriptionPlan(provider: .grok, monthlyCostUSD: 30),
    SubscriptionPlan(provider: .kimi, monthlyCostUSD: 40),
    SubscriptionPlan(provider: .muse, monthlyCostUSD: 15),
  ]

  public static let legacy: [SubscriptionPlan] = []

  public static func plans(includingLegacy: Bool) -> [SubscriptionPlan] {
    standard + (includingLegacy ? legacy : [])
  }

  public static func totalMonthlyCostUSD(includingLegacy: Bool = false) -> Int {
    plans(includingLegacy: includingLegacy).reduce(0) { total, plan in total + plan.monthlyCostUSD }
  }

  /// The provider's reported price when it has one (Cursor), else this table's.
  public static func monthlyCostUSD(for provider: ProviderID, snapshot: UsageSnapshot?) -> Int {
    snapshot?.plan?.monthlyCostUSD ?? plan(for: provider).monthlyCostUSD
  }

  public static func totalMonthlyCostUSD(
    includingLegacy: Bool = false,
    snapshots: [ProviderID: UsageSnapshot]
  ) -> Int {
    plans(includingLegacy: includingLegacy).reduce(0) { total, plan in
      total + monthlyCostUSD(for: plan.provider, snapshot: snapshots[plan.provider])
    }
  }

  public static func plan(for provider: ProviderID) -> SubscriptionPlan {
    guard let plan = (standard + legacy).first(where: { $0.provider == provider }) else {
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
      return label.count <= 18 ? label : "Rolling"
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

  public var isWeekly: Bool {
    if kind == .weekly { return true }
    return label.localizedCaseInsensitiveContains("weekly")
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

/// The subscription an account is on, as the provider reports it. `monthlyCostUSD` is set
/// only when the provider reports a price (Cursor); otherwise `SubscriptionPlan` supplies it.
public struct PlanInfo: Equatable, Codable, Sendable {
  public let name: String
  public let monthlyCostUSD: Int?

  /// Nil for a blank name, so a provider that omits its plan shows none.
  public init?(name: String?, monthlyCostUSD: Int? = nil) {
    guard let name = name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
      return nil
    }
    self.name = name
    self.monthlyCostUSD = monthlyCostUSD
  }
}

/// Readable names for plan identifiers such as `claude_max_20x` or `pro`.
public enum PlanName {
  /// Splits on `_`, `-` and spaces, drops a leading provider word (`claude`), title-cases
  /// words and keeps tokens that start with a digit (`20x`) as they are.
  public static func humanized(_ raw: String?, droppingPrefix prefix: String? = nil) -> String? {
    guard let raw else { return nil }
    var words = raw.split { $0 == "_" || $0 == "-" || $0 == " " }.map(String.init)
    if let prefix, words.count > 1, words[0].caseInsensitiveCompare(prefix) == .orderedSame {
      words.removeFirst()
    }
    let name = words.map { word in
      word.first?.isNumber == true
        ? word.lowercased() : word.prefix(1).uppercased() + word.dropFirst().lowercased()
    }
    .joined(separator: " ")
    return name.isEmpty ? nil : name
  }
}

public struct UsageSnapshot: Equatable, Codable, Sendable {
  public let provider: ProviderID
  public let accountLabel: String?
  public let plan: PlanInfo?
  public let windows: [UsageWindow]
  public let resets: [Reset]
  public let resetErrorMessage: String?
  public let notes: [String]
  public let sourceTimestamp: Date
  public let freshness: SnapshotFreshness

  public init(
    provider: ProviderID,
    accountLabel: String? = nil,
    plan: PlanInfo? = nil,
    windows: [UsageWindow],
    resets: [Reset] = [],
    resetErrorMessage: String? = nil,
    notes: [String] = [],
    sourceTimestamp: Date,
    freshness: SnapshotFreshness = .current
  ) {
    self.provider = provider
    self.accountLabel = accountLabel
    self.plan = plan
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
    replacing(freshness: .stale(reason: reason))
  }

  /// A copy with the given fields replaced and every other field kept, so no caller can
  /// drop one (such as `plan`) by rebuilding the snapshot field by field.
  public func replacing(
    windows: [UsageWindow]? = nil,
    plan: PlanInfo? = nil,
    appendingNotes extraNotes: [String] = [],
    freshness: SnapshotFreshness? = nil
  ) -> UsageSnapshot {
    UsageSnapshot(
      provider: provider,
      accountLabel: accountLabel,
      plan: plan ?? self.plan,
      windows: windows ?? self.windows,
      resets: resets,
      resetErrorMessage: resetErrorMessage,
      notes: notes + extraNotes,
      sourceTimestamp: sourceTimestamp,
      freshness: freshness ?? self.freshness
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

  public var snapshot: UsageSnapshot? {
    guard case let .available(snapshot) = self else { return nil }
    return snapshot
  }
}
