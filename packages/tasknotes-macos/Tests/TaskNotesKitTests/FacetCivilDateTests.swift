import Foundation
import Testing

@testable import TaskNotesKit

struct FacetCivilDateTests {
    @Test func taskDatesRemainGregorianWithNonGregorianPresentationCalendars() throws {
        let date = try #require(ISO8601DateFormatter().date(from: "2026-10-03T12:00:00Z"))
        let zone = try #require(TimeZone(identifier: "Asia/Bangkok"))
        let clock = SystemClock(timeZone: zone, instant: { date })
        var buddhist = Calendar(identifier: .buddhist)
        buddhist.timeZone = zone
        #expect(buddhist.component(.year, from: date) == 2569)
        #expect(clock.viewerCalendar().today == "2026-10-03")
        var hebrew = Calendar(identifier: .hebrew)
        hebrew.timeZone = zone
        #expect(hebrew.component(.year, from: date) != 2026)
        #expect(clock.localYmd(millis: clock.nowMillis()) == "2026-10-03")
    }
}
