import Foundation
import XCTest

@testable import QuotaBarCore

final class ProviderParsingTests: XCTestCase {
  private let now = date("2026-08-09T00:00:00Z")

  func testClaudeDynamicAndFableWindows() throws {
    let snapshot = try ClaudeCodeProvider.parse(data: fixture("claude-success"), now: now)
    XCTAssertEqual(snapshot.windows.count, 4)
    XCTAssertEqual(snapshot.windows.first(where: { $0.id == "five-hour" })?.remainingPercent, 72)
    XCTAssertNotNil(snapshot.windows.first(where: { $0.id == "weekly-fable" }))
    XCTAssertEqual(
      snapshot.windows.first(where: { $0.id == "provider-nimbus-quill" })?.kind,
      .providerDefined
    )
    XCTAssertTrue(snapshot.notes.isEmpty)
  }

  func testClaudeLimitsPreserveModelAndPolicy() throws {
    let snapshot = try ClaudeCodeProvider.parse(data: fixture("claude-limits"), now: now)
    let scoped = snapshot.windows.first { $0.label.contains("Nimbus Quil") }
    XCTAssertEqual(scoped?.kind, .modelScoped(model: "Nimbus Quil"))
    XCTAssertNotNil(snapshot.windows.first(where: { $0.id == "fable-policy" }))
    XCTAssertFalse(snapshot.notes.isEmpty)
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

  func testCodexRejectsMalformedFieldsAndUnsupportedShape() {
    XCTAssertThrowsError(try CodexProvider.parse(data: fixture("codex-malformed"), now: now))
    XCTAssertThrowsError(try CodexProvider.parse(data: Data(#"{"rate_limit":{}}"#.utf8), now: now))
    XCTAssertThrowsError(
      try CodexProvider.parse(
        data: Data(#"{"rate_limit":{"x_window":{"used_percent":10,"window_seconds":0}}}"#.utf8),
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

  func testGrokSurfacesDecodeIndependently() throws {
    let identity = try GrokProvider.parseIdentity(data: fixture("grok-user"))
    XCTAssertEqual(identity.userID, "user_quotabar_fixture")
    XCTAssertEqual(identity.accountLabel, "fixture@example.com")
    XCTAssertEqual(
      try GrokProvider.parseBilling(data: fixture("grok-billing"), now: now).first?
        .remainingPercent, 65)
    let credits = try GrokProvider.parseCredits(data: fixture("grok-credits"), now: now)
    XCTAssertEqual(credits.map(\.remainingPercent), [58, 82, 55, 90])
  }

  func testGrokUnknownUsageIsNotZeroAndPartialDataSurvives() throws {
    let unknown = try GrokProvider.parseCredits(data: fixture("grok-credits-unknown"), now: now)
    XCTAssertNil(unknown.first?.usedPercent)
    let snapshot = try GrokProvider.parse(
      billing: .success(fixture("grok-billing")),
      credits: .failure("offline"),
      accountLabel: "fixture@example.com",
      now: now
    )
    XCTAssertEqual(snapshot.windows.count, 1)
    XCTAssertTrue(snapshot.notes.first?.contains("offline") == true)
  }

  func testGrokRejectsInvalidSurfaceShapes() {
    XCTAssertThrowsError(
      try GrokProvider.parseBilling(data: fixture("grok-invalid-monthly"), now: now))
    XCTAssertThrowsError(
      try GrokProvider.parseCredits(data: Data(#"{"config":{}}"#.utf8), now: now))
    XCTAssertThrowsError(try GrokProvider.parseIdentity(data: Data(#"{"userId":""}"#.utf8)))
    XCTAssertThrowsError(
      try GrokProvider.parse(
        billing: .failure("offline"),
        credits: .failure("offline"),
        accountLabel: nil,
        now: now
      )
    )
    XCTAssertThrowsError(
      try GrokProvider.parse(
        billing: .success(fixture("grok-invalid-monthly")),
        credits: .success(fixture("grok-credits")),
        accountLabel: nil,
        now: now
      )
    )
    XCTAssertThrowsError(
      try GrokProvider.parse(
        billing: .success(fixture("grok-billing")),
        credits: .success(Data(#"{"config":{}}"#.utf8)),
        accountLabel: nil,
        now: now
      )
    )
  }
}
