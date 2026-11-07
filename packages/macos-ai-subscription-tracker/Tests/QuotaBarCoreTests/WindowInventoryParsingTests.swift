import Foundation
import XCTest

@testable import QuotaBarCore

final class WindowInventoryParsingTests: XCTestCase {
  private let now = date("2026-08-09T00:00:00Z")

  func testClaudeSavedResetsExpandGrantsAndIgnorePausedOrExpired() throws {
    let snapshot = try ClaudeCodeProvider.parse(
      data: Data(
        #"""
        {
          "five_hour": {"utilization": 10, "resets_at": "2026-08-09T05:00:00Z"},
          "cedar_ember": {
            "eligible": true,
            "grants": [
              {
                "resets_left": 2,
                "ends_at": "2026-08-20T00:00:00Z",
                "paused": false
              },
              {
                "resets_left": 1,
                "ends_at": "2026-08-15T00:00:00Z",
                "paused": true
              },
              {
                "resets_left": 1,
                "ends_at": "2026-08-01T00:00:00Z"
              }
            ]
          }
        }
        """#.utf8
      ),
      now: now
    )
    XCTAssertEqual(snapshot.windows.map(\.id).sorted(), ["fable-policy", "five-hour"])
    XCTAssertNil(snapshot.resetErrorMessage)
    XCTAssertEqual(
      snapshot.resets.map(\.exp),
      [date("2026-08-20T00:00:00Z"), date("2026-08-20T00:00:00Z")]
    )
  }

  // The live answer for an account without saved resets: an empty inventory, not an error.
  func testClaudeNoGrantMeansNoResets() throws {
    let snapshot = try ClaudeCodeProvider.parse(
      data: Data(
        #"""
        {
          "five_hour": {"utilization": 10, "resets_at": "2026-08-09T05:00:00Z"},
          "cedar_ember": {
            "eligible": false, "ineligible_reason": "no_grant", "at_limit": false,
            "exhausted": [], "grants": [], "next_grant_id": null,
            "weekly_resets_at": "2026-08-12T00:00:00+00:00"
          }
        }
        """#.utf8
      ),
      now: now
    )
    XCTAssertTrue(snapshot.resets.isEmpty)
    XCTAssertNil(snapshot.resetErrorMessage)

    let contradictory = try ClaudeCodeProvider.parse(
      data: Data(
        #"""
        {
          "five_hour": {"utilization": 10, "resets_at": "2026-08-09T05:00:00Z"},
          "cedar_ember": {
            "eligible": false, "ineligible_reason": "no_grant",
            "grants": [{"resets_left": 1, "ends_at": "2026-08-20T00:00:00Z"}]
          }
        }
        """#.utf8
      ),
      now: now
    )
    XCTAssertTrue(contradictory.resets.isEmpty)
    XCTAssertEqual(contradictory.resetErrorMessage, "Saved usage-limit resets could not be read.")
  }

  func testClaudeIneligibleOrMalformedResetsKeepUsageWindows() throws {
    let ineligible = try ClaudeCodeProvider.parse(
      data: Data(
        #"""
        {
          "five_hour": {"utilization": 10, "resets_at": "2026-08-09T05:00:00Z"},
          "cedar_ember": {"eligible": false, "ineligible_reason": "surface", "grants": []}
        }
        """#.utf8
      ),
      now: now
    )
    XCTAssertEqual(ineligible.windows.map(\.id).sorted(), ["fable-policy", "five-hour"])
    XCTAssertTrue(ineligible.resets.isEmpty)
    XCTAssertEqual(
      ineligible.resetErrorMessage,
      "Saved usage-limit resets are not available for this account."
    )

    let nullBlock = try ClaudeCodeProvider.parse(
      data: Data(
        #"{"five_hour":{"utilization":10,"resets_at":"2026-08-09T05:00:00Z"},"cedar_ember":null}"#
          .utf8
      ),
      now: now
    )
    XCTAssertEqual(
      nullBlock.resetErrorMessage,
      "Saved usage-limit resets were not returned."
    )

    let malformed = try ClaudeCodeProvider.parse(
      data: Data(
        #"""
        {
          "five_hour": {"utilization": 10, "resets_at": "2026-08-09T05:00:00Z"},
          "cedar_ember": {"eligible": true, "grants": [{"resets_left": 1}]}
        }
        """#.utf8
      ),
      now: now
    )
    XCTAssertEqual(malformed.windows.map(\.id).sorted(), ["fable-policy", "five-hour"])
    XCTAssertEqual(
      malformed.resetErrorMessage,
      "Saved usage-limit resets could not be read."
    )
  }

  func testKimiRatioPoolsKeepEveryNamedWindowAndDedupeFiveHour() throws {
    let snapshot = try KimiProvider.parse(data: fixture("kimi-usages"), now: now)
    XCTAssertEqual(
      snapshot.windows.map(\.label),
      ["5-hour", "Custom Pool", "Monthly · Code", "Monthly"]
    )
    XCTAssertEqual(snapshot.windows.map(\.id).filter { $0 == "kimi-5-hour" }, [])
    XCTAssertEqual(snapshot.windows.map(\.remainingPercent), [70, 50, 75, 87.5])
    XCTAssertEqual(snapshot.windows.first { $0.label == "Daily" }, nil)
  }

  func testKimiFiveHourRatioMustAgreeWithAbsoluteWindow() throws {
    XCTAssertThrowsError(
      try KimiProvider.parse(
        data: Data(
          #"""
          {
            "limits": [
              {
                "window": {"duration": 300, "timeUnit": "TIME_UNIT_MINUTE"},
                "detail": {"limit": "100", "used": "30", "resetTime": "2026-08-09T05:00:00Z"}
              }
            ],
            "usages": {
              "limit_5h": {"used_ratio": 0.5, "reset_time": "2026-08-09T05:00:00Z"}
            }
          }
          """#.utf8
        ),
        now: now
      )
    )
  }

  // Kimi's live shape: the absolute 5-hour window counts whole units (100 left of 100)
  // while the ratio is exact (0.31% used), and the two resets differ by under a second.
  func testKimiFiveHourRatioWithinOneUnitUsesExactRatio() throws {
    let snapshot = try KimiProvider.parse(
      data: Data(
        #"""
        {
          "limits": [
            {
              "window": {"duration": 300, "timeUnit": "TIME_UNIT_MINUTE"},
              "detail": {"limit": "100", "remaining": "100", "resetTime": "2026-08-09T05:02:15.851696Z"}
            }
          ],
          "usages": {
            "limit_5h": {"used_ratio": 0.0031, "reset_time": "2026-08-09T05:02:15Z"},
            "limit_month_total": {"used_ratio": 0.4339, "reset_time": "2026-08-27T00:00:00Z"},
            "limit_month_code": {"used_ratio": 0.4339, "reset_time": "2026-08-27T00:00:00Z"}
          }
        }
        """#.utf8
      ),
      now: now
    )
    // The code pool equals the monthly total here, so only Monthly remains.
    XCTAssertEqual(snapshot.windows.map(\.label), ["5-hour", "Monthly"])
    let fiveHour = try XCTUnwrap(snapshot.windows.first)
    XCTAssertEqual(try XCTUnwrap(fiveHour.usedPercent), 0.31, accuracy: 0.0001)
    XCTAssertEqual(fiveHour.id, "kimi-0-5-hour")
    XCTAssertEqual(try XCTUnwrap(snapshot.windows.last?.usedPercent), 43.39, accuracy: 0.0001)
  }

  // One unit of a 1000-unit limit is 0.1%, so a 0.2% gap is a contradiction, not rounding.
  func testKimiFiveHourRatioBeyondOneUnitStillThrows() throws {
    XCTAssertThrowsError(
      try KimiProvider.parse(
        data: Data(
          #"""
          {
            "limits": [
              {
                "window": {"duration": 300, "timeUnit": "TIME_UNIT_MINUTE"},
                "detail": {"limit": "1000", "remaining": "1000", "resetTime": "2026-08-09T05:00:00Z"}
              }
            ],
            "usages": {
              "limit_5h": {"used_ratio": 0.002, "reset_time": "2026-08-09T05:00:00Z"}
            }
          }
          """#.utf8
        ),
        now: now
      )
    )
  }

  func testKimiNamesDailyAndWeeklyDurations() throws {
    let daily = try KimiProvider.parse(
      data: Data(
        #"""
        {
          "limits": [
            {
              "window": {"duration": 1, "timeUnit": "TIME_UNIT_DAY"},
              "detail": {"limit": "10", "used": "1", "resetTime": "2026-08-10T00:00:00Z"}
            }
          ]
        }
        """#.utf8
      ),
      now: now
    )
    XCTAssertEqual(daily.windows.map(\.label), ["Daily"])
    XCTAssertEqual(daily.windows.map(\.compactDisplayLabel), ["Daily"])
    XCTAssertEqual(daily.windows.map(\.kind), [.rolling(durationSeconds: 86_400)])

    let weekly = try KimiProvider.parse(
      data: Data(
        #"""
        {
          "limits": [
            {
              "window": {"duration": 1, "timeUnit": "WEEK"},
              "detail": {"limit": "10", "used": "4", "resetTime": "2026-08-16T00:00:00Z"}
            }
          ]
        }
        """#.utf8
      ),
      now: now
    )
    XCTAssertEqual(weekly.windows.map(\.label), ["Weekly"])
    XCTAssertEqual(weekly.windows.map(\.kind), [.weekly])
  }
}
