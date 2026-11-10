import Foundation
import Synchronization
import XCTest

@testable import QuotaBarCore

@MainActor
final class SessionsModelTests: XCTestCase {
  func testLoadsTheFirstPageAndThenTheNext() async {
    let transport = fixtureTransport()
    let model = SessionsModel(client: HistoryClient(transport: transport))
    XCTAssertEqual(model.listPhase, .idle)

    await model.loadSessions()
    XCTAssertEqual(model.listPhase, .loaded)
    XCTAssertEqual(model.sessions.map(\.id), [42, 7])
    XCTAssertTrue(model.hasMoreSessions)

    await model.loadMoreSessions()
    XCTAssertEqual(model.sessions.count, 4)
    let targets = await transport.log.targets
    XCTAssertEqual(
      targets,
      ["/v1/sessions?since=30d&limit=50&offset=0", "/v1/sessions?since=30d&limit=50&offset=2"])
  }

  func testTheSidebarSelectionFiltersTheList() async {
    let transport = fixtureTransport()
    let model = SessionsModel(client: HistoryClient(transport: transport))
    model.range = .all
    model.selectedSessionID = 42
    model.selection = .machine(.mirrored("pc"))
    XCTAssertNil(model.selectedSessionID)
    await model.loadSessions()
    model.selection = .source(.codex)
    await model.loadSessions()
    model.selection = .workspace("/w")
    await model.loadSessions()
    model.selection = .analytics
    await model.loadSessions()
    let targets = await transport.log.targets
    XCTAssertEqual(
      targets,
      [
        "/v1/sessions?machine=pc&limit=50&offset=0",
        "/v1/sessions?source=codex&limit=50&offset=0",
        "/v1/sessions?workspace=%2Fw&limit=50&offset=0",
        "/v1/sessions?limit=50&offset=0",
      ])
  }

  func testSearchPassesTheSidebarSelectionThrough() async {
    let transport = fixtureTransport()
    let model = SessionsModel(client: HistoryClient(transport: transport))
    model.searchText = "   "
    model.submitSearch()
    XCTAssertNil(model.activeSearch)

    model.searchText = " argocd prune "
    model.submitSearch()
    XCTAssertEqual(model.activeSearch, "argocd prune")
    XCTAssertEqual(model.listQuery.search, "argocd prune")
    model.selection = .source(.claude)
    await model.loadSessions()
    model.selection = .machine(.mirrored("jerred-desktop"))
    await model.loadSessions()
    model.selection = .workspace("/w")
    await model.loadSessions()

    model.clearSearch()
    XCTAssertEqual(model.searchText, "")
    XCTAssertNil(model.activeSearch)
    let targets = await transport.log.targets
    XCTAssertEqual(
      targets,
      [
        "/v1/search?q=argocd%20prune&since=30d&source=claude&limit=50&offset=0",
        "/v1/search?q=argocd%20prune&since=30d&machine=jerred-desktop&limit=50&offset=0",
        "/v1/search?q=argocd%20prune&since=30d&workspace=%2Fw&limit=50&offset=0",
      ])
  }

  func testAListFailureKeepsTheTypedError() async {
    let model = SessionsModel(
      client: HistoryClient(transport: fixtureTransport(failing: "/v1/sessions")))
    await model.loadSessions()
    XCTAssertEqual(
      model.listPhase.error,
      .server(
        status: 404,
        message: "History record 99 no longer exists; local ids change after a rebuild."))
    XCTAssertTrue(model.sessions.isEmpty)
    await model.loadMoreSessions()
    XCTAssertNil(HistoryLoadPhase.loaded.error)
  }

  func testFacetsComeFromTheFacetsEndpoint() async {
    let model = SessionsModel(client: HistoryClient(transport: fixtureTransport()))
    XCTAssertEqual(model.facets, SessionsFacets())
    await model.loadFacets()
    XCTAssertEqual(model.facetsPhase, .loaded)
    XCTAssertEqual(
      model.facets.machines.map(\.item),
      [
        .machine(.local), .machine(.mirrored("jerreds-macbook-pro")),
        .machine(.mirrored("jerred-desktop")),
      ])
    XCTAssertEqual(model.facets.machines.map(\.title).first, "This Mac")
    XCTAssertEqual(model.facets.machines.map(\.sessionCount), [1_204, 612, 88])
    XCTAssertEqual(
      model.facets.sources.map(\.item),
      [.source(.codex), .source(.claude), .source(.claudeMirror), .source(.codexMirror)])
    XCTAssertEqual(model.facets.sources.first?.title, "Codex")
    XCTAssertEqual(model.facets.workspaces.map(\.title), ["monorepo"])
    XCTAssertEqual(model.facets.workspaces.first?.detail, "/Users/jerred/git/monorepo")
    XCTAssertEqual(model.facets.workspaces.first?.id, .workspace("/Users/jerred/git/monorepo"))
    XCTAssertEqual(model.facets.sessionsWithoutWorkspace, 96)
  }

  func testThisMacIsListedFirst() throws {
    let body = """
      {"apiVersion":1,"machines":[{"key":"pc","sessions":9},{"key":null,"sessions":2}],\
      "sources":[],"workspaces":[]}
      """
    let report: HistoryFacetsReport = try HistoryClient.decode(
      jsonResponse(body), path: "/v1/facets")
    XCTAssertEqual(SessionsFacets(report).machines.map(\.title), ["This Mac", "pc"])
    XCTAssertEqual(SessionsFacets(report).sessionsWithoutWorkspace, 0)
  }

