public import Foundation

public struct QuotaOverview: Equatable, Sendable {
  public let providers: [ProviderOverview]
  public let summary: QuotaOverviewSummary
  public let lastUpdatedAt: Date?

  public init(states: [ProviderID: ProviderDisplayState], at date: Date = .now) {
    let overviews = ProviderID.allCases.map { provider in
      guard let state = states[provider] else {
        preconditionFailure("Missing display state for \(provider.rawValue)")
      }
      return ProviderOverview(provider: provider, state: state, at: date)
    }
    providers = overviews.sorted(by: Self.providerComesBefore)
    summary = Self.makeSummary(from: overviews)
    lastUpdatedAt = overviews.compactMap(\.sourceTimestamp).max()
  }

  private static func providerComesBefore(
    _ first: ProviderOverview,
    _ second: ProviderOverview
  ) -> Bool {
    if first.sortRank != second.sortRank { return first.sortRank < second.sortRank }
    if let firstRemaining = first.tightestWindow?.remainingPercent,
      let secondRemaining = second.tightestWindow?.remainingPercent,
      firstRemaining != secondRemaining
    {
      return firstRemaining < secondRemaining
    }
    return providerIndex(first.provider) < providerIndex(second.provider)
  }

  private static func makeSummary(from overviews: [ProviderOverview]) -> QuotaOverviewSummary {
    let enabled = overviews.filter { $0.state != .disabled }
    guard !enabled.isEmpty else { return .noProvidersEnabled }

    if let critical = tightestWindow(in: enabled, matching: .critical) {
      return .quota(provider: critical.provider, window: critical.window)
    }

    for overview in overviews where overview.state != .disabled {
      switch overview.state {
      case .available(let snapshot):
        switch snapshot.freshness {
        case .current:
          if overview.tightestWindow == nil {
            return .unknown(provider: overview.provider)
          }
        case .stale(let reason):
          return .stale(provider: overview.provider, reason: reason)
        }
      case .loading:
        return .loading(provider: overview.provider)
      case .unavailable(let message):
        return .unavailable(provider: overview.provider, message: message)
      case .unauthenticated(let message):
        return .unauthenticated(provider: overview.provider, message: message)
      case .disabled:
        break
      }
    }

    guard let tightest = tightestWindow(in: enabled) else {
      preconditionFailure("Enabled current providers must expose a summary state")
    }
    return .quota(provider: tightest.provider, window: tightest.window)
  }

  private static func tightestWindow(
    in overviews: [ProviderOverview],
    matching status: QuotaStatus? = nil
  ) -> (provider: ProviderID, window: UsageWindow)? {
    overviews.compactMap { overview -> (provider: ProviderID, window: UsageWindow)? in
      guard let window = overview.tightestWindow,
        let remaining = window.remainingPercent,
        status == nil || QuotaStatus.forRemaining(remaining) == status
      else {
        return nil
      }
      return (overview.provider, window)
    }
    .min { first, second in
      guard let firstRemaining = first.window.remainingPercent,
        let secondRemaining = second.window.remainingPercent
      else {
        preconditionFailure("Tightest windows must have remaining percentages")
      }
      if firstRemaining != secondRemaining { return firstRemaining < secondRemaining }
      return providerIndex(first.provider) < providerIndex(second.provider)
    }
  }

  private static func providerIndex(_ provider: ProviderID) -> Int {
    guard let index = ProviderID.allCases.firstIndex(of: provider) else {
      preconditionFailure("Unknown provider \(provider.rawValue)")
    }
    return index
  }
}

public struct ProviderOverview: Identifiable, Equatable, Sendable {
  public var id: ProviderID { provider }
  public let provider: ProviderID
  public let state: ProviderDisplayState
  public let tightestWindow: UsageWindow?
  public let resetOverview: ResetOverview?
  public let badges: [ProviderBadge]
  public let dimsContent: Bool

