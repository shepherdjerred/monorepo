import Foundation
import Testing
@testable import TipsApp

struct RotationSchedulerTests {
    @Test
    func `advances on new day`() {
        let result = RotationScheduler.advance(
            lastShownDate: "2025-01-01",
            lastAppIndex: 0,
            appCount: 3
        )

        #expect(result.index == 1)
        #expect(result.didAdvance)
    }

    @Test
    func `stays on same day`() {
        let today = Date.now
        let todayString = RotationScheduler.formatDate(today)

        let result = RotationScheduler.advance(
            lastShownDate: todayString,
            lastAppIndex: 1,
            appCount: 3,
            today: today
        )

        #expect(result.index == 1)
        #expect(!result.didAdvance)
    }

    @Test
    func `wraps around`() {
        let result = RotationScheduler.advance(
            lastShownDate: "2025-01-01",
            lastAppIndex: 2,
            appCount: 3
        )

        #expect(result.index == 0)
        #expect(result.didAdvance)
    }

    @Test
    func `handles zero apps`() {
        let result = RotationScheduler.advance(
            lastShownDate: "",
            lastAppIndex: 0,
            appCount: 0
        )

        #expect(result.index == 0)
        #expect(!result.didAdvance)
    }

    @Test
    func `handles overflow index`() {
        let today = Date.now
        let todayString = RotationScheduler.formatDate(today)

        let result = RotationScheduler.advance(
            lastShownDate: todayString,
            lastAppIndex: 10,
            appCount: 3,
            today: today
        )

        #expect(result.index == 1) // 10 % 3 == 1
    }

    @Test
    func `formats date`() throws {
        var components = DateComponents()
        components.year = 2025
        components.month = 3
        components.day = 15
        let date = try #require(Calendar.current.date(from: components))

        let formatted = RotationScheduler.formatDate(date)
        #expect(formatted == "2025-03-15")
    }
}