  func testAFacetFailureIsReported() async {
    let model = SessionsModel(
      client: HistoryClient(transport: fixtureTransport(failing: "/v1/facets")))
    await model.loadFacets()
    XCTAssertEqual(model.facetsPhase.error?.fixCommand, nil)
    XCTAssertNotNil(model.facetsPhase.error)
  }

  func testPagesThroughAConversation() async {
    let transport = fixtureTransport()
    let model = SessionsModel(client: HistoryClient(transport: transport))
    await model.loadConversation()
    XCTAssertEqual(model.detailPhase, .idle)
    XCTAssertNil(model.conversation)

    model.selectedSessionID = 42
    await model.loadConversation()
    XCTAssertEqual(model.detailPhase, .loaded)
    XCTAssertEqual(model.conversation?.entries.map(\.id), [0, 1])
    XCTAssertEqual(model.conversation?.hasMore, true)

    XCTAssertEqual(model.conversation?.items.count, 2)

    await model.loadMoreMessages()
    XCTAssertEqual(model.conversation?.entries.map(\.id), [0, 1, 2])
    XCTAssertEqual(model.conversation?.entries.last?.message.isToolOutput, true)
    XCTAssertEqual(model.conversation?.hasMore, false)
    guard case let .tool(call, outputs) = model.conversation?.items.last else {
      XCTFail("Expected the output grouped under its call across pages")
      return
    }
    XCTAssertEqual(call.message.toolName, "Bash")
    XCTAssertEqual(outputs.map(\.id), [2])
    await model.loadMoreMessages()

    let targets = await transport.log.targets
    XCTAssertEqual(
      targets, ["/v1/sessions/42?offset=0&limit=200", "/v1/sessions/42?offset=2&limit=200"])
  }

  func testAMissingSessionShowsTheServerMessage() async {
    let model = SessionsModel(client: HistoryClient(transport: fixtureTransport()))
    model.selectedSessionID = 99
    await model.loadConversation()
    XCTAssertEqual(model.detailPhase.error, .server(status: 404, message: "Not found"))
  }

  func testAFailedNextMessagePageKeepsTheLoadedMessages() async {
    let failNext = FailSwitch()
    let model = SessionsModel(
      client: HistoryClient(
        transport: FakeHistoryTransport { path, target in
          if failNext.isOn { throw HistoryAPIError.daemonNotRunning(socketPath: "/s") }
          return try fixtureTransport().handler(path, target)
        }))
    model.selectedSessionID = 42
    await model.loadConversation()
    failNext.isOn = true
    await model.loadMoreMessages()
    XCTAssertEqual(model.conversation?.entries.count, 2)
    XCTAssertEqual(model.detailPhase.error, .daemonNotRunning(socketPath: "/s"))
  }

  func testLoadsAnalyticsForTheRange() async throws {
    let transport = fixtureTransport()
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = utcTimeZone()
    let model = SessionsModel(client: HistoryClient(transport: transport), calendar: calendar)
    model.range = .week
    await model.loadAnalytics()
    XCTAssertEqual(model.analyticsPhase, .loaded)
    let analytics = try XCTUnwrap(model.analytics)
    XCTAssertEqual(analytics.range, .week)
    XCTAssertEqual(
      analytics.daily.map(\.day), [date("2026-11-07T00:00:00Z"), date("2026-11-08T00:00:00Z")])
    XCTAssertEqual(analytics.daily.first?.id, date("2026-11-07T00:00:00Z"))
    XCTAssertEqual(analytics.daily.last?.usage.costUSD, 14.52)
    XCTAssertEqual(analytics.total.costUSD, 15.4)
    XCTAssertEqual(analytics.byModel.map(\.key), ["gpt-5.5-codex", "claude-opus-5-5"])
    XCTAssertEqual(analytics.bySource.map(\.key), ["codex-mirror", "claude"])
    XCTAssertEqual(analytics.byMachine.map(\.key), [nil, "jerred-desktop"])
    XCTAssertEqual(analytics.byWorkspace.count, 2)
    XCTAssertEqual(analytics.tools.map(\.calls), [412, 160, 95])
    let targets = Set(await transport.log.targets)
    XCTAssertTrue(targets.contains("/v1/tools?since=7d&limit=15"))
    XCTAssertTrue(targets.contains("/v1/usage?groupBy=machine&since=7d"))
  }

  func testAnalyticsFailsOnAnUnreadableDayKey() async {
    let model = SessionsModel(
      client: HistoryClient(
        transport: FakeHistoryTransport { path, target in
          let response = try fixtureTransport().handler(path, target)
          guard target.contains("groupBy=day") else { return response }
          let text = utf8Text(response.body)
            .replacingOccurrences(of: "2026-11-07", with: "Saturday")
          return jsonResponse(text)
        }))
    await model.loadAnalytics()
    XCTAssertEqual(
      model.analyticsPhase.error,
      .decoding(path: "/v1/usage", detail: "day key Saturday is not YYYY-MM-DD"))
    XCTAssertNil(model.analytics)
  }

  func testAnAnalyticsFailureIsTyped() async {
    let model = SessionsModel(
      client: HistoryClient(transport: fixtureTransport(failing: "/v1/tools")))
    await model.loadAnalytics()
    XCTAssertEqual(
      model.analyticsPhase.error?.errorDescription?.hasPrefix(
        "The history daemon returned HTTP 404"), true)
  }
}

/// A flag the fake transport reads from its own executor.
private final class FailSwitch: Sendable {
  private let state = Mutex(false)

  var isOn: Bool {
    get { state.withLock { $0 } }
    set { state.withLock { $0 = newValue } }
  }
}
