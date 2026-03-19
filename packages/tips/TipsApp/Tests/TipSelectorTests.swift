import Foundation
import Testing
@testable import TipsApp

struct TipSelectorTests {
    // MARK: Internal

    @Test
    func `due tips selected before unseen`() throws {
        let tips = [makeTip(id: "a"), makeTip(id: "b")]
        let states: [String: TipState] = [
            "a": TipState(status: .showAgain, showAgainDate: "2025-01-01")
        ]

        let result = try TipSelector.selectNext(
            from: tips, states: states, today: self.makeDate("2025-01-02")
        )

        #expect(result?.id == "a")
    }

    @Test
    func `unseen tips selected before future`() throws {
        let tips = [makeTip(id: "a"), makeTip(id: "b")]
        let states: [String: TipState] = [
            "a": TipState(status: .showAgain, showAgainDate: "2025-12-01")
        ]

        let result = try TipSelector.selectNext(
            from: tips, states: states, today: self.makeDate("2025-01-02")
        )

        #expect(result?.id == "b")
    }

    @Test
    func `learned tips excluded`() throws {
        let tips = [makeTip(id: "a"), makeTip(id: "b")]
        let states: [String: TipState] = [
            "a": TipState(status: .learned)
        ]

        let result = try TipSelector.selectNext(
            from: tips, states: states, today: self.makeDate("2025-01-02")
        )

        #expect(result?.id == "b")
    }

    @Test
    func `all learned returns nil`() throws {
        let tips = [makeTip(id: "a")]
        let states: [String: TipState] = [
            "a": TipState(status: .learned)
        ]

        let result = try TipSelector.selectNext(
            from: tips, states: states, today: self.makeDate("2025-01-02")
        )

        #expect(result == nil)
    }

    @Test
    func `excludes current tip id`() throws {
        let tips = [makeTip(id: "a"), makeTip(id: "b")]
        let states: [String: TipState] = [:]

        let result = try TipSelector.selectNext(
            from: tips, states: states, excludingId: "a", today: self.makeDate("2025-01-02")
        )

        #expect(result?.id == "b")
    }

    @Test
    func `empty tips returns nil`() throws {
        let result = try TipSelector.selectNext(
            from: [], states: [:], today: self.makeDate("2025-01-02")
        )

        #expect(result == nil)
    }

    @Test
    func `multiple due sorted by oldest`() throws {
        let tips = [makeTip(id: "a"), makeTip(id: "b")]
        let states: [String: TipState] = [
            "a": TipState(status: .showAgain, showAgainDate: "2025-01-05"),
            "b": TipState(status: .showAgain, showAgainDate: "2025-01-02")
        ]

        let result = try TipSelector.selectNext(
            from: tips, states: states, today: self.makeDate("2025-01-10")
        )

        #expect(result?.id == "b")
    }

    @Test
    func `future tips selected by nearest date`() throws {
        let tips = [makeTip(id: "a"), makeTip(id: "b")]
        let states: [String: TipState] = [
            "a": TipState(status: .showAgain, showAgainDate: "2025-03-01"),
            "b": TipState(status: .showAgain, showAgainDate: "2025-02-01")
        ]

        let result = try TipSelector.selectNext(
            from: tips, states: states, today: self.makeDate("2025-01-10")
        )

        #expect(result?.id == "b")
    }

    @Test
    func `cooldown doubles with count`() throws {
        let base = try makeDate("2025-01-01")

        #expect(TipSelector.nextShowAgainDate(count: 0, from: base) == "2025-01-04") // +3 days
        #expect(TipSelector.nextShowAgainDate(count: 1, from: base) == "2025-01-07") // +6 days
        #expect(TipSelector.nextShowAgainDate(count: 2, from: base) == "2025-01-13") // +12 days
        #expect(TipSelector.nextShowAgainDate(count: 3, from: base) == "2025-01-25") // +24 days
        #expect(TipSelector.nextShowAgainDate(count: 4, from: base) == "2025-01-31") // capped at +30
    }

    // MARK: Private

    // MARK: - Helpers

    private func makeTip(id: String) -> FlatTip {
        FlatTip(
            id: id,
            appName: "Test",
            appIcon: "star",
            appColor: .blue,
            appWebsite: nil,
            category: "General",
            text: "Tip \(id)",
            shortcut: nil
        )
    }

    private func makeDate(_ string: String) throws -> Date {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return try #require(formatter.date(from: string))
    }
}
