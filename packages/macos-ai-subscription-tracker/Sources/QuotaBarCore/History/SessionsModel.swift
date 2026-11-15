public import Foundation
public import Observation

/// State for the Sessions window: the sidebar facets, a paged session list or
/// search, one session's paged conversation, and the Analytics reports. Every
/// read goes through the history daemon; a failure is kept as a typed
/// `HistoryAPIError` for the view to show with its fix.
@MainActor @Observable
public final class SessionsModel {
  public static let sessionPageSize = 50
  public static let messagePageSize = 200
  public static let toolLimit = 15
  /// How far back the Analytics blocks timeline reaches.
  public static let blocksSince = "3d"

  public var selection: SessionsSidebarItem = .all {
    didSet { if selection != oldValue { selectedSessionID = nil } }
  }
  public var range: HistoryTimeRange = .month
  /// The calendar unit of the Analytics period charts.
  public var usagePeriod: HistoryUsagePeriod = .day
  /// What the Analytics period charts are stacked by.
  public var usageDimension: HistoryUsageDimension = .agent
  /// The search field's text; `submitSearch()` applies it.
  public var searchText = ""
  public var selectedSessionID: Int?

  public private(set) var activeSearch: String?
  public private(set) var facets = SessionsFacets()
  public private(set) var facetsPhase: HistoryLoadPhase = .idle
  public private(set) var sessions: [HistorySession] = []
  public private(set) var hasMoreSessions = false
  public private(set) var listPhase: HistoryLoadPhase = .idle
  public private(set) var conversation: SessionConversation?
  public private(set) var detailPhase: HistoryLoadPhase = .idle
  public private(set) var analytics: SessionsAnalytics?
  public private(set) var analyticsPhase: HistoryLoadPhase = .idle
  public private(set) var periodChart: UsagePeriodChart?
  public private(set) var periodChartPhase: HistoryLoadPhase = .idle

  /// The selected session's captured requests (the Requests tab).
  public let captures: CapturesModel

  private let client: HistoryClient
  private let calendar: Calendar
  private var listGeneration = 0
  private var detailGeneration = 0
  private var analyticsGeneration = 0
  private var periodChartGeneration = 0

  public init(client: HistoryClient = HistoryClient(), calendar: Calendar = .current) {
    self.client = client
    self.calendar = calendar
    captures = CapturesModel(client: client)
  }

  /// Changes whenever the session list must be reloaded from the first page.
  public var listQuery: SessionsListQuery {
    SessionsListQuery(selection: selection, range: range, search: activeSearch)
  }

  public func submitSearch() {
    let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    activeSearch = query.isEmpty ? nil : query
  }

  public func clearSearch() {
    searchText = ""
    activeSearch = nil
  }

  /// Sidebar machines, agents, and projects with indexed sessions.
  public func loadFacets() async {
    facetsPhase = .loading
    do {
      facets = SessionsFacets(try await client.facets())
      facetsPhase = .loaded
    } catch {
      facetsPhase = .failed(error)
    }
  }

  /// The first page for the current `listQuery`.
  public func loadSessions() async {
    sessions = []
    hasMoreSessions = false
    await loadSessionPage(offset: 0)
  }

  public func loadMoreSessions() async {
    guard hasMoreSessions, listPhase != .loading else { return }
    await loadSessionPage(offset: sessions.count)
  }

  /// The first message page of `selectedSessionID`.
  public func loadConversation() async {
    detailGeneration += 1
    let generation = detailGeneration
    conversation = nil
    guard let id = selectedSessionID else {
      detailPhase = .idle
      return
    }
    detailPhase = .loading
    do {
      let detail = try await client.session(id: id, limit: Self.messagePageSize)
      guard generation == detailGeneration else { return }
      conversation = SessionConversation(detail)
      detailPhase = .loaded
    } catch {
      guard generation == detailGeneration else { return }
      detailPhase = .failed(error)
    }
  }

  public func loadMoreMessages() async {
    guard let current = conversation, current.hasMore, detailPhase != .loading else { return }
    let generation = detailGeneration
    detailPhase = .loading
    do {
      let detail = try await client.session(
        id: current.session.id, offset: current.entries.count, limit: Self.messagePageSize)
      guard generation == detailGeneration else { return }
      conversation?.append(detail)
      detailPhase = .loaded
    } catch {
      guard generation == detailGeneration else { return }
      detailPhase = .failed(error)
    }
  }

