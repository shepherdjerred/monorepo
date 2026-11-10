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

/// A sidebar row with the all-time usage the daemon reports for it.
public struct SessionsFacet: Identifiable, Equatable, Sendable {
  public let item: SessionsSidebarItem
  public let title: String
  /// The full value behind a shortened title, such as a workspace path.
  public let detail: String?
  public let usage: HistoryUsage?
  public let sessionCount: Int?

  public var id: SessionsSidebarItem { item }
}

/// Machines, agents, and projects for the sidebar.
public struct SessionsFacets: Equatable, Sendable {
  public var machines: [SessionsFacet]
  public var sources: [SessionsFacet]
  public var workspaces: [SessionsFacet]

  public init(
    machines: [SessionsFacet] = [SessionsFacets.thisMac(nil)],
    sources: [SessionsFacet] = SessionsFacets.allSources([]),
    workspaces: [SessionsFacet] = []
  ) {
    self.machines = machines
    self.sources = sources
    self.workspaces = workspaces
  }

  /// Built from all-time usage grouped by machine, source, and workspace.
  /// Usage only covers sessions whose transcripts carry token counts, so
  /// every source is listed and This Mac is always present.
  init(machines: HistoryUsageReport, sources: HistoryUsageReport, workspaces: HistoryUsageReport) {
    let local = machines.rows.first { $0.key == nil }
    let mirrored = machines.rows.compactMap { row -> SessionsFacet? in
      guard let key = row.key else { return nil }
      return SessionsFacet(
        item: .machine(.mirrored(key)), title: key, detail: nil, usage: row.usage,
        sessionCount: row.sessionCount)
    }
    self.machines = [Self.thisMac(local)] + mirrored
    self.sources = Self.allSources(sources.rows)
    self.workspaces = workspaces.rows.compactMap { row in
      guard let path = row.key else { return nil }
      return SessionsFacet(
        item: .workspace(path), title: HistoryFormat.workspaceName(path), detail: path,
        usage: row.usage, sessionCount: row.sessionCount)
    }
  }

  public static func thisMac(_ row: HistoryUsageRow?) -> SessionsFacet {
    SessionsFacet(
      item: .machine(.local), title: HistoryMachine.local.displayName, detail: nil,
      usage: row?.usage, sessionCount: row?.sessionCount)
  }

  public static func allSources(_ rows: [HistoryUsageRow]) -> [SessionsFacet] {
    HistorySource.allCases.map { source in
      let row = rows.first { $0.key == source.rawValue }
      return SessionsFacet(
        item: .source(source), title: source.displayName, detail: nil, usage: row?.usage,
        sessionCount: row?.sessionCount)
    }
  }
}

public struct SessionConversationEntry: Identifiable, Equatable, Sendable {
  /// The message's position in the whole session.
  public let id: Int
  public let message: HistoryMessage
}

/// A session's messages, accumulated page by page.
public struct SessionConversation: Equatable, Sendable {
  public private(set) var session: HistorySession
  public private(set) var entries: [SessionConversationEntry]
  public private(set) var totalMessages: Int

  init(_ detail: HistorySessionDetail) {
    session = detail.session
    entries = Self.entries(detail)
    totalMessages = detail.totalMessages
  }

  public var hasMore: Bool { entries.count < totalMessages }

  mutating func append(_ detail: HistorySessionDetail) {
    session = detail.session
    entries += Self.entries(detail)
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