  fileprivate var sourceTimestamp: Date? {
    guard case let .available(snapshot) = state else { return nil }
    return snapshot.sourceTimestamp
  }

  fileprivate var sortRank: Int {
    switch state {
    case .available(let snapshot):
      guard snapshot.freshness == .current else { return 2 }
      if badges.contains(where: { $0.kind == .partial }) { return 2 }
      return tightestWindow == nil ? 1 : 0
    case .loading, .unavailable:
      return 2
    case .unauthenticated:
      return 3
    case .disabled:
      return 4
    }
  }

  fileprivate init(provider: ProviderID, state: ProviderDisplayState, at date: Date) {
    self.provider = provider
    self.state = state
    let partial = Self.hasPartialData(provider: provider, state: state)
    dimsContent = Self.shouldDimContent(state: state)
    if case let .available(snapshot) = state, snapshot.freshness == .current {
      tightestWindow = snapshot.windows
        .filter { $0.remainingPercent != nil }
        .min { first, second in
          guard let firstRemaining = first.remainingPercent,
            let secondRemaining = second.remainingPercent
          else {
            preconditionFailure("Filtered windows must have remaining percentages")
          }
          return firstRemaining < secondRemaining
        }
    } else {
      tightestWindow = nil
    }
    resetOverview = Self.makeResetOverview(provider: provider, state: state, at: date)
    badges = Self.makeBadges(
      provider: provider,
      state: state,
      resetOverview: resetOverview,
      partial: partial,
      at: date
    )
  }

  private static func hasPartialData(provider: ProviderID, state: ProviderDisplayState) -> Bool {
    guard provider == .grok, case let .available(snapshot) = state else { return false }
    return snapshot.freshness == .current && !snapshot.notes.isEmpty
  }

  private static func shouldDimContent(state: ProviderDisplayState) -> Bool {
    guard case let .available(snapshot) = state else { return false }
    return snapshot.freshness != .current
  }

  private static func makeBadges(
    provider: ProviderID,
    state: ProviderDisplayState,
    resetOverview: ResetOverview?,
    partial: Bool,
    at date: Date
  ) -> [ProviderBadge] {
    guard case let .available(snapshot) = state else { return [] }
    var badges: [ProviderBadge] = []
    switch snapshot.freshness {
    case .current:
      if partial {
        badges.append(
          .partial(
            age: QuotaTimeFormatter.compactAge(since: snapshot.sourceTimestamp, at: date),
            detail: snapshot.notes.joined(separator: " ")
          )
        )
      }
    case let .stale(reason):
      badges.append(
        .stale(
          age: QuotaTimeFormatter.compactAge(since: snapshot.sourceTimestamp, at: date),
          detail: reason
        )
      )
    }
    guard provider == .codex, snapshot.freshness == .current, let resetOverview else {
      return badges
    }
    switch resetOverview {
    case .none:
      badges.append(.noResets)
    case .available(let resets):
      badges.append(.resets(expirations: resets.map(\.exp)))
    case .unavailable:
      badges.append(.resetsUnavailable)
    }
    return badges
  }

  private static func makeResetOverview(
    provider: ProviderID,
    state: ProviderDisplayState,
    at date: Date
  ) -> ResetOverview? {
    guard provider == .codex, case let .available(snapshot) = state else { return nil }
    if let message = snapshot.resetErrorMessage { return .unavailable(message: message) }
    let resets = snapshot.activeResets(at: date)
    return resets.isEmpty ? ResetOverview.none : .available(resets)
  }
}

public enum ResetOverview: Equatable, Sendable {
  case none
  case available([Reset])
  case unavailable(message: String)
}

public enum ProviderBadgeKind: Equatable, Sendable {
  case stale
  case partial
  case noResets
  case resets
  case resetsUnavailable
}

public struct ProviderBadge: Equatable, Identifiable, Sendable {
  public let kind: ProviderBadgeKind
  public let age: String?
  public let expirations: [Date]
  public let detail: String?

