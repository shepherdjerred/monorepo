import Foundation
import XCTest

@testable import QuotaBarCore

final class GrokParsingTests: XCTestCase {
  private let now = date("2026-08-09T00:00:00Z")

  func testGrokSurfacesDecodeIndependently() throws {
    let identity = try GrokProvider.parseIdentity(data: fixture("grok-user"))
    XCTAssertEqual(identity.userID, "user_quotabar_fixture")
    XCTAssertEqual(identity.accountLabel, "fixture@example.com")
    XCTAssertEqual(
      try GrokProvider.parseBilling(data: fixture("grok-billing"), now: now).first?
        .remainingPercent, 65)
    let credits = try GrokProvider.parseCredits(data: fixture("grok-credits"), now: now)
    XCTAssertEqual(credits.map(\.remainingPercent), [58, 82, 55, 90])
    XCTAssertEqual(
      credits.map(\.resetAt),
      [
        date("2026-08-16T00:00:00Z"),
        date("2026-08-16T00:00:00Z"),
        date("2026-08-16T00:00:00Z"),
        date("2026-08-16T00:00:00Z"),
      ]
    )
  }

  func testGrokProductResetAtWinsOverSharedPeriodEnd() throws {
    let credits = try GrokProvider.parseCredits(
      data: Data(
        #"""
        {
          "config": {
            "currentPeriod": {"type": "weekly", "end": "2026-08-16T00:00:00Z"},
            "productUsage": {
              "chat": {"creditUsagePercent": 20, "resetAt": "2026-08-20T00:00:00Z"}
            }
          }
        }
        """#.utf8
      ),
      now: now
    )
    XCTAssertEqual(credits.map(\.id), ["grok-shared-credits", "grok-product-chat"])
    XCTAssertEqual(
      credits.map(\.resetAt),
      [date("2026-08-16T00:00:00Z"), date("2026-08-20T00:00:00Z")]
    )
  }

  func testGrokProductAliasesMustBeUnambiguous() throws {
    let identicalAliases = try GrokProvider.parseCredits(
      data: Data(
        #"""
        {
          "config": {
            "productUsage": {"chat": {"creditUsagePercent": 20}},
            "productBreakdown": {"chat": {"creditUsagePercent": 20}}
          }
        }
        """#.utf8
      ),
      now: now
    )
    XCTAssertEqual(identicalAliases.first?.remainingPercent, 80)

    XCTAssertThrowsError(
      try GrokProvider.parseCredits(
        data: Data(
          #"""
          {
            "config": {
              "productUsage": {},
              "productBreakdown": {"chat": {"creditUsagePercent": 20}}
            }
          }
          """#.utf8
        ),
        now: now
      )
    )
    XCTAssertThrowsError(
      try GrokProvider.parseCredits(
        data: Data(
          #"{"config":{"productUsage":{"grok-3":{"creditUsagePercent":20},"grok_3":{"creditUsagePercent":30}}}}"#
            .utf8
        ),
        now: now
      )
    )
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

  func testGrokUnifiedCreditBillingHasNoMonthlyDollarWindow() throws {
    XCTAssertEqual(
      try GrokProvider.parseBilling(data: fixture("grok-billing-zero-limit"), now: now),
      []
    )
    let credits = try GrokProvider.parseCredits(data: fixture("grok-credits-unified"), now: now)
    XCTAssertEqual(credits.map(\.id), ["grok-shared-credits", "grok-product-chat"])
    XCTAssertEqual(credits.map(\.kind), [.weekly, .modelScoped(model: "Chat")])
    XCTAssertEqual(credits.map(\.remainingPercent), [91, 91])
    XCTAssertEqual(Set(credits.compactMap(\.resetAt)).count, 1)
    XCTAssertNotNil(credits[0].resetAt)
    let snapshot = try GrokProvider.parse(
      billing: .success(fixture("grok-billing-zero-limit")),
      credits: .success(fixture("grok-credits-unified")),
      accountLabel: "fixture@example.com",
      now: now
    )
    XCTAssertEqual(snapshot.windows.map(\.id), ["grok-shared-credits", "grok-product-chat"])
    XCTAssertEqual(snapshot.notes, [])
  }

  func testGrokRemainingResetsDecodeGrpcWebTokens() throws {
    XCTAssertEqual(
      try GrokProvider.parseResets(data: grokEmptyResets, now: now),
      []
    )
    let resets = try GrokProvider.parseResets(data: grokAvailableResets, now: now)
    XCTAssertEqual(
      resets.map(\.exp),
      [date("2026-08-15T00:00:00Z"), date("2026-08-20T00:00:00Z")]
    )
    let snapshot = try GrokProvider.parse(
      billing: .success(fixture("grok-billing-zero-limit")),
      credits: .success(fixture("grok-credits-unified")),
      resets: resets,
      accountLabel: "fixture@example.com",
      now: now
    )
    XCTAssertEqual(snapshot.resets, resets)
    XCTAssertNil(snapshot.resetErrorMessage)
  }

  func testGrokRemainingResetsRejectMalformedFramesAndMapRpcFailures() {
    XCTAssertThrowsError(
      try GrokProvider.parseResets(data: Data("not-grpc".utf8), now: now)
    ) { error in
      XCTAssertEqual(error as? QuotaError, .malformedResponse(.grok))
    }
    XCTAssertThrowsError(
      try GrokProvider.parseResets(
        data: data(hex: "00000000008000000010677270632d7374617475733a31330d0a"),
        now: now
      )
    ) { error in
      XCTAssertEqual(error as? QuotaError, .network(.grok))
    }
    XCTAssertThrowsError(
      try GrokProvider.parseResets(
        data: data(hex: "00000000008000000010677270632d7374617475733a31360d0a"),
        now: now
      )
    ) { error in
      XCTAssertEqual(error as? QuotaError, .unauthorized(.grok))
    }
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
    XCTAssertThrowsError(
      try GrokProvider.parseCredits(
        data: Data(
          #"{"config":{"productUsage":{"chat":{"limit":100,"used":20,"remaining":10}}}}"#
            .utf8
        ),
        now: now
      )
    )
    XCTAssertThrowsError(
      try GrokProvider.parseCredits(
        data: Data(
          #"{"config":{"productUsage":{"chat":{"limit":100,"used":20,"creditUsagePercent":30}}}}"#
            .utf8
        ),
        now: now
      )
    )
    XCTAssertThrowsError(
      try GrokProvider.parseCredits(
        data: Data(
          #"{"config":{"creditUsagePercent":20,"currentPeriod":{"type":"biweekly","end":"2026-08-16T00:00:00Z"}}}"#
            .utf8
        ),
        now: now
      )
    )
  }
}
