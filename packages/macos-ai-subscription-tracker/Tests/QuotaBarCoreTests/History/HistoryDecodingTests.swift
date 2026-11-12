import Foundation
import XCTest

@testable import QuotaBarCore

final class HistoryDecodingTests: XCTestCase {
  func testDecodesTheSharedSessionsFixture() throws {
    let page: HistorySessionsPage = try decode("sessions", path: "/v1/search")
    XCTAssertEqual(page.query, "argocd prune")
    XCTAssertTrue(page.hasMore)
    XCTAssertEqual(page.sessions.map(\.id), [42, 7])
    let local = page.sessions[0]
    XCTAssertEqual(local.source, .claude)
    XCTAssertNil(local.machine)
    XCTAssertEqual(local.gitBranch, "fix-argocd-prune")
    XCTAssertEqual(local.usage.costUSD, 14.52)
    XCTAssertEqual(local.usage.totalTokens, 1_820 + 40_211 + 6_120_334 + 210_044)
    XCTAssertEqual(local.updatedAt, date("2026-11-08T18:40:03Z"))
    XCTAssertEqual(local.createdAt, date("2026-11-08T17:02:11Z"))
    XCTAssertEqual(local.usageEvents, 64)
    XCTAssertTrue(local.hasUsage)
    let mirrored = page.sessions[1]
    XCTAssertEqual(mirrored.source, .codexMirror)
    XCTAssertEqual(mirrored.machine, "jerred-desktop")
    XCTAssertNil(mirrored.gitBranch)
    XCTAssertFalse(mirrored.usage.costComplete)
    XCTAssertEqual(mirrored.usage.cachedInputTokens, 840_112)
    XCTAssertEqual(mirrored.usage.reasoningTokens, 5_120)
  }

  func testDecodesTheSharedSessionDetailFixture() throws {
    let detail: HistorySessionDetail = try decode("session-detail", path: "/v1/sessions/42")
    XCTAssertEqual(detail.session.title, "Prune stale ArgoCD applications")
    XCTAssertEqual(detail.offset, 0)
    XCTAssertEqual(detail.totalMessages, 3)
    XCTAssertEqual(detail.messages.map(\.role), [.user, .tool, .assistant])
    XCTAssertEqual(detail.messages[1].toolName, "Bash")
    XCTAssertEqual(detail.messages[0].createdAt, date("2026-11-08T17:02:11Z"))
    XCTAssertNil(detail.messages[2].createdAt)
    XCTAssertTrue(detail.messages[1].isToolCall)
    XCTAssertFalse(detail.messages[1].isToolOutput)
  }

  func testDecodesTheSharedUsageFixture() throws {
    let report: HistoryUsageReport = try decode("usage", path: "/v1/usage")
    XCTAssertEqual(report.groupBy, .day)
    XCTAssertEqual(report.since, date("2026-11-02T00:00:00Z"))
    XCTAssertEqual(report.total.costUSD, 15.4)
    XCTAssertFalse(report.total.costComplete)
    XCTAssertEqual(report.rows.map(\.key), ["2026-11-07", "2026-11-08"])
    XCTAssertEqual(report.rows[0].events, 31)
    XCTAssertEqual(report.rows[0].sessionCount, 1)
    XCTAssertEqual(report.rows[1].usage.cacheReadTokens, 6_120_334)
    XCTAssertTrue(report.rows[1].usage.costComplete)
  }

  func testDecodesTheSharedToolsFixture() throws {
    let report: HistoryToolsReport = try decode("tools", path: "/v1/tools")
    XCTAssertNil(report.since)
    XCTAssertEqual(report.rows.map(\.name), ["Bash", "Edit", "exec_command"])
    XCTAssertEqual(report.rows[0].calls, 412)
    XCTAssertEqual(report.rows[0].sessions, 38)
  }

  func testDecodesTheSharedFacetsFixture() throws {
    let report: HistoryFacetsReport = try decode("facets", path: "/v1/facets")
    XCTAssertEqual(report.machines.map(\.key), [nil, "jerreds-macbook-pro", "jerred-desktop"])
    XCTAssertEqual(report.machines.first?.sessions, 1_204)
    XCTAssertEqual(report.sources.map(\.key), [.codex, .claude, .claudeMirror, .codexMirror])
    XCTAssertEqual(report.workspaces.map(\.key), ["/Users/jerred/git/monorepo", nil])
    XCTAssertEqual(report.workspaces.last?.sessions, 96)
  }

  func testTheSharedErrorFixtureBecomesAServerError() throws {
    let response = jsonResponse(try sharedHistoryFixture("error"), status: 404)
    XCTAssertThrowsError(
      try HistoryClient.decode(response, path: "/v1/sessions/99") as HistoryToolsReport
    ) { error in
      XCTAssertEqual(
        error as? HistoryAPIError,
        .server(
          status: 404,
          message: "History record 99 no longer exists; local ids change after a rebuild."))
    }
  }

