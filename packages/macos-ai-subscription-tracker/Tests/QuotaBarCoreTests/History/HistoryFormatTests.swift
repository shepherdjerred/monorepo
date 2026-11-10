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
    XCTAssertEqual(
      HistoryFormat.updated("x", date: date("2026-11-09T09:00:00Z"), relativeTo: now), "3h ago")
    XCTAssertEqual(
      HistoryFormat.updated("x", date: date("2026-10-01T12:00:00Z"), relativeTo: now),
      date("2026-10-01T12:00:00Z").formatted(.dateTime.year().month(.abbreviated).day()))
    XCTAssertEqual(HistoryFormat.updated("someday", date: nil, relativeTo: now), "someday")
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
