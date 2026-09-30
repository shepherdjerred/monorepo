import Foundation
import XCTest

@testable import QuotaBarCore

final class ProviderParsingTests: XCTestCase {
  private let now = date("2026-08-09T00:00:00Z")

  func testClaudeDynamicAndFableWindows() throws {
    let snapshot = try ClaudeCodeProvider.parse(data: fixture("claude-success"), now: now)
    XCTAssertEqual(snapshot.windows.count, 3)
    XCTAssertEqual(snapshot.windows.first(where: { $0.id == "five-hour" })?.remainingPercent, 72)
    XCTAssertNotNil(snapshot.windows.first(where: { $0.id == "weekly-fable" }))
    XCTAssertNil(snapshot.windows.first(where: { $0.id == "provider-nimbus-quill" }))
    XCTAssertTrue(snapshot.notes.isEmpty)
  }

  func testClaudeSevenDayBreakdownIsMetadataNotAWindow() throws {
    // `seven_day_breakdown` reports the weekly split as `rows`, with no utilization and no reset
    // date. Reading it as a window made the whole response unsupported, which took the row stale
    // even though the account and every real window still parsed.
    let snapshot = try ClaudeCodeProvider.parse(
      data: fixture("claude-seven-day-breakdown"), now: now)

    XCTAssertEqual(
      snapshot.windows.map(\.id).sorted(), ["five-hour", "weekly", "weekly-fable"])
    XCTAssertNil(snapshot.windows.first(where: { $0.id.contains("breakdown") }))
  }