  /// Changes whenever the period charts must be reloaded.
  public var periodQuery: UsagePeriodQuery {
    UsagePeriodQuery(range: range, period: usagePeriod, dimension: usageDimension)
  }

  /// The period charts for `periodQuery`, in this Mac's zone and week start.
  public func loadPeriodChart() async {
    periodChartGeneration += 1
    let generation = periodChartGeneration
    let query = periodQuery
    periodChartPhase = .loading
    do {
      let report = try await client.usageReport(
        HistoryUsageReportQuery(
          period: query.period, breakdown: [query.dimension], range: query.range,
          calendar: calendar))
      guard generation == periodChartGeneration else { return }
      periodChart = UsagePeriodChart(report, dimension: query.dimension)
      periodChartPhase = .loaded
    } catch {
      guard generation == periodChartGeneration else { return }
      periodChartPhase = .failed(error)
    }
  }

  /// The four breakdowns, top tools, and recent blocks for `range`.
  public func loadAnalytics() async {
    analyticsGeneration += 1
    let generation = analyticsGeneration
    let range = range
    analyticsPhase = .loading
    do {
      let loaded = try await Self.fetchAnalytics(client: client, range: range)
      guard generation == analyticsGeneration else { return }
      analytics = loaded
      analyticsPhase = .loaded
    } catch {
      guard generation == analyticsGeneration else { return }
      analyticsPhase = .failed(error)
    }
  }

  private func loadSessionPage(offset: Int) async {
    listGeneration += 1
    let generation = listGeneration
    let query = listQuery
    listPhase = .loading
    do {
      let page = try await fetchPage(query, offset: offset)
      guard generation == listGeneration else { return }
      sessions += page.sessions
      hasMoreSessions = page.hasMore
      listPhase = .loaded
    } catch {
      guard generation == listGeneration else { return }
      listPhase = .failed(error)
    }
  }

  private func fetchPage(_ query: SessionsListQuery, offset: Int) async throws(HistoryAPIError)
    -> HistorySessionsPage
  {
    let filter = query.selection.filter ?? HistorySessionFilter()
    if let search = query.search {
      return try await client.search(
        search, filter: filter, range: query.range, limit: Self.sessionPageSize,
        offset: offset)
    }
    return try await client.sessions(
      filter: filter, range: query.range, limit: Self.sessionPageSize, offset: offset)
  }

  nonisolated private static func fetchAnalytics(
    client: HistoryClient, range: HistoryTimeRange
  ) async throws(HistoryAPIError) -> SessionsAnalytics {
    async let model = capture { () async throws(HistoryAPIError) in
      try await client.usage(groupBy: .model, range: range)
    }
    async let source = capture { () async throws(HistoryAPIError) in
      try await client.usage(groupBy: .source, range: range)
    }
    async let workspace = capture { () async throws(HistoryAPIError) in
      try await client.usage(groupBy: .workspace, range: range)
    }
    async let machine = capture { () async throws(HistoryAPIError) in
      try await client.usage(groupBy: .machine, range: range)
    }
    async let tools = capture { () async throws(HistoryAPIError) in
      try await client.tools(range: range, limit: toolLimit)
    }
    async let blocks = capture { () async throws(HistoryAPIError) in
      try await client.blocks(
        HistoryBlocksQuery(activeOnly: false, scope: .allMachines, since: blocksSince))
    }
    let reports = SessionsAnalytics.Reports(
      model: try await model.get(), source: try await source.get(),
      workspace: try await workspace.get(), machine: try await machine.get())
    return SessionsAnalytics(
      range: range, reports: reports, tools: try await tools.get(),
      blocks: try await blocks.get())
  }

  nonisolated private static func capture<Value>(
    _ operation: () async throws(HistoryAPIError) -> Value
  ) async -> Result<Value, HistoryAPIError> {
    do {
      return .success(try await operation())
    } catch {
      return .failure(error)
    }
  }
}
