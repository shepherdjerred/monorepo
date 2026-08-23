import Foundation
import XCTest

@testable import QuotaBarCore

final class UsageHistoryTests: XCTestCase {
  func testHistoryStoreRoundTripAndCorruptFile() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let url = root.appendingPathComponent("history/history.json")
    let store = JSONUsageHistoryStore(url: url)
    let sample = try makeSample(usedPercent: 25, at: "2026-08-09T08:00:00Z")

    XCTAssertTrue(try store.load().isEmpty)
    try store.save([sample])
    XCTAssertEqual(try store.load(), [sample])

    try Data("not-json".utf8).write(to: url)
    XCTAssertThrowsError(try store.load()) { error in
      XCTAssertEqual(error as? QuotaError, .historyCorrupt)
    }
  }

  func testHistoryCompactsDuplicatesAndPrunesAfterThirtyDays() throws {
    let now = date("2026-08-31T12:00:00Z")
    let retained = try makeSample(usedPercent: 25, at: "2026-08-01T12:00:00Z")
    let expired = try makeSample(usedPercent: 15, at: "2026-08-01T11:59:59Z")

    XCTAssertEqual(
      UsageHistory.compact([retained, retained, expired], at: now),
      [retained]
    )
  }

  func testTodayUsageSumsIncreasesAndIgnoresResetDrops() throws {
    let calendar = utcCalendar()
    let current = date("2026-08-09T12:00:00Z")
    let samples = [
      try makeSample(usedPercent: 10, at: "2026-08-09T00:10:00Z"),
      try makeSample(usedPercent: 15, at: "2026-08-09T04:00:00Z"),
      try makeSample(usedPercent: 2, at: "2026-08-09T08:00:00Z"),
      try makeSample(usedPercent: 8, at: "2026-08-09T11:00:00Z"),
      try makeSample(usedPercent: 90, at: "2026-08-08T23:00:00Z"),
    ]

    XCTAssertEqual(
      UsageHistory.todayUsedPercent(
        provider: .codex,
        windowID: "weekly",
        samples: samples,
        at: current,
        calendar: calendar
      ),
      11
    )
  }

  func testTodayUsageIncludesConsumptionAfterAReportedReset() throws {
    let calendar = utcCalendar()
    let current = date("2026-08-09T12:00:00Z")
    let oldReset = date("2026-08-09T06:00:00Z")
    let newReset = date("2026-08-16T08:00:00Z")
    let samples = [
      try makeSample(usedPercent: 10, resetAt: oldReset, at: "2026-08-09T00:10:00Z"),
      try makeSample(usedPercent: 15, resetAt: oldReset, at: "2026-08-09T04:00:00Z"),
      try makeSample(usedPercent: 2, resetAt: newReset, at: "2026-08-09T08:00:00Z"),
      try makeSample(usedPercent: 8, resetAt: newReset, at: "2026-08-09T11:00:00Z"),
    ]

    XCTAssertEqual(
      UsageHistory.todayUsedPercent(
        provider: .codex,
        windowID: "weekly",
        samples: samples,
        at: current,
        calendar: calendar
      ),
      13
    )
  }

  func testTodayUsageRequiresTwoSameDaySamplesAndKeepsWindowsSeparate() throws {
    let calendar = utcCalendar()
    let current = date("2026-08-09T12:00:00Z")
    let weekly = try makeSample(usedPercent: 10, at: "2026-08-09T10:00:00Z")
    let otherWindow = try UsageHistorySample(
      provider: .codex,
      windowID: "five-hour",
      label: "5-hour",
      kind: .rolling(durationSeconds: 18_000),
      usedPercent: 30,
      resetAt: nil,
      recordedAt: date("2026-08-09T11:00:00Z")
    )

    XCTAssertNil(
      UsageHistory.todayUsedPercent(
        provider: .codex,
        windowID: "weekly",
        samples: [weekly, otherWindow],
        at: current,
        calendar: calendar
      )
    )
  }

  func testWeeklyWindowRecognitionIncludesModelScopedWeeklyLabels() throws {
    let modelWeekly = try UsageWindow.validated(
      id: "weekly-fable",
      label: "Weekly · Fable",
      kind: .modelScoped(model: "Fable"),
      usedPercent: 40,
      resetAt: nil,
      sourceTimestamp: .now
    )
    XCTAssertTrue(modelWeekly.isWeekly)
  }

  private func makeSample(
    usedPercent: Double,
    resetAt: Date? = nil,
    at timestamp: String
  ) throws -> UsageHistorySample {
    try UsageHistorySample(
      provider: .codex,
      windowID: "weekly",
      label: "Weekly",
      kind: .weekly,
      usedPercent: usedPercent,
      resetAt: resetAt,
      recordedAt: date(timestamp)
    )
  }

  private func utcCalendar() -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    guard let timeZone = TimeZone(secondsFromGMT: 0) else {
      preconditionFailure("Expected UTC time zone")
    }
    calendar.timeZone = timeZone
    return calendar
  }
}
