import Foundation
import XCTest

@testable import QuotaBarCore

final class DomainTests: XCTestCase {
  func testPercentageAndStatusBoundaries() throws {
    XCTAssertEqual(try XCTUnwrap(window(remaining: 4.99).remainingPercent), 4.99, accuracy: 0.001)
    XCTAssertEqual(snapshot(remaining: 4.99).quotaStatus, .critical)
    XCTAssertEqual(snapshot(remaining: 5).quotaStatus, .warning)
    XCTAssertEqual(snapshot(remaining: 20).quotaStatus, .warning)
    XCTAssertEqual(snapshot(remaining: 20.01).quotaStatus, .healthy)
    XCTAssertEqual(snapshot(remaining: nil).quotaStatus, .unavailable)
    XCTAssertEqual(
      snapshot(remaining: 80).markedStale(reason: "offline").quotaStatus,
      .unavailable
    )
  }

  func testWindowValidationAndCoding() throws {
    let value = try UsageWindow.validated(
      id: "five-hour",
      label: "5-hour",
      kind: .rolling(durationSeconds: 18_000),
      usedPercent: 25,
      resetAt: date("2026-08-10T00:00:00Z"),
      sourceTimestamp: date("2026-08-09T00:00:00Z")
    )
    XCTAssertEqual(
      try JSONDecoder().decode(UsageWindow.self, from: JSONEncoder().encode(value)), value)
    XCTAssertThrowsError(
      try UsageWindow.validated(
        id: "",
        label: "Valid",
        kind: .weekly,
        usedPercent: 10,
        resetAt: nil,
        sourceTimestamp: .now
      )
    )
    XCTAssertThrowsError(
      try UsageWindow.validated(
        id: "valid",
        label: " ",
        kind: .weekly,
        usedPercent: 10,
        resetAt: nil,
        sourceTimestamp: .now
      )
    )
    XCTAssertThrowsError(
      try UsageWindow.validated(
        id: "valid",
        label: "Valid",
        kind: .weekly,
        usedPercent: 101,
        resetAt: nil,
        sourceTimestamp: .now
      )
    )
    XCTAssertThrowsError(
      try UsageWindow.validated(
        id: "valid",
        label: "Valid",
        kind: .rolling(durationSeconds: 0),
        usedPercent: 10,
        resetAt: nil,
        sourceTimestamp: .now
      )
    )
  }

  func testResetsAreFilteredAndSorted() {
    let now = date("2026-08-09T00:00:00Z")
    let value = UsageSnapshot(
      provider: .codex,
      windows: [window(remaining: 50)],
      resets: [
        Reset(exp: date("2026-08-20T00:00:00Z")),
        Reset(exp: date("2026-08-08T00:00:00Z")),
        Reset(exp: date("2026-08-15T00:00:00Z")),
      ],
      sourceTimestamp: now
    )
    XCTAssertEqual(
      value.activeResets(at: now).map(\.exp),
      [
        date("2026-08-15T00:00:00Z"),
        date("2026-08-20T00:00:00Z"),
      ])
  }

  func testSubscriptionPlansAndProviderMetadata() {
    XCTAssertEqual(SubscriptionPlan.totalMonthlyCostUSD, 470)
    XCTAssertEqual(SubscriptionPlan.active.count, 4)
    XCTAssertEqual(SubscriptionPlan.plan(for: .claudeCode).monthlyCostUSD, 200)
    XCTAssertEqual(SubscriptionPlan.plan(for: .codex).monthlyCostUSD, 200)
    XCTAssertEqual(SubscriptionPlan.plan(for: .kimi).monthlyCostUSD, 40)
    XCTAssertEqual(SubscriptionPlan.plan(for: .grok).monthlyCostUSD, 30)
    XCTAssertEqual(
      ProviderID.grok.usageURL?.absoluteString,
      "https://grok.com/settings/usage?_s=usage"
    )
    for provider in ProviderID.allCases {
      XCTAssertFalse(provider.displayName.isEmpty)
      XCTAssertNotNil(provider.usageURL)
    }
  }

  func testSafeErrorDescriptionsAndAuthenticationClassification() {
    XCTAssertTrue(QuotaError.credentialsMissing(.kimi).isAuthenticationError)
    XCTAssertTrue(QuotaError.credentialsExpired(.grok).isAuthenticationError)
    XCTAssertTrue(QuotaError.unauthorized(.codex).isAuthenticationError)
    XCTAssertFalse(QuotaError.rateLimited(.codex).isAuthenticationError)
    XCTAssertTrue(QuotaError.credentialsExpired(.kimi).localizedDescription.contains("OpenCode"))
    XCTAssertTrue(QuotaError.unauthorized(.grok).localizedDescription.contains("OpenCode"))
    XCTAssertFalse(QuotaError.network(.grok).localizedDescription.isEmpty)
  }

  private func snapshot(remaining: Double?) -> UsageSnapshot {
    UsageSnapshot(
      provider: .codex,
      windows: [window(remaining: remaining)],
      sourceTimestamp: .now
    )
  }
}
