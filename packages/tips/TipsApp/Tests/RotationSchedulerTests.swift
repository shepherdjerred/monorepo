import Foundation
import XCTest

@testable import TipsApp

final class RotationSchedulerTests: XCTestCase {

    func testAdvancesOnNewDay() {
        let result = RotationScheduler.advance(
            lastShownDate: "2025-01-01",
            lastAppIndex: 0,
            appCount: 3
        )

        XCTAssertEqual(result.index, 1)
        XCTAssertTrue(result.didAdvance)
    }

    func testStaysOnSameDay() {
        let today = Date.now
        let todayString = RotationScheduler.formatDate(today)

        let result = RotationScheduler.advance(
            lastShownDate: todayString,
            lastAppIndex: 1,
            appCount: 3,
            today: today
        )

        XCTAssertEqual(result.index, 1)
        XCTAssertFalse(result.didAdvance)
    }

    func testWrapsAround() {
        let result = RotationScheduler.advance(
            lastShownDate: "2025-01-01",
            lastAppIndex: 2,
            appCount: 3
        )

        XCTAssertEqual(result.index, 0)
        XCTAssertTrue(result.didAdvance)
    }

    func testHandlesZeroApps() {
        let result = RotationScheduler.advance(
            lastShownDate: "",
            lastAppIndex: 0,
            appCount: 0
        )

        XCTAssertEqual(result.index, 0)
        XCTAssertFalse(result.didAdvance)
    }

    func testHandlesOverflowIndex() {
        let today = Date.now
        let todayString = RotationScheduler.formatDate(today)

        let result = RotationScheduler.advance(
            lastShownDate: todayString,
            lastAppIndex: 10,
            appCount: 3,
            today: today
        )

        XCTAssertEqual(result.index, 1) // 10 % 3 == 1
    }

    func testFormatsDate() {
        var components = DateComponents()
        components.year = 2025
        components.month = 3
        components.day = 15
        let date = Calendar.current.date(from: components)!

        let formatted = RotationScheduler.formatDate(date)
        XCTAssertEqual(formatted, "2025-03-15")
    }
}
