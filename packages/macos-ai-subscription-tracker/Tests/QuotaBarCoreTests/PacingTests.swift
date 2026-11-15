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
    XCTAssertEqual(pacing.unit, .day)
    XCTAssertEqual(pacing.secondsRemaining, 3 * 86_400)
    XCTAssertEqual(pacing.durationSeconds, WindowPacing.weeklyDurationSeconds)
    XCTAssertEqual(pacing.evenPace, 100.0 / 7.0, accuracy: 0.0001)
    XCTAssertEqual(pacing.actualPace, 20.0 / 3.0, accuracy: 0.001)
    XCTAssertEqual(pacing.status, .behind)
    // 80% used in 4 days is 20%/d, so the last 20% lasts one more day.
    XCTAssertEqual(pacing.runsOutAt, now.addingTimeInterval(86_400))
  }

  func testEvenSplitIsOnPace() throws {
    let pacing = try XCTUnwrap(
      WindowPacing.compute(
        window: window(remaining: 50, resetAt: now.addingTimeInterval(3.5 * 86_400)),
        at: now
      )
    )
    XCTAssertEqual(pacing.actualPace, pacing.evenPace, accuracy: 0.0001)
    XCTAssertEqual(pacing.status, .onPace)
    XCTAssertNil(pacing.runsOutAt)
  }

  func testSlightlySlowerThanEvenIsOnPace() throws {
    let pacing = try XCTUnwrap(
      WindowPacing.compute(
        window: window(remaining: 49, resetAt: now.addingTimeInterval(3 * 86_400)),
        at: now
      )
    )
    XCTAssertEqual(pacing.status, .onPace)
  }

  func testBurningTooSlowIsAhead() throws {
    let pacing = try XCTUnwrap(
      WindowPacing.compute(
        window: window(remaining: 30, resetAt: now.addingTimeInterval(86_400)),
        at: now
      )
    )
    XCTAssertEqual(pacing.actualPace, 30, accuracy: 0.001)
    XCTAssertEqual(pacing.status, .ahead)
    XCTAssertNil(pacing.runsOutAt)
  }

  func testFiveHourWindowsPaceInHoursAndRunOut() throws {
    let rolling = try UsageWindow.validated(
      id: "five-hour",
      label: "5-hour",
      kind: .rolling(durationSeconds: 18_000),
      usedPercent: 60,
      resetAt: now.addingTimeInterval(3 * 3_600),
      sourceTimestamp: now
    )
    let pacing = try XCTUnwrap(WindowPacing.compute(window: rolling, at: now))
    XCTAssertEqual(pacing.unit, .hour)
    XCTAssertEqual(pacing.evenPace, 20, accuracy: 0.0001)
    XCTAssertEqual(pacing.actualPace, 40.0 / 3.0, accuracy: 0.0001)
    XCTAssertEqual(pacing.status, .behind)
    XCTAssertEqual(pacing.format(pacing.evenPace), "20.0%/h")
    // 60% in 2 hours is 30%/h, so 40% lasts 80 minutes.
    XCTAssertEqual(pacing.runsOutAt, now.addingTimeInterval(80 * 60))
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = utcTimeZone()
    calendar.locale = Locale(identifier: "en_US_POSIX")
    XCTAssertEqual(
      pacing.runOutText(relativeTo: now, calendar: calendar).map(plainSpaces), "runs out ~1:20 AM")
  }

  func testRunOutOnAnotherDayNamesTheWeekday() throws {
    let pacing = try XCTUnwrap(
      WindowPacing.compute(
        window: window(remaining: 20, resetAt: now.addingTimeInterval(3 * 86_400)), at: now))
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = utcTimeZone()
    calendar.locale = Locale(identifier: "en_US_POSIX")
    let text = plainSpaces(try XCTUnwrap(pacing.runOutText(relativeTo: now, calendar: calendar)))
    XCTAssertTrue(text.hasPrefix("runs out ~Thu"), text)
    XCTAssertTrue(text.hasSuffix("12:00 AM"), text)
    let even = try XCTUnwrap(
      WindowPacing.compute(
        window: window(remaining: 50, resetAt: now.addingTimeInterval(3.5 * 86_400)), at: now))
    XCTAssertNil(even.runOutText(relativeTo: now, calendar: calendar))
  }

  func testAntigravityPerModelWindowsPaceByTheirLabel() throws {
    let data = fixture("antigravity-success")
    let snapshot = try AntigravityProvider.parse(data: data, now: now)
    for window in snapshot.windows {
      let duration = try XCTUnwrap(WindowPacing.duration(of: window), window.label)
      let expected =
        window.label.contains("5-hour")
        ? WindowPacing.fiveHourDurationSeconds : WindowPacing.weeklyDurationSeconds
      XCTAssertEqual(duration, expected, window.label)
    }
    let gemini = try UsageWindow.validated(
      id: "antigravity-gemini-5h", label: "Gemini 5-hour", kind: .modelScoped(model: "Gemini"),
      usedPercent: 10, resetAt: now.addingTimeInterval(3 * 3_600), sourceTimestamp: now)
    let pacing = try XCTUnwrap(WindowPacing.compute(window: gemini, at: now))
    XCTAssertEqual(pacing.unit, .hour)
    XCTAssertEqual(pacing.status, .ahead)
  }

  func testMonthlyWindowsUseTheCalendarMonthBeforeTheReset() throws {
    let monthly = try UsageWindow.validated(
      id: "monthly", label: "Cursor Models", kind: .monthly, usedPercent: 86,
      resetAt: date("2026-08-28T00:00:00Z"), sourceTimestamp: now)
    XCTAssertEqual(WindowPacing.duration(of: monthly), 31 * 86_400)
    let pacing = try XCTUnwrap(WindowPacing.compute(window: monthly, at: now))
    XCTAssertEqual(pacing.unit, .day)
    XCTAssertEqual(pacing.status, .behind)
    XCTAssertNotNil(pacing.runsOutAt)
    let labelled = try UsageWindow.validated(
      id: "kimi-monthly", label: "Monthly", kind: .providerDefined, usedPercent: 10,
      resetAt: date("2026-03-31T00:00:00Z"), sourceTimestamp: now)
    XCTAssertEqual(WindowPacing.duration(of: labelled), 31 * 86_400)
    let noReset = try UsageWindow.validated(
      id: "monthly", label: "Monthly", kind: .monthly, usedPercent: 10, resetAt: nil,
      sourceTimestamp: now)
    XCTAssertNil(WindowPacing.duration(of: noReset))
  }

  func testWindowsWithoutAPeriodAreSkipped() throws {
    let credits = try UsageWindow.validated(
      id: "credits", label: "Credits", kind: .credits, usedPercent: 40,
      resetAt: now.addingTimeInterval(3_600), sourceTimestamp: now)
    XCTAssertNil(WindowPacing.duration(of: credits))
    XCTAssertNil(WindowPacing.compute(window: credits, at: now))
    let policy = try UsageWindow.validated(
      id: "policy", label: "Weekly policy", kind: .entitlement, usedPercent: nil, resetAt: nil,
      sourceTimestamp: now)
    XCTAssertNil(WindowPacing.duration(of: policy))
    let unlabelled = try UsageWindow.validated(
      id: "rolling", label: "Rolling", kind: .rolling(durationSeconds: nil), usedPercent: 10,
      resetAt: now.addingTimeInterval(3_600), sourceTimestamp: now)
    XCTAssertNil(WindowPacing.duration(of: unlabelled))
    let scopedWeekly = try UsageWindow.validated(
      id: "weekly-fable", label: "Weekly · Fable", kind: .modelScoped(model: "Fable"),
      usedPercent: 40, resetAt: now.addingTimeInterval(3 * 86_400), sourceTimestamp: now)
    XCTAssertEqual(WindowPacing.duration(of: scopedWeekly), WindowPacing.weeklyDurationSeconds)
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

  func testUnusedOrExhaustedWindowsDoNotProjectARunOut() throws {
    let unused = try XCTUnwrap(
      WindowPacing.compute(
        window: window(remaining: 100, resetAt: now.addingTimeInterval(86_400)), at: now))
    XCTAssertNil(unused.runsOutAt)
    let exhausted = try XCTUnwrap(
      WindowPacing.compute(
        window: window(remaining: 0, resetAt: now.addingTimeInterval(86_400)), at: now))
    XCTAssertNil(exhausted.runsOutAt)
    XCTAssertEqual(exhausted.status, .behind)
  }

  func testFormat() throws {
    let pacing = try XCTUnwrap(
      WindowPacing.compute(
        window: window(remaining: 20, resetAt: now.addingTimeInterval(3 * 86_400)), at: now))
    XCTAssertEqual(pacing.format(100.0 / 7.0), "14.3%/d")
    XCTAssertEqual(pacing.format(20.0 / 3.0), "6.7%/d")
  }

  func testRealWeeklyFixtureWindowsProducePacing() throws {
    let fixtureNow = date("2026-08-12T00:00:00Z")
    let data = fixture("claude-success")
    let snapshot = try ClaudeCodeProvider.parse(data: data, now: fixtureNow)
    let weekly = snapshot.windows.filter { $0.kind == .weekly }
    XCTAssertFalse(weekly.isEmpty)
    for window in weekly {
      let pacing = try XCTUnwrap(WindowPacing.compute(window: window, at: fixtureNow))
      XCTAssertEqual(pacing.evenPace, 100.0 / 7.0, accuracy: 0.0001)
    }
  }
}

/// Foundation separates the time from AM/PM with a narrow no-break space.
private func plainSpaces(_ text: String) -> String {
  text.replacingOccurrences(of: "\u{202F}", with: " ")
}
