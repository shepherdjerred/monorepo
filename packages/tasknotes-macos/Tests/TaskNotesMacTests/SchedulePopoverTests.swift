import Testing

internal import struct Foundation.Date

@testable import TaskNotesMac

@Suite("The scheduling popover")
struct SchedulePopoverTests {
    @Test("an existing date is installed before presentation and emits no selection")
    func existingDateIsInitialState() throws {
        let initial = SchedulePopover.initialDate(current: "2026-08-30")
        #expect(CivilDay.iso(of: initial) == "2026-08-30")
        #expect(SchedulePopover.changedDate(initial, from: "2026-08-30") == nil)
    }

    @Test("selecting the stored date is a no-op")
    func sameDateIsIgnored() throws {
        let same = try #require(CivilDay.date(of: "2026-08-30"))
        #expect(SchedulePopover.changedDate(same, from: "2026-08-30") == nil)
    }

    @Test("selecting another date emits that date exactly once per change")
    func anotherDateIsReturned() throws {
        let other = try #require(CivilDay.date(of: "2026-08-31"))
        #expect(SchedulePopover.changedDate(other, from: "2026-08-30") == "2026-08-31")
    }

    @Test("an invalid stored value leaves the picker on its supplied today")
    func invalidDateUsesPresentationDefault() throws {
        let today = try #require(CivilDay.date(of: "2026-09-01"))
        #expect(
            CivilDay.iso(of: SchedulePopover.initialDate(current: "not-a-date", now: today))
                == "2026-09-01"
        )
    }
}
