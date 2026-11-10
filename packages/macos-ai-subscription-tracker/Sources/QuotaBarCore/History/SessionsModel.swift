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

  public var selection: SessionsSidebarItem = .all {
    didSet { if selection != oldValue { selectedSessionID = nil } }
  }
  public var range: HistoryTimeRange = .month
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

  private let client: HistoryClient
  private let calendar: Calendar
  private var listGeneration = 0
  private var detailGeneration = 0
  private var analyticsGeneration = 0

  public init(client: HistoryClient = HistoryClient(), calendar: Calendar = .current) {
    self.client = client
    self.calendar = calendar
  }

  /// Changes whenever the session list must be reloaded from the first page.
  public var listQuery: SessionsListQuery {
    SessionsListQuery(selection: selection, range: range, search: activeSearch)
  }

  /// The search endpoint filters by source and time only, so a machine or
  /// project selection does not narrow a search.
  public var searchScopeNote: String? {
    guard activeSearch != nil else { return nil }
    switch selection {
    case .machine, .workspace: return "Search covers every machine and project."
    case .all, .source, .analytics: return nil
    }
  }

  public func submitSearch() {
    let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    activeSearch = query.isEmpty ? nil : query
  }

  public func clearSearch() {
    searchText = ""
    activeSearch = nil
  }

  /// Sidebar machines, agents, and projects from all-time usage.
  public func loadFacets() async {
    facetsPhase = .loading
    do {
      let machines = try await client.usage(groupBy: .machine, range: .all)
      let sources = try await client.usage(groupBy: .source, range: .all)
      let workspaces = try await client.usage(groupBy: .workspace, range: .all)
      facets = SessionsFacets(machines: machines, sources: sources, workspaces: workspaces)
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

  /// Daily totals, the four breakdowns, and top tools for `range`.
  public func loadAnalytics() async {
    analyticsGeneration += 1
    let generation = analyticsGeneration
    let range = range
    analyticsPhase = .loading
    do {
      let loaded = try await Self.fetchAnalytics(client: client, range: range, calendar: calendar)
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
        search, source: filter.source, range: query.range, limit: Self.sessionPageSize,
        offset: offset)
    }
    return try await client.sessions(
      filter: filter, range: query.range, limit: Self.sessionPageSize, offset: offset)
  }

  nonisolated private static func fetchAnalytics(
    client: HistoryClient, range: HistoryTimeRange, calendar: Calendar
  ) async throws(HistoryAPIError) -> SessionsAnalytics {
    async let day = capture { () async throws(HistoryAPIError) in
      try await client.usage(groupBy: .day, range: range)
    }
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
    let reports = SessionsAnalytics.Reports(
      day: try await day.get(), model: try await model.get(), source: try await source.get(),
      workspace: try await workspace.get(), machine: try await machine.get())
    return try SessionsAnalytics(
      range: range, reports: reports, tools: try await tools.get(), calendar: calendar)
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
