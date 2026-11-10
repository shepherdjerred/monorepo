public import Foundation

/// What the Sessions window's sidebar has selected.
public enum SessionsSidebarItem: Hashable, Sendable {
  case all
  case machine(HistoryMachine)
  case source(HistorySource)
  case workspace(String)
  case analytics

  /// The session-list filter, or `nil` for Analytics.
  public var filter: HistorySessionFilter? {
    switch self {
    case .all: HistorySessionFilter()
    case let .machine(machine): HistorySessionFilter(machine: machine)
    case let .source(source): HistorySessionFilter(source: source)
    case let .workspace(workspace): HistorySessionFilter(workspace: workspace)
    case .analytics: nil
    }
  }
}

public enum HistoryLoadPhase: Equatable, Sendable {
  case idle
  case loading
  case loaded
  case failed(HistoryAPIError)

  public var error: HistoryAPIError? {
    guard case let .failed(error) = self else { return nil }
    return error
  }
}

/// The inputs that define the session list; a change reloads it.
public struct SessionsListQuery: Hashable, Sendable {
  public let selection: SessionsSidebarItem
  public let range: HistoryTimeRange
  public let search: String?
}

/// A sidebar row and how many indexed sessions it has.
public struct SessionsFacet: Identifiable, Equatable, Sendable {
  public let item: SessionsSidebarItem
  public let title: String
  /// The full value behind a shortened title, such as a workspace path.
  public let detail: String?
  public let sessionCount: Int

  public var id: SessionsSidebarItem { item }
}

/// Machines, agents, and projects for the sidebar, from `/v1/facets`.
public struct SessionsFacets: Equatable, Sendable {
  public var machines: [SessionsFacet] = []
  public var sources: [SessionsFacet] = []
  public var workspaces: [SessionsFacet] = []
  /// Sessions with no workspace; the list cannot filter to them.
  public var sessionsWithoutWorkspace = 0

  public init() {
    // Empty until the first `/v1/facets` response.
  }

  init(_ report: HistoryFacetsReport) {
    // This Mac first, then mirrors in the daemon's order (most sessions).
    let ordered =
      report.machines.filter { $0.key == nil } + report.machines.filter { $0.key != nil }
    machines = ordered.map { row in
      let machine = HistoryMachine(key: row.key)
      return SessionsFacet(
        item: .machine(machine), title: machine.displayName, detail: nil,
        sessionCount: row.sessions)
    }
    sources = report.sources.map { row in
      SessionsFacet(
        item: .source(row.key), title: row.key.displayName, detail: nil,
        sessionCount: row.sessions)
    }
    workspaces = report.workspaces.compactMap { row in
      guard let path = row.key else { return nil }
      return SessionsFacet(
        item: .workspace(path), title: HistoryFormat.workspaceName(path), detail: path,
        sessionCount: row.sessions)
    }
    sessionsWithoutWorkspace = report.workspaces.first { $0.key == nil }?.sessions ?? 0
  }
}

public struct SessionConversationEntry: Identifiable, Equatable, Sendable {
  /// The message's position in the whole session.
  public let id: Int
  public let message: HistoryMessage
}

/// One row of a conversation: a message, or a tool invocation with the
/// outputs that follow it.
public enum ConversationItem: Identifiable, Equatable, Sendable {
  case message(SessionConversationEntry)
  case tool(call: SessionConversationEntry, outputs: [SessionConversationEntry])
  /// Output whose invocation is not in the loaded messages.
  case output(SessionConversationEntry)

  public var id: Int {
    switch self {
    case let .message(entry), let .tool(entry, _), let .output(entry): entry.id
    }
  }

  /// Each output belongs to the nearest preceding invocation.
  static func group(_ entries: [SessionConversationEntry]) -> [Self] {
    var items: [Self] = []
    for entry in entries {
      if entry.message.isToolOutput, case let .tool(call, outputs) = items.last {
        items[items.count - 1] = .tool(call: call, outputs: outputs + [entry])
      } else if entry.message.isToolOutput {
        items.append(.output(entry))
      } else if entry.message.isToolCall {
        items.append(.tool(call: entry, outputs: []))
      } else {
        items.append(.message(entry))
      }
    }
    return items
  }
}

/// A session's messages, accumulated page by page.
public struct SessionConversation: Equatable, Sendable {
  public private(set) var session: HistorySession
  public private(set) var entries: [SessionConversationEntry]
  public private(set) var items: [ConversationItem]
  public private(set) var totalMessages: Int

  init(_ detail: HistorySessionDetail) {
    session = detail.session
    entries = Self.entries(detail)
    items = ConversationItem.group(entries)
    totalMessages = detail.totalMessages
  }

  public var hasMore: Bool { entries.count < totalMessages }

  mutating func append(_ detail: HistorySessionDetail) {
    session = detail.session
    entries += Self.entries(detail)
    items = ConversationItem.group(entries)
    totalMessages = detail.totalMessages
  }

  private static func entries(_ detail: HistorySessionDetail) -> [SessionConversationEntry] {
    detail.messages.enumerated().map { index, message in
      SessionConversationEntry(id: detail.offset + index, message: message)
    }
  }
}

/// One local calendar day of usage for the daily charts.
public struct HistoryDailyPoint: Identifiable, Equatable, Sendable {
  public let day: Date
  public let usage: HistoryUsage
  public let sessionCount: Int

  public var id: Date { day }
}

/// Everything the Analytics pane charts, for one time range.
public struct SessionsAnalytics: Equatable, Sendable {
  public let range: HistoryTimeRange
  public let daily: [HistoryDailyPoint]
  public let total: HistoryUsage
  public let byModel: [HistoryUsageRow]
  public let bySource: [HistoryUsageRow]
  public let byWorkspace: [HistoryUsageRow]
  public let byMachine: [HistoryUsageRow]
  public let tools: [HistoryToolRow]

  /// The five `/v1/usage` reports the pane needs, one per grouping.
  struct Reports {
    let day: HistoryUsageReport
    let model: HistoryUsageReport
    let source: HistoryUsageReport
    let workspace: HistoryUsageReport
    let machine: HistoryUsageReport
  }

  init(
    range: HistoryTimeRange, reports: Reports, tools: HistoryToolsReport, calendar: Calendar
  ) throws(HistoryAPIError) {
    self.range = range
    total = reports.day.total
    daily = try reports.day.rows.map { row throws(HistoryAPIError) in
      HistoryDailyPoint(
        day: try Self.day(row.key, calendar: calendar), usage: row.usage,
        sessionCount: row.sessionCount)
    }
    byModel = reports.model.rows
    bySource = reports.source.rows
    byWorkspace = reports.workspace.rows
    byMachine = reports.machine.rows
    self.tools = tools.rows
  }

  private static func day(_ key: String?, calendar: Calendar) throws(HistoryAPIError) -> Date {
    let parts = key?.split(separator: "-").compactMap { Int($0) } ?? []
    guard parts.count == 3,
      let date = calendar.date(
        from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    else {
      throw .decoding(path: "/v1/usage", detail: "day key \(key ?? "null") is not YYYY-MM-DD")
    }
    return date
  }
}
