public import Foundation

// Responses of the toolkit history daemon's read API (`/v1/*`).
//
// The language-neutral contracts are
// `packages/toolkit/schemas/history-api-*.schema.json`; the toolkit server and
// these decoders are tested against the same fixtures under
// `packages/toolkit/schemas/fixtures/`. Unknown enum values and missing fields
// fail decoding instead of being guessed.

/// A transcript source the history index reads.
public enum HistorySource: String, Decodable, CaseIterable, Hashable, Sendable {
  case claude
  case codex
  case antigravity
  case grok
  case cursor
  case conductor
  case claudeMirror = "claude-mirror"
  case codexMirror = "codex-mirror"

  public var displayName: String {
    switch self {
    case .claude: "Claude Code"
    case .codex: "Codex"
    case .antigravity: "Antigravity"
    case .grok: "Grok"
    case .cursor: "Cursor"
    case .conductor: "Conductor"
    case .claudeMirror: "Claude Code (mirrored)"
    case .codexMirror: "Codex (mirrored)"
    }
  }
}

/// Token counts and estimated cost. `costUSD` is a lower bound when
/// `costComplete` is false (a model the price catalog does not know).
public struct HistoryUsage: Decodable, Equatable, Hashable, Sendable {
  public let inputTokens: Int
  public let outputTokens: Int
  public let cacheReadTokens: Int
  public let cacheCreationTokens: Int
  /// Codex's cached input, a subset already included in `inputTokens`.
  public let cachedInputTokens: Int
  public let reasoningTokens: Int
  public let costUSD: Double
  public let costComplete: Bool

  public init(
    inputTokens: Int = 0,
    outputTokens: Int = 0,
    cacheReadTokens: Int = 0,
    cacheCreationTokens: Int = 0,
    cachedInputTokens: Int = 0,
    reasoningTokens: Int = 0,
    costUSD: Double = 0,
    costComplete: Bool = true
  ) {
    self.inputTokens = inputTokens
    self.outputTokens = outputTokens
    self.cacheReadTokens = cacheReadTokens
    self.cacheCreationTokens = cacheCreationTokens
    self.cachedInputTokens = cachedInputTokens
    self.reasoningTokens = reasoningTokens
    self.costUSD = costUSD
    self.costComplete = costComplete
  }

  /// Every billed token once: input, output, and the additive cache tokens.
  public var totalTokens: Int {
    inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens
  }

  private enum CodingKeys: String, CodingKey {
    case inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens
    case cachedInputTokens, reasoningTokens, costComplete
    case costUSD = "costUsd"
  }
}

/// One indexed agent session.
public struct HistorySession: Decodable, Equatable, Hashable, Identifiable, Sendable {
  /// Local index id; it changes after a rebuild.
  public let id: Int
  public let source: HistorySource
  public let sourceId: String
  public let title: String
  public let agent: String?
  /// `nil` for this Mac's own sessions, else the mirrored machine id.
  public let machine: String?
  public let workspace: String?
  public let gitBranch: String?
  public let primaryModel: String?
  public let createdAt: Date
  public let updatedAt: Date
  public let messageCount: Int
  public let toolCallCount: Int
  /// How many usage records the source wrote for this session. Zero means
  /// the source records no usage, not that the session cost nothing.
  public let usageEvents: Int
  public let usage: HistoryUsage

  /// Whether `usage` is a measurement rather than an absence of data.
  public var hasUsage: Bool { usageEvents > 0 }
}

/// `/v1/sessions` and `/v1/search`.
public struct HistorySessionsPage: HistoryVersionedResponse, Equatable, Sendable {
  public let apiVersion: Int
  /// The search query echoed back, or `nil` for a plain listing.
  public let query: String?
  public let sessions: [HistorySession]
  public let hasMore: Bool
}

public enum HistoryMessageRole: String, Decodable, Sendable {
  case user
  case assistant
  case tool
  case unknown
}

