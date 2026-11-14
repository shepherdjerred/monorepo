public import Foundation

// `/v1/usage?period=…` and `/v1/blocks`: the calendar usage report and
// 5-hour usage blocks. The contracts are
// `packages/toolkit/schemas/history-api-usage-report.schema.json` and
// `history-api-blocks.schema.json`, with shared fixtures under
// `packages/toolkit/schemas/fixtures/`.

/// The user-facing agent behind a source: `claude` and `claude-mirror` are
/// both Claude Code, told apart by machine.
public enum HistoryAgent: String, Decodable, CaseIterable, Hashable, Sendable {
  case claude
  case codex
  case cursor
  case antigravity
  case grok
  case kimi
  case muse
  case conductor

  public init(provider: ProviderID) {
    switch provider {
    case .claudeCode: self = .claude
    case .codex: self = .codex
    case .antigravity: self = .antigravity
    case .cursor: self = .cursor
    case .grok: self = .grok
    case .kimi: self = .kimi
    case .muse: self = .muse
    }
  }

  /// The Brim provider row this agent's usage belongs to; Conductor has none.
  public var provider: ProviderID? {
    switch self {
    case .claude: .claudeCode
    case .codex: .codex
    case .cursor: .cursor
    case .antigravity: .antigravity
    case .grok: .grok
    case .kimi: .kimi
    case .muse: .muse
    case .conductor: nil
    }
  }

  public var displayName: String {
    switch self {
    case .claude: "Claude Code"
    case .codex: "Codex"
    case .cursor: "Cursor"
    case .antigravity: "Antigravity"
    case .grok: "Grok"
    case .kimi: "Kimi Code"
    case .muse: "Meta Muse"
    case .conductor: "Conductor"
    }
  }
}

/// The calendar unit a usage report buckets events into.
public enum HistoryUsagePeriod: String, Decodable, CaseIterable, Identifiable, Sendable {
  case day
  case week
  case month

  public var id: Self { self }

  public var label: String {
    switch self {
    case .day: "Day"
    case .week: "Week"
    case .month: "Month"
    }
  }
}

/// A dimension a usage report breaks each period down by.
public enum HistoryUsageDimension: String, Decodable, CaseIterable, Identifiable, Sendable {
  case agent
  case model
  case project
  case machine

  public var id: Self { self }

  public var label: String {
    switch self {
    case .agent: "Agent"
    case .model: "Model"
    case .project: "Project"
    case .machine: "Machine"
    }
  }
}

public enum HistoryWeekStart: String, Decodable, Sendable {
  case monday
  case sunday

  /// The week start a calendar uses; anything but Sunday is Monday.
  public init(calendar: Calendar) {
    self = calendar.firstWeekday == 1 ? .sunday : .monday
  }
}

/// Usage counts the report and blocks carry beside the shared token fields.
public struct HistoryMeasuredUsage: Equatable, Sendable {
  public let usage: HistoryUsage
  /// Input, output, and the additive cache tokens, as the daemon counts them.
  public let totalTokens: Int
  public let events: Int

  public init(usage: HistoryUsage, totalTokens: Int, events: Int) {
    self.usage = usage
    self.totalTokens = totalTokens
    self.events = events
  }

  private enum CodingKeys: String, CodingKey {
    case totalTokens, events
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    usage = try HistoryUsage(from: decoder)
    totalTokens = try container.decode(Int.self, forKey: .totalTokens)
    events = try container.decode(Int.self, forKey: .events)
  }

  static let zero = Self(usage: HistoryUsage(), totalTokens: 0, events: 0)

  func adding(_ other: Self) -> Self {
    let lhs = usage
    let rhs = other.usage
    return Self(
      usage: HistoryUsage(
        inputTokens: lhs.inputTokens + rhs.inputTokens,
        outputTokens: lhs.outputTokens + rhs.outputTokens,
        cacheReadTokens: lhs.cacheReadTokens + rhs.cacheReadTokens,
        cacheCreationTokens: lhs.cacheCreationTokens + rhs.cacheCreationTokens,
        cachedInputTokens: lhs.cachedInputTokens + rhs.cachedInputTokens,
        reasoningTokens: lhs.reasoningTokens + rhs.reasoningTokens,
        costUSD: lhs.costUSD + rhs.costUSD,
        costComplete: lhs.costComplete && rhs.costComplete),
      totalTokens: totalTokens + other.totalTokens,
      events: events + other.events)
  }
}