  public var id: String {
    switch kind {
    case .stale: return "stale"
    case .partial: return "partial"
    case .noResets: return "no-resets"
    case .resets: return "resets"
    case .resetsUnavailable: return "resets-unavailable"
    }
  }

  public static func stale(age: String?, detail: String?) -> ProviderBadge {
    ProviderBadge(kind: .stale, age: age, expirations: [], detail: detail)
  }

  public static func partial(age: String?, detail: String?) -> ProviderBadge {
    ProviderBadge(kind: .partial, age: age, expirations: [], detail: detail)
  }

  public static let noResets = ProviderBadge(
    kind: .noResets,
    age: nil,
    expirations: [],
    detail: "No reset windows are currently available."
  )

  public static func resets(expirations: [Date]) -> ProviderBadge {
    ProviderBadge(kind: .resets, age: nil, expirations: expirations, detail: nil)
  }

  public static let resetsUnavailable = ProviderBadge(
    kind: .resetsUnavailable,
    age: nil,
    expirations: [],
    detail: "The reset endpoint is unavailable."
  )
}

public enum QuotaOverviewSummary: Equatable, Sendable {
  case quota(provider: ProviderID, window: UsageWindow)
  case stale(provider: ProviderID, reason: String)
  case unavailable(provider: ProviderID, message: String)
  case unauthenticated(provider: ProviderID, message: String)
  case loading(provider: ProviderID)
  case unknown(provider: ProviderID)
  case noProvidersEnabled

  public var status: QuotaStatus {
    switch self {
    case .quota(_, let window):
      guard let remaining = window.remainingPercent else {
        preconditionFailure("Summary quota must have a remaining percentage")
      }
      return QuotaStatus.forRemaining(remaining)
    case .stale, .unavailable, .unauthenticated, .loading, .unknown, .noProvidersEnabled:
      return .unavailable
    }
  }
}

public enum QuotaTimeFormatter {
  public static func compactCountdown(to date: Date, from referenceDate: Date = .now) -> String {
    let seconds = boundedSeconds(date.timeIntervalSince(referenceDate))
    if seconds == 0 { return "now" }
    if seconds < 60 { return "<1m" }

    let totalMinutes = seconds / 60
    let days = totalMinutes / 1_440
    let hours = (totalMinutes % 1_440) / 60
    let minutes = totalMinutes % 60
    if days > 0 { return hours > 0 ? "\(days)d \(hours)h" : "\(days)d" }
    if hours > 0 { return minutes > 0 ? "\(hours)h \(minutes)m" : "\(hours)h" }
    return "\(minutes)m"
  }

  public static func refreshAge(since date: Date, at referenceDate: Date = .now) -> String {
    let seconds = boundedSeconds(referenceDate.timeIntervalSince(date))
    if seconds < 5 { return "just now" }
    if seconds < 60 { return "\(seconds)s ago" }

    let minutes = seconds / 60
    if minutes < 60 { return "\(minutes)m ago" }
    let hours = minutes / 60
    if hours < 24 { return "\(hours)h ago" }
    return "\(hours / 24)d ago"
  }

  public static func compactAge(since date: Date, at referenceDate: Date = .now) -> String? {
    let seconds = boundedSeconds(referenceDate.timeIntervalSince(date))
    guard seconds >= 86_400 else { return nil }
    return "\(seconds / 86_400)D"
  }

  /// Clamps an interval into `Int`'s representable range before converting, so a malformed or
  /// already-persisted date with an extreme epoch value degrades to a large-but-finite duration
  /// instead of trapping. `1e15` (~31 million years) is far beyond any real countdown but stays
  /// comfortably inside `Int64` after conversion.
  private static func boundedSeconds(_ interval: TimeInterval) -> Int {
    guard interval.isFinite else { return 0 }
    return Int(max(0, min(interval, 1e15)))
  }
}
