import Foundation
import XCTest

@testable import QuotaBarCore

final class APICreditGrantTests: XCTestCase {
  private let now = date("2026-11-01T00:00:00Z")

  func testOpenAIGrantsSplitPurchasedFromGrantedAndDropExpired() throws {
    let parsed = try APICreditGrants.parse(fixture("openai-credit-grants"), now: now)
    guard case let .grants(grants) = parsed else {
      XCTFail("Expected parsed grants")
      return
    }
    XCTAssertEqual(grants.map(\.kind), [.purchased, .granted, .unspecified])
    XCTAssertEqual(grants.map(\.remainingUSD), [decimal("12.5"), decimal("3"), decimal("2")])
    XCTAssertEqual(grants[0].expiresAt, date("2027-01-01T00:00:00Z"))
    XCTAssertNil(grants[2].expiresAt)

    let snapshot = APIPlatformSnapshot(
      platform: .openAI,
      workspaceNames: [],
      monthlySpend: decimal("1"),
      projectedSpend: decimal("2"),
      sourceTimestamp: now,
      credits: APIPlatformCredits(remaining: decimal("17.5"), grants: grants)
    )
    let rows = snapshot.creditBalanceRows(at: now)
    XCTAssertEqual(rows.map(\.label), ["Purchased", "Granted", "Credit"])
    XCTAssertEqual(rows.map(\.remainingUSD), [decimal("12.5"), decimal("3"), decimal("2")])
    XCTAssertEqual(rows[0].soonestExpiry, date("2027-01-01T00:00:00Z"))
    XCTAssertNil(rows[2].soonestExpiry)
    XCTAssertEqual(rows[2].helpText, "$2.00, no expiration returned")
    XCTAssertEqual(snapshot.creditsRemaining, decimal("17.5"))
  }

  func testAnthropicGrantsUseRemainingAmountObjects() throws {
    let parsed = try APICreditGrants.parse(fixture("anthropic-credit-grants"), now: now)
    guard case let .grants(grants) = parsed else {
      XCTFail("Expected parsed grants")
      return
    }
    XCTAssertEqual(grants.map(\.kind), [.purchased, .granted])
    XCTAssertEqual(grants.map(\.remainingUSD), [decimal("10.00"), decimal("4.5")])
  }

  func testEmptyAndFullyExpiredGrantsStayUnavailable() throws {
    let empty = try APICreditGrants.parse(fixture("empty-credit-grants"), now: now)
    XCTAssertEqual(empty, .unavailable)
    let expired = Data(
      """
      {"data":[{"type":"purchased","remaining":4,"currency":"usd","expires_at":"2026-10-01T00:00:00Z"}]}
      """.utf8
    )
    XCTAssertEqual(try APICreditGrants.parse(expired, now: now), .unavailable)
  }

  func testMalformedGrantAmountsFail() {
    let nonUSD = Data(
      #"{"data":[{"type":"purchased","remaining":1,"currency":"eur"}]}"#.utf8
    )
    let negative = Data(
      #"{"data":[{"grant_type":"granted","remaining_amount":{"value":-1,"currency":"usd"}}]}"#.utf8
    )
    XCTAssertThrowsError(try APICreditGrants.parse(nonUSD, now: now)) { error in
      XCTAssertEqual(error as? APICreditGrantError, .malformed)
    }
    XCTAssertThrowsError(try APICreditGrants.parse(negative, now: now)) { error in
      XCTAssertEqual(error as? APICreditGrantError, .malformed)
    }
  }

  func testGrantWithoutATypeIsLabeledCredit() throws {
    let data = Data(#"{"data":[{"remaining":6,"currency":"usd"}]}"#.utf8)
    let parsed = try APICreditGrants.parse(data, now: now)
    guard case let .grants(grants) = parsed else {
      XCTFail("Expected an untyped grant")
      return
    }
    XCTAssertEqual(grants.map(\.kind), [.unspecified])
    XCTAssertEqual(grants[0].helpLine(), "$6.00, no expiration returned")
  }
}