  func testRejectsAnotherAPIVersionBeforeDecodingTheBody() {
    assertError(#"{"apiVersion":2,"rows":"changed"}"#, .unsupportedAPIVersion(2))
  }

  func testNamesTheMissingKeyAndItsLocation() {
    let body = #"{"apiVersion":1,"since":null,"rows":[{"name":"Bash","calls":1}]}"#
    assertError(
      body, .decoding(path: "/v1/tools", detail: "missing key `sessions` at rows[0]"))
  }

  func testRejectsAnUnknownSource() throws {
    let text = utf8Text(try sharedHistoryFixture("sessions"))
      .replacingOccurrences(of: #""codex-mirror""#, with: #""gemini""#)
    let response = jsonResponse(text)
    XCTAssertThrowsError(
      try HistoryClient.decode(response, path: "/v1/sessions") as HistorySessionsPage
    ) { error in
      guard case let .decoding(path, detail) = error as? HistoryAPIError else {
        return XCTFail("Expected a decoding error, got \(error)")
      }
      XCTAssertEqual(path, "/v1/sessions")
      XCTAssertTrue(detail.hasSuffix("at sessions[1].source"), detail)
    }
  }

  func testReportsNullsAndMalformedJSON() {
    assertError(
      #"{"apiVersion":1,"since":null,"rows":[{"name":null,"calls":1,"sessions":1}]}"#,
      .decoding(path: "/v1/tools", detail: "null value at rows[0].name"))
    assertError(
      "not json",
      .decoding(path: "/v1/tools", detail: "The given data was not valid JSON."))
    assertError(
      "not json", status: 500,
      .decoding(path: "/v1/tools", detail: "The given data was not valid JSON."))
  }

  func testTimestampsAreISO8601DateTimes() {
    XCTAssertEqual(HistoryTimestamp.parse("2026-11-08T18:40:03Z"), date("2026-11-08T18:40:03Z"))
    XCTAssertEqual(
      HistoryTimestamp.parse("2026-11-08T19:40:03.250+01:00"),
      date("2026-11-08T18:40:03Z").addingTimeInterval(0.25))
    XCTAssertNil(HistoryTimestamp.parse("yesterday"))
    assertError(
      #"{"apiVersion":1,"since":"yesterday","rows":[]}"#,
      .decoding(
        path: "/v1/tools", detail: "yesterday is not an ISO 8601 date-time at since"))
  }

  func testEverySourceHasADisplayName() {
    XCTAssertEqual(
      Set(HistorySource.allCases.map(\.displayName)).count, HistorySource.allCases.count)
  }

  private func decode<Value: HistoryVersionedResponse>(_ fixture: String, path: String) throws
    -> Value
  {
    try HistoryClient.decode(jsonResponse(try sharedHistoryFixture(fixture)), path: path)
  }

  private func assertError(
    _ body: String, status: Int = 200, _ expected: HistoryAPIError,
    file: StaticString = #filePath, line: UInt = #line
  ) {
    XCTAssertThrowsError(
      try HistoryClient.decode(jsonResponse(body, status: status), path: "/v1/tools")
        as HistoryToolsReport, file: file, line: line
    ) { error in
      XCTAssertEqual(error as? HistoryAPIError, expected, file: file, line: line)
    }
  }
}

final class HistoryEndpointTests: XCTestCase {
  func testBuildsEveryRequestTarget() {
    XCTAssertEqual(
      HistoryEndpoint.sessions(
        HistorySessionFilter(
          source: .claudeMirror, machine: .local, workspace: "/Users/me/git/my repo"),
        range: .week, limit: 50, offset: 100
      ).target,
      "/v1/sessions?since=7d&source=claude-mirror&machine=local"
        + "&workspace=%2FUsers%2Fme%2Fgit%2Fmy%20repo&limit=50&offset=100")
    XCTAssertEqual(
      HistoryEndpoint.sessions(HistorySessionFilter(), range: .all, limit: 1, offset: 0).target,
      "/v1/sessions?limit=1&offset=0")
    XCTAssertEqual(
      HistoryEndpoint.search(
        query: "c++ & é", filter: HistorySessionFilter(), range: .day, limit: 5, offset: 0
      ).target,
      "/v1/search?q=c%2B%2B%20%26%20%C3%A9&since=24h&limit=5&offset=0")
    XCTAssertEqual(
      HistoryEndpoint.search(
        query: "x", filter: HistorySessionFilter(source: .codex, machine: .local, workspace: "/w"),
        range: .all, limit: 5, offset: 10
      ).target,
      "/v1/search?q=x&source=codex&machine=local&workspace=%2Fw&limit=5&offset=10")
    XCTAssertEqual(HistoryEndpoint.facets.target, "/v1/facets")
    XCTAssertEqual(
      HistoryEndpoint.session(id: 42, offset: 200, limit: 200).target,
      "/v1/sessions/42?offset=200&limit=200")
    XCTAssertEqual(
      HistoryEndpoint.usage(.model, range: .quarter, source: .codex).target,
      "/v1/usage?groupBy=model&since=90d&source=codex")
    XCTAssertEqual(
      HistoryEndpoint.tools(range: .month, limit: 15).target, "/v1/tools?since=30d&limit=15")
  }

  func testMachinesAndRanges() {
    XCTAssertEqual(HistoryMachine(key: nil), .local)
    XCTAssertEqual(HistoryMachine(key: "pc"), .mirrored("pc"))
    XCTAssertEqual(HistoryMachine.mirrored("pc").displayName, "pc")
    XCTAssertEqual(HistoryMachine.local.displayName, "This Mac")
    XCTAssertEqual(HistoryEndpoint.encode("pc"), "pc")
    XCTAssertEqual(
      HistoryTimeRange.allCases.map(\.label),
      ["24 hours", "7 days", "30 days", "90 days", "All time"])
  }
}
