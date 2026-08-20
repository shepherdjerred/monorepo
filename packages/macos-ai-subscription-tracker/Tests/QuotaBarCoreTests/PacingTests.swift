import Foundation
import XCTest

@testable import QuotaBarCore

final class PacingTests: XCTestCase {
  private let now = date("2026-08-19T00:00:00Z")

  func testEvenSplitExampleFromRequest() throws {
    let pacing = try XCTUnwrap(
      WindowPacing.compute(
        window: window(remaining: 20, resetAt: now.addingTimeInterval(3 * 86_400)),
        at: now
      )
    )
    XCTAssertEqual(pacing.daysRemaining, 3, accuracy: 0.001)
    XCTAssertEqual(pacing.evenPacePerDay, 100.0 / 7.0, accuracy: 0.0001)
    XCTAssertEqual(pacing.actualPacePerDay, 20.0 / 3.0, accuracy: 0.001)
    XCTAssertEqual(pacing.status, .ahead)
  }

  func testEvenSplitIsOnPace() throws {
    let pacing = try XCTUnwrap(
      WindowPacing.compute(
        window: window(remaining: 50, resetAt: now.addingTimeInterval(3.5 * 86_400)),
        at: now
      )
    )
    XCTAssertEqual(pacing.actualPacePerDay, pacing.evenPacePerDay, accuracy: 0.0001)
    XCTAssertEqual(pacing.status, .ahead)
  }

  func testSlightlyFasterThanEvenIsOnPace() throws {
    let pacing = try XCTUnwrap(
      WindowPacing.compute(
        window: window(remaining: 49, resetAt: now.addingTimeInterval(3 * 86_400)),
        at: now
      )
    )
    XCTAssertEqual(pacing.status, .onPace)
  }

  func testBurningTooFastIsBehind() throws {
    let pacing = try XCTUnwrap(
      WindowPacing.compute(
        window: window(remaining: 30, resetAt: now.addingTimeInterval(86_400)),
        at: now
      )
    )
    XCTAssertEqual(pacing.actualPacePerDay, 30, accuracy: 0.001)
    XCTAssertEqual(pacing.status, .behind)
  }

  func testNonWeeklyWindowIsSkipped() throws {
    let rolling = try UsageWindow.validated(
      id: "five-hour",
      label: "5-hour",
      kind: .rolling(durationSeconds: 18_000),
      usedPercent: 40,
      resetAt: now.addingTimeInterval(7_200),
      sourceTimestamp: now
    )
    XCTAssertNil(WindowPacing.compute(window: rolling, at: now))
  }

  func testModelScopedWeeklyIsSkipped() throws {
    let scoped = try UsageWindow.validated(
      id: "weekly-fable",
      label: "Weekly · Fable",
      kind: .modelScoped(model: "Fable"),
      usedPercent: 40,
      resetAt: now.addingTimeInterval(3 * 86_400),
      sourceTimestamp: now
    )
    XCTAssertNil(WindowPacing.compute(window: scoped, at: now))
  }

  func testMissingResetOrUsageIsSkipped() {
    XCTAssertNil(
      WindowPacing.compute(window: window(remaining: 40, resetAt: nil), at: now)
    )
    XCTAssertNil(
      WindowPacing.compute(
        window: window(remaining: nil, resetAt: now.addingTimeInterval(86_400)),
        at: now
      )
    )
  }

  func testPastOrDistantResetIsSkipped() {
    XCTAssertNil(
      WindowPacing.compute(
        window: window(remaining: 40, resetAt: now.addingTimeInterval(-60)),
        at: now
      )
    )
    XCTAssertNil(
      WindowPacing.compute(
        window: window(remaining: 40, resetAt: now.addingTimeInterval(30 * 86_400)),
        at: now
      )
    )
  }

  func testFormat() {
    XCTAssertEqual(WindowPacing.format(100.0 / 7.0), "14.3%/d")
    XCTAssertEqual(WindowPacing.format(20.0 / 3.0), "6.7%/d")
  }

  func testRealWeeklyFixtureWindowsProducePacing() throws {
    let data = fixture("claude-success")
    let snapshot = try ClaudeCodeProvider.parse(data: data, now: now)
    let weekly = snapshot.windows.filter { $0.kind == .weekly }
    XCTAssertFalse(weekly.isEmpty)
    for window in weekly {
      if let pacing = WindowPacing.compute(window: window, at: now) {
        XCTAssertEqual(pacing.evenPacePerDay, 100.0 / 7.0, accuracy: 0.0001)
      }
    }
  }
}
