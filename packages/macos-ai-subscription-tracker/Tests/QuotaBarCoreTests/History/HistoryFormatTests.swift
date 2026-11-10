import Foundation
import XCTest

@testable import QuotaBarCore

final class HistoryFormatTests: XCTestCase {
  func testCostIsALowerBoundWhenIncomplete() {
    XCTAssertEqual(HistoryFormat.cost(HistoryUsage(costUSD: 14.52)), "$14.52")
    XCTAssertEqual(HistoryFormat.cost(HistoryUsage(costUSD: 0.88, costComplete: false)), "≥ $0.88")
    XCTAssertEqual(HistoryFormat.dollars(0.001), "<$0.01")
    XCTAssertEqual(HistoryFormat.dollars(0), "$0.00")
    XCTAssertEqual(HistoryFormat.dollars(1_234.5), "$1,234.50")
    XCTAssertNil(HistoryFormat.costNote(HistoryUsage()))
    XCTAssertNotNil(HistoryFormat.costNote(HistoryUsage(costComplete: false)))
  }

  func testTokensWorkspacesAndMachines() {
    XCTAssertEqual(HistoryFormat.tokens(6_120_334), "6.1M")
    XCTAssertEqual(HistoryFormat.tokens(912), "912")
    XCTAssertEqual(HistoryFormat.tokens(52_544_109_180), "52.5B")
    XCTAssertEqual(HistoryFormat.tokens(999_960_000), "1.0B")
    XCTAssertEqual(HistoryFormat.workspaceName("/Users/jerred/git/monorepo"), "monorepo")
    XCTAssertEqual(HistoryFormat.workspaceName(#"C:\Users\jerred\git\monorepo\"#), "monorepo")
    XCTAssertEqual(HistoryFormat.workspaceName("/"), "/")
    XCTAssertEqual(HistoryFormat.machine(nil), "This Mac")
    XCTAssertEqual(HistoryFormat.machine("pc"), "pc")
  }

  func testUpdatedIsRelativeForAWeekThenADate() {
    let now = date("2026-11-09T12:00:00Z")
    XCTAssertEqual(HistoryFormat.updated(date("2026-11-09T09:00:00Z"), relativeTo: now), "3h ago")
    XCTAssertEqual(
      HistoryFormat.updated(date("2026-10-01T12:00:00Z"), relativeTo: now),
      date("2026-10-01T12:00:00Z").formatted(.dateTime.year().month(.abbreviated).day()))
  }

  func testASessionWithoutUsageEventsShowsNoUsageRatherThanZero() throws {
    let page: HistorySessionsPage = try HistoryClient.decode(
      jsonResponse(try sharedHistoryFixture("sessions")), path: "/v1/sessions")
    let measured = page.sessions[0]
    XCTAssertEqual(HistoryFormat.cost(of: measured), "$14.52")
    XCTAssertEqual(HistoryFormat.tokens(of: measured), "6.4M tok")
    let text = utf8Text(try sharedHistoryFixture("sessions"))
      .replacingOccurrences(of: #""usageEvents": 31"#, with: #""usageEvents": 0"#)
    let unmeasured = try XCTUnwrap(
      (try HistoryClient.decode(jsonResponse(text), path: "/v1/sessions") as HistorySessionsPage)
        .sessions.last)
    XCTAssertFalse(unmeasured.hasUsage)
    XCTAssertEqual(HistoryFormat.cost(of: unmeasured), "—")
    XCTAssertEqual(HistoryFormat.tokens(of: unmeasured), "—")
  }

  func testOutputsGroupUnderTheirInvocation() {
    let entries = [
      entry(0, role: .user), entry(1, role: .tool, toolName: nil),
      entry(2, role: .tool, toolName: "Bash"), entry(3, role: .tool, toolName: nil),
      entry(4, role: .tool, toolName: nil), entry(5, role: .assistant),
      entry(6, role: .tool, toolName: "Edit"),
    ]
    XCTAssertEqual(
      ConversationItem.group(entries),
      [
        .message(entries[0]), .output(entries[1]),
        .tool(call: entries[2], outputs: [entries[3], entries[4]]), .message(entries[5]),
        .tool(call: entries[6], outputs: []),
      ])
    XCTAssertEqual(ConversationItem.group(entries).map(\.id), [0, 1, 2, 5, 6])
  }

  func testOutputsOfABatchOfInvocationsStayStandalone() {
    let entries = [
      entry(0, role: .tool, toolName: "Read"), entry(1, role: .tool, toolName: "Edit"),
      entry(2, role: .tool, toolName: nil), entry(3, role: .tool, toolName: nil),
      entry(4, role: .tool, toolName: "Bash"), entry(5, role: .tool, toolName: nil),
    ]
    XCTAssertEqual(
      ConversationItem.group(entries),
      [
        .tool(call: entries[0], outputs: []), .tool(call: entries[1], outputs: []),
        .output(entries[2]), .output(entries[3]),
        .tool(call: entries[4], outputs: [entries[5]]),
      ])
  }

  private func entry(_ id: Int, role: HistoryMessageRole, toolName: String? = nil)
    -> SessionConversationEntry
  {
    SessionConversationEntry(
      id: id,
      message: HistoryMessage(role: role, text: "m\(id)", createdAt: nil, toolName: toolName))
  }

  func testEveryErrorExplainsItselfAndTheDaemonOnesNameAFix() {
    let errors: [HistoryAPIError] = [
      .daemonNotRunning(socketPath: "/s"),
      .connectionFailed("read: reset"),
      .server(status: 500, message: "boom"),
      .server(status: 400, message: "bad since"),
      .malformedHTTP("chunked"),
      .decoding(path: "/v1/tools", detail: "missing key"),
      .unsupportedAPIVersion(2),
    ]
    XCTAssertEqual(
      errors.map(\.fixCommand),
      [
        "toolkit history daemon install", "toolkit history daemon status",
        "toolkit history daemon status", nil, nil, nil, nil,
      ])
    for error in errors {
      XCTAssertFalse(error.errorDescription?.isEmpty ?? true, "\(error)")
    }
    XCTAssertNil(HistoryAPIError.server(status: 400, message: "bad").recoverySuggestion)
    XCTAssertNotNil(HistoryAPIError.server(status: 500, message: "bad").recoverySuggestion)
    XCTAssertNotNil(HistoryAPIError.daemonNotRunning(socketPath: "/s").recoverySuggestion)
    XCTAssertNotNil(HistoryAPIError.unsupportedAPIVersion(2).recoverySuggestion)
    XCTAssertEqual(
      HistoryAPIError.unsupportedAPIVersion(2).errorDescription,
      "The history daemon serves API version 2; Brim reads version 1.")
  }

  func testSidebarItemsMapToFilters() {
    XCTAssertEqual(SessionsSidebarItem.all.filter, HistorySessionFilter())
    XCTAssertNil(SessionsSidebarItem.analytics.filter)
    XCTAssertEqual(
      SessionsSidebarItem.machine(.local).filter, HistorySessionFilter(machine: .local))
  }
}