public struct HistoryMessage: Decodable, Equatable, Sendable {
  public let role: HistoryMessageRole
  public let text: String
  public let createdAt: Date?
  /// Set on a tool invocation; `nil` on a `tool` message that is the
  /// output of the invocation before it.
  public let toolName: String?

  public var isToolCall: Bool { role == .tool && toolName != nil }
  public var isToolOutput: Bool { role == .tool && toolName == nil }
}

/// `/v1/sessions/<id>`: the session plus one page of its messages.
public struct HistorySessionDetail: HistoryVersionedResponse, Equatable, Sendable {
  public let apiVersion: Int
  public let session: HistorySession
  public let messages: [HistoryMessage]
  public let offset: Int
  public let totalMessages: Int
}

public enum HistoryUsageGroup: String, Decodable, CaseIterable, Sendable {
  case day
  case source
  case model
  case workspace
  case machine
}

public struct HistoryUsageRow: Decodable, Equatable, Sendable {
  /// The group value: a local `YYYY-MM-DD` for `day`; `nil` is this Mac for
  /// `machine` and an unknown value for the other groups.
  public let key: String?
  public let sessionCount: Int
  public let events: Int
  public let usage: HistoryUsage

  private enum CodingKeys: String, CodingKey {
    case key, sessionCount, events
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    key = try container.decode(String?.self, forKey: .key)
    sessionCount = try container.decode(Int.self, forKey: .sessionCount)
    events = try container.decode(Int.self, forKey: .events)
    usage = try HistoryUsage(from: decoder)
  }
}

/// `/v1/usage`.
public struct HistoryUsageReport: HistoryVersionedResponse, Equatable, Sendable {
  public let apiVersion: Int
  public let groupBy: HistoryUsageGroup
  public let since: Date?
  public let total: HistoryUsage
  public let rows: [HistoryUsageRow]
}

public struct HistoryToolRow: Decodable, Equatable, Sendable {
  public let name: String
  public let calls: Int
  public let sessions: Int
}

/// `/v1/tools`.
public struct HistoryToolsReport: HistoryVersionedResponse, Equatable, Sendable {
  public let apiVersion: Int
  public let since: Date?
  public let rows: [HistoryToolRow]
}

/// A machine or workspace and how many indexed sessions it has; `nil` is
/// this Mac for machines and "no workspace" for workspaces.
public struct HistoryFacetRow: Decodable, Equatable, Sendable {
  public let key: String?
  public let sessions: Int
}

public struct HistorySourceFacetRow: Decodable, Equatable, Sendable {
  public let key: HistorySource
  public let sessions: Int
}

/// `/v1/facets`: every machine, source, and workspace with indexed sessions.
public struct HistoryFacetsReport: HistoryVersionedResponse, Equatable, Sendable {
  public let apiVersion: Int
  public let machines: [HistoryFacetRow]
  public let sources: [HistorySourceFacetRow]
  public let workspaces: [HistoryFacetRow]
}

/// The body of every non-2xx response.
struct HistoryErrorBody: Decodable, Equatable {
  let error: String
}

/// Every successful `/v1` response carries `apiVersion`.
public protocol HistoryVersionedResponse: Decodable {
  var apiVersion: Int { get }
}

struct HistoryVersionEnvelope: Decodable {
  let apiVersion: Int
}

/// Every `/v1` timestamp is an ISO 8601 date-time, with or without
/// fractional seconds and with `Z` or a numeric offset.
enum HistoryTimestamp {
  static func parse(_ value: String) -> Date? {
    if let date = try? Date(value, strategy: fractional) { return date }
    return try? Date(value, strategy: whole)
  }

  static func decode(_ decoder: any Decoder) throws -> Date {
    let container = try decoder.singleValueContainer()
    let value = try container.decode(String.self)
    guard let date = parse(value) else {
      throw DecodingError.dataCorruptedError(
        in: container, debugDescription: "\(value) is not an ISO 8601 date-time")
    }
    return date
  }

  private static let fractional = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
  private static let whole = Date.ISO8601FormatStyle()
}