/// One combination of the requested dimensions within a period; a dimension
/// the request did not name is `nil`, as is this Mac for `machine`.
public struct HistoryUsageBreakdownRow: Decodable, Equatable, Sendable {
  public let agent: HistoryAgent?
  public let model: String?
  public let project: String?
  public let machine: String?
  public let measured: HistoryMeasuredUsage

  private enum CodingKeys: String, CodingKey {
    case agent, model, project, machine
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    agent = try container.decode(HistoryAgent?.self, forKey: .agent)
    model = try container.decode(String?.self, forKey: .model)
    project = try container.decode(String?.self, forKey: .project)
    machine = try container.decode(String?.self, forKey: .machine)
    measured = try HistoryMeasuredUsage(from: decoder)
  }

  /// The value of `dimension` in this row.
  public func key(_ dimension: HistoryUsageDimension) -> String? {
    switch dimension {
    case .agent: agent?.rawValue
    case .model: model
    case .project: project
    case .machine: machine
    }
  }
}

/// One calendar day, week, or month of the report's zone.
public struct HistoryUsagePeriodRow: Decodable, Equatable, Sendable {
  /// `YYYY-MM-DD` for days and weeks (the week's first day), `YYYY-MM` for
  /// months.
  public let period: String
  public let start: Date
  public let end: Date
  public let measured: HistoryMeasuredUsage
  public let breakdown: [HistoryUsageBreakdownRow]

  private enum CodingKeys: String, CodingKey {
    case period, start, end, breakdown
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    period = try container.decode(String.self, forKey: .period)
    start = try container.decode(Date.self, forKey: .start)
    end = try container.decode(Date.self, forKey: .end)
    breakdown = try container.decode([HistoryUsageBreakdownRow].self, forKey: .breakdown)
    measured = try HistoryMeasuredUsage(from: decoder)
  }
}

/// The whole report's totals and the models it could not price.
public struct HistoryUsageReportTotal: Decodable, Equatable, Sendable {
  public let measured: HistoryMeasuredUsage
  /// Models with billable tokens the price catalog cannot price, so every
  /// cost that includes them is a lower bound.
  public let unpricedModels: [String]

  private enum CodingKeys: String, CodingKey {
    case unpricedModels
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    unpricedModels = try container.decode([String].self, forKey: .unpricedModels)
    measured = try HistoryMeasuredUsage(from: decoder)
  }
}

public struct HistoryUsageReportFilters: Decodable, Equatable, Sendable {
  public let agent: HistoryAgent?
  public let source: HistorySource?
  public let machine: String?
  public let project: String?

  private enum CodingKeys: String, CodingKey {
    case agent, source, machine, project
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    agent = try container.decode(HistoryAgent?.self, forKey: .agent)
    source = try container.decode(HistorySource?.self, forKey: .source)
    machine = try container.decode(String?.self, forKey: .machine)
    project = try container.decode(String?.self, forKey: .project)
  }
}

/// `/v1/usage?period=…`.
public struct HistoryPeriodUsageReport: HistoryVersionedResponse, Equatable, Sendable {
  public let apiVersion: Int
  public let period: HistoryUsagePeriod
  public let timezone: String
  public let startOfWeek: HistoryWeekStart
  public let breakdown: [HistoryUsageDimension]
  public let since: Date?
  public let until: Date?
  public let filters: HistoryUsageReportFilters
  public let total: HistoryUsageReportTotal
  public let periods: [HistoryUsagePeriodRow]

  private enum CodingKeys: String, CodingKey {
    case apiVersion, period, timezone, startOfWeek, breakdown, since, until, filters, total
    case periods
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    apiVersion = try container.decode(Int.self, forKey: .apiVersion)
    period = try container.decode(HistoryUsagePeriod.self, forKey: .period)
    timezone = try container.decode(String.self, forKey: .timezone)
    startOfWeek = try container.decode(HistoryWeekStart.self, forKey: .startOfWeek)
    breakdown = try container.decode([HistoryUsageDimension].self, forKey: .breakdown)
    since = try container.decode(Date?.self, forKey: .since)
    until = try container.decode(Date?.self, forKey: .until)
    filters = try container.decode(HistoryUsageReportFilters.self, forKey: .filters)
    total = try container.decode(HistoryUsageReportTotal.self, forKey: .total)
    periods = try container.decode([HistoryUsagePeriodRow].self, forKey: .periods)
  }
}