  func testClaudeIgnoresUnrecognizedBreakdownMetadata() throws {
    XCTAssertThrowsError(
      try ClaudeCodeProvider.parse(
        data: Data(
          #"""
          {
            "five_hour": {"utilization": 10, "resets_at": "2026-08-09T22:00:00Z"},
            "seven_day": {"utilization": 20, "resets_at": "2026-08-14T00:00:00Z"},
            "unrecognized_breakdown": {
              "as_of": "2026-08-09T00:00:00Z",
              "rows": []
            }
          }
          """#.utf8
        ),
        now: now
      )
    )
  }

  func testClaudeLimitsPreserveModelAndPolicy() throws {
    let snapshot = try ClaudeCodeProvider.parse(data: fixture("claude-limits"), now: now)
    XCTAssertFalse(snapshot.windows.contains { $0.label.contains("Nimbus Quil") })
    XCTAssertNotNil(snapshot.windows.first(where: { $0.id == "fable-policy" }))
    XCTAssertFalse(snapshot.notes.isEmpty)
  }

  func testClaudeDuplicateWindowsMustBeEquivalent() throws {
    let equivalent = Data(
      #"""
      {
        "seven_day": {"utilization": 25, "resets_at": "2026-08-16T00:00:00Z"},
        "limits": [
          {"kind": "weekly_all", "percent": 25, "resets_at": "2026-08-16T00:00:00Z"}
        ]
      }
      """#.utf8
    )
    let snapshot = try ClaudeCodeProvider.parse(data: equivalent, now: now)
    XCTAssertEqual(snapshot.windows.filter { $0.id == "weekly" }.count, 1)

    let conflicting = Data(
      #"""
      {
        "seven_day": {"utilization": 25, "resets_at": "2026-08-16T00:00:00Z"},
        "limits": [
          {"kind": "weekly_all", "percent": 30, "resets_at": "2026-08-16T00:00:00Z"}
        ]
      }
      """#.utf8
    )
    XCTAssertThrowsError(try ClaudeCodeProvider.parse(data: conflicting, now: now))
  }

  func testClaudeWindowAliasesMustBeEquivalent() throws {
    let equivalent = Data(
      #"""
      {
        "five_hour": {
          "utilization": 25,
          "used_percent": 25,
          "resets_at": "2026-08-10T00:00:00Z",
          "resetAt": "2026-08-10T00:00:00Z"
        }
      }
      """#.utf8
    )
    XCTAssertNoThrow(try ClaudeCodeProvider.parse(data: equivalent, now: now))
    XCTAssertThrowsError(
      try ClaudeCodeProvider.parse(
        data: Data(#"{"five_hour":{"utilization":25,"used_percent":30}}"#.utf8),
        now: now
      )
    )
    XCTAssertThrowsError(
      try ClaudeCodeProvider.parse(
        data: Data(
          #"{"five_hour":{"utilization":25,"resets_at":"2026-08-10T00:00:00Z","resetAt":"2026-08-11T00:00:00Z"}}"#
            .utf8
        ),
        now: now
      )
    )
  }

  func testClaudeRejectsMissingAndInvalidWindows() {
    XCTAssertThrowsError(try ClaudeCodeProvider.parse(data: Data("{}".utf8), now: now))
    XCTAssertThrowsError(
      try ClaudeCodeProvider.parse(data: fixture("claude-invalid-percent"), now: now))
    XCTAssertThrowsError(
      try ClaudeCodeProvider.parse(data: Data(#"{"five_hour":{"utilization":"bad"}}"#.utf8))
    )
    XCTAssertThrowsError(
      try ClaudeCodeProvider.parse(data: Data(#"{"unknown_surface":{"enabled":true}}"#.utf8))
    )
    XCTAssertThrowsError(
      try ClaudeCodeProvider.parse(
        data: Data(
          #"{"limits":[{"kind":"monthly","percent":10,"resets_at":"2026-09-01T00:00:00Z"}]}"#
            .utf8
        )
      )
    )
    XCTAssertThrowsError(
      try ClaudeCodeProvider.parse(
        data: Data(
          #"{"limits":[{"kind":"weekly_scoped","percent":10,"resets_at":"2026-09-01T00:00:00Z"}]}"#
            .utf8
        )
      )
    )
  }

  func testCodexClassifiesEveryWindowFromDuration() throws {
    let snapshot = try CodexProvider.parse(data: fixture("codex-success"), now: now)
    XCTAssertEqual(snapshot.windows.map(\.label), ["Monthly", "5-hour", "Weekly"])
    XCTAssertEqual(
      snapshot.windows.map(\.kind),
      [
        .monthly,
        .rolling(durationSeconds: 18_000),
        .weekly,
      ])
  }

  func testCodexDoesNotGuessMissingDuration() throws {
    let snapshot = try CodexProvider.parse(data: fixture("codex-provider-defined"), now: now)
    XCTAssertEqual(snapshot.windows.count, 2)
    XCTAssertTrue(snapshot.windows.allSatisfy { $0.kind == .providerDefined })
    XCTAssertNil(snapshot.windows.first(where: { $0.label == "Burst Window" })?.usedPercent)
  }

  func testCodexResetFilteringAndErrors() throws {
    let resets = try CodexProvider.parseResets(data: fixture("codex-resets"), now: now)
    XCTAssertEqual(
      resets.map(\.exp),
      [
        date("2026-08-15T00:00:00Z"),
        date("2026-08-20T00:00:00Z"),
      ])
    let snapshot = try CodexProvider.parse(
      data: fixture("codex-provider-defined"),
      resetErrorMessage: "Reset surface unavailable",
      now: now
    )
    XCTAssertEqual(snapshot.resetErrorMessage, "Reset surface unavailable")
  }

  func testCodexRejectsUnrenderableEpochTimestamp() {
    XCTAssertThrowsError(
      try CodexProvider.parse(
        data: Data(
          #"{"rate_limit":{"x_window":{"used_percent":10,"reset_at":1e20}}}"#.utf8
        ),
        now: now
      )
    ) { error in
      XCTAssertEqual(error as? QuotaError, .malformedResponse(.codex))
    }
  }

  func testCodexRejectsMalformedFieldsAndUnsupportedShape() {
    XCTAssertThrowsError(try CodexProvider.parse(data: fixture("codex-malformed"), now: now))
    XCTAssertThrowsError(try CodexProvider.parse(data: Data(#"{"rate_limit":{}}"#.utf8), now: now))
    XCTAssertThrowsError(
      try CodexProvider.parse(
        data: Data(#"{"rate_limit":{"x_window":{"used_percent":10,"window_seconds":0}}}"#.utf8),
        now: now
      )
    )
    XCTAssertThrowsError(
      try CodexProvider.parse(
        data: Data(
          #"{"rate_limit":{"x_window":{"used_percent":10,"window_seconds":18000,"limit_window_seconds":604800}}}"#
            .utf8
        ),
        now: now
      )
    )
    XCTAssertThrowsError(
      try CodexProvider.parse(
        data: Data(
          #"{"rate_limit":{"grok-3_window":{"used_percent":10},"grok_3_window":{"used_percent":20}}}"#
            .utf8
        ),
        now: now
      )
    )
  }

  func testKimiAbsoluteValuesBecomePercentages() throws {
    let snapshot = try KimiProvider.parse(data: fixture("kimi-success"), now: now)
    XCTAssertEqual(snapshot.windows.map(\.remainingPercent), [75, 80, 60, 25])
    XCTAssertEqual(snapshot.windows.map(\.label), ["Shared usage", "5-hour", "Weekly", "Monthly"])
  }

  func testKimiWrapperAndValidation() throws {
    let snapshot = try KimiProvider.parse(data: fixture("kimi-wrapper"), now: now)
    XCTAssertEqual(snapshot.windows.first?.remainingPercent, 80)
    XCTAssertThrowsError(try KimiProvider.parse(data: fixture("kimi-invalid-pair"), now: now))
    XCTAssertThrowsError(
      try KimiProvider.parse(
        data: Data(
          #"{"limits":[{"window":{"duration":1,"timeUnit":"FORTNIGHT"},"detail":{"limit":10,"used":1}}]}"#
            .utf8
        ),
        now: now
      )
    )
  }

  func testKimiPercentageAliasesMustAgree() throws {
    let equivalent = Data(
      #"{"usage":{"used_percent":20,"usage_percent":20}}"#.utf8
    )
    XCTAssertEqual(
      try KimiProvider.parse(data: equivalent, now: now).windows.first?.remainingPercent,
      80
    )
    XCTAssertThrowsError(
      try KimiProvider.parse(
        data: Data(#"{"usage":{"used_percent":20,"usage_percent":30}}"#.utf8),
        now: now
      )
    )
  }
}
