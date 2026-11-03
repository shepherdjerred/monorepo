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