/// The active block's rate since its first event, projected to its end.
public struct HistoryBlockProjection: Decodable, Equatable, Sendable {
  public let elapsedMinutes: Int
  public let remainingMinutes: Int
  public let tokensPerMinute: Double
  public let costPerHour: Double
  public let projectedTokens: Int
  public let projectedCostUSD: Double

  private enum CodingKeys: String, CodingKey {
    case elapsedMinutes, remainingMinutes, tokensPerMinute, costPerHour, projectedTokens
    case projectedCostUSD = "projectedCostUsd"
  }
}

/// One agent's 5-hour usage block.
public struct HistoryUsageBlock: Decodable, Equatable, Identifiable, Sendable {
  public let agent: HistoryAgent
  public let start: Date
  public let end: Date
  public let firstEventAt: Date
  public let lastEventAt: Date
  public let isActive: Bool
  /// The block is the provider's current 5-hour quota window from Brim's
  /// snapshot cache rather than one floored to its first event.
  public let alignedToQuota: Bool
  /// Machines with usage in the block; `nil` is this Mac.
  public let machines: [String?]
  public let models: [String]
  public let measured: HistoryMeasuredUsage
  public let projection: HistoryBlockProjection?

  public var id: String { "\(agent.rawValue)@\(start.timeIntervalSince1970)" }

  private enum CodingKeys: String, CodingKey {
    case agent, start, end, firstEventAt, lastEventAt, isActive, alignedToQuota, machines
    case models, projection
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    agent = try container.decode(HistoryAgent.self, forKey: .agent)
    start = try container.decode(Date.self, forKey: .start)
    end = try container.decode(Date.self, forKey: .end)
    firstEventAt = try container.decode(Date.self, forKey: .firstEventAt)
    lastEventAt = try container.decode(Date.self, forKey: .lastEventAt)
    isActive = try container.decode(Bool.self, forKey: .isActive)
    alignedToQuota = try container.decode(Bool.self, forKey: .alignedToQuota)
    machines = try container.decode([String?].self, forKey: .machines)
    models = try container.decode([String].self, forKey: .models)
    projection = try container.decode(HistoryBlockProjection?.self, forKey: .projection)
    measured = try HistoryMeasuredUsage(from: decoder)
  }
}

/// Idle time between two of an agent's listed blocks.
public struct HistoryBlockGap: Decodable, Equatable, Sendable {
  public let agent: HistoryAgent
  public let start: Date
  public let end: Date
}

/// `/v1/blocks`.
public struct HistoryBlocksReport: HistoryVersionedResponse, Equatable, Sendable {
  public let apiVersion: Int
  public let now: Date
  public let since: Date?
  /// `local`, `all`, or a mirrored machine id.
  public let machine: String
  public let agent: HistoryAgent?
  public let activeOnly: Bool
  public let blocks: [HistoryUsageBlock]
  public let gaps: [HistoryBlockGap]

  private enum CodingKeys: String, CodingKey {
    case apiVersion, now, since, machine, agent, activeOnly, blocks, gaps
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    apiVersion = try container.decode(Int.self, forKey: .apiVersion)
    now = try container.decode(Date.self, forKey: .now)
    since = try container.decode(Date?.self, forKey: .since)
    machine = try container.decode(String.self, forKey: .machine)
    agent = try container.decode(HistoryAgent?.self, forKey: .agent)
    activeOnly = try container.decode(Bool.self, forKey: .activeOnly)
    blocks = try container.decode([HistoryUsageBlock].self, forKey: .blocks)
    gaps = try container.decode([HistoryBlockGap].self, forKey: .gaps)
  }

  /// Each provider's active block.
  public var activeByProvider: [ProviderID: HistoryUsageBlock] {
    var active: [ProviderID: HistoryUsageBlock] = [:]
    for block in blocks where block.isActive {
      if let provider = block.agent.provider { active[provider] = block }
    }
    return active
  }
}
