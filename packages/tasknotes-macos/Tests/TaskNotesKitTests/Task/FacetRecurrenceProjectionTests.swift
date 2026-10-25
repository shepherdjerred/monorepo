import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

@Suite("Standalone recurrence editor anchors")
struct FacetRecurrenceProjectionTests {
    @Test("new repeats retain the scheduled weekday", arguments: [nil, ""] as [String?])
    func newRuleUsesScheduledAnchor(rule: String?) throws {
        let projection = FacetRecurrenceProjection.load(
            rule: rule, scheduled: "2026-10-06", dateCreated: "2026-10-01T12:00:00Z",
            today: "2026-10-05")
        #expect(projection.hasResolvedStart)
        #expect(projection.start == "2026-10-06")
        #expect(projection.editableDraft != nil)
        #expect(projection.summary == nil)
        let weekly = try #require(
            recurrenceParseCommon(text: "FREQ=WEEKLY", start: projection.start))
        #expect(weekly.pattern == .weekly(weekdays: [.tuesday]))
    }

    @Test("new repeats retain the creation anchor", arguments: [nil, ""] as [String?])
    func newRuleUsesCreatedAnchor(scheduled: String?) throws {
        let projection = FacetRecurrenceProjection.load(
            rule: nil, scheduled: scheduled, dateCreated: "2026-10-08T12:00:00Z",
            today: "2026-10-05")
        #expect(projection.hasResolvedStart)
        #expect(projection.start == "2026-10-08")
        let weekly = try #require(
            recurrenceParseCommon(text: "FREQ=WEEKLY", start: projection.start))
        #expect(weekly.pattern == .weekly(weekdays: [.thursday]))
    }

    @Test("only missing new-rule anchors use the captured day", arguments: [nil, ""] as [String?])
    func newRuleWithoutAnchorsUsesToday(rule: String?) {
        let projection = FacetRecurrenceProjection.load(
            rule: rule, scheduled: "", dateCreated: "", today: "2026-10-05")
        #expect(projection.hasResolvedStart)
        #expect(projection.start == "2026-10-05")
        #expect(projection.editableDraft != nil)
    }

    @Test(
        "unreadable scheduled anchors remain unresolved",
        arguments: [nil, "", "FREQ=WEEKLY"] as [String?])
    func invalidScheduledAnchorStaysUnresolved(rule: String?) {
        let projection = FacetRecurrenceProjection.load(
            rule: rule, scheduled: "not-a-date", dateCreated: "2026-10-06T12:00:00Z",
            today: "2026-10-05")
        #expect(!projection.hasResolvedStart)
        #expect(projection.editableDraft == nil)
    }

    @Test("unreadable created anchors remain unresolved")
    func invalidCreatedAnchorStaysUnresolved() {
        let projection = FacetRecurrenceProjection.load(
            rule: nil, scheduled: nil, dateCreated: "not-a-date", today: "2026-10-05")
        #expect(!projection.hasResolvedStart)
        #expect(projection.editableDraft == nil)
    }

    @Test("an invalid captured day cannot create a draft")
    func invalidTodayStaysUnresolved() {
        let projection = FacetRecurrenceProjection.load(
            rule: nil, scheduled: nil, dateCreated: nil, today: "not-a-date")
        #expect(!projection.hasResolvedStart)
        #expect(projection.editableDraft == nil)
    }

    @Test("explicit DTSTART remains the core's effective start")
    func existingExplicitStartIsPreserved() throws {
        let projection = FacetRecurrenceProjection.load(
            rule: "DTSTART:20261007;FREQ=WEEKLY", scheduled: "2026-10-06",
            dateCreated: "2026-10-01T12:00:00Z", today: "2026-10-05")
        #expect(projection.hasResolvedStart)
        #expect(projection.start == "2026-10-07")
        #expect(projection.editableDraft == nil)
        let replacement = try recurrenceBuildCommon(
            draft: CommonRecurrenceDraft(
                interval: 1, pattern: .weekly(weekdays: [.wednesday]), ending: .never),
            start: projection.start)
        #expect(replacement == "FREQ=WEEKLY;BYDAY=WE")
        #expect(
            recurrenceResolvedStart(
                text: replacement, scheduled: "2026-10-06", dateCreated: nil) == "2026-10-06")
        let writesScheduled = FacetRecurrenceEdit.requiresScheduledWrite(
            storedScheduled: "2026-10-06", initialStart: projection.start,
            selectedStart: projection.start, startWasResolved: projection.hasResolvedStart,
            replacingUnsupported: true)
        #expect(writesScheduled)
        let applied = try FacetRecurrenceEdit.build(
            draft: FacetCommonRecurrenceDraft(
                interval: 1, pattern: .weekly(weekdays: [.wednesday]), ending: .never),
            start: projection.start, anchor: .scheduled, writesScheduled: writesScheduled
        ).get()
        #expect(applied.writesScheduled)
        #expect(
            recurrenceResolvedStart(
                text: applied.rule, scheduled: applied.start, dateCreated: nil) == "2026-10-07")
    }

    @Test("raw replacement retains a matching Scheduled date-time")
    func replacementPreservesMatchingScheduledTime() {
        let writesScheduled = FacetRecurrenceEdit.requiresScheduledWrite(
            storedScheduled: "2026-10-07T12:30:00Z", initialStart: "2026-10-07",
            selectedStart: "2026-10-07", startWasResolved: true, replacingUnsupported: true)
        #expect(!writesScheduled)
        #expect(
            !FacetRecurrenceEdit.requiresScheduledWrite(
                storedScheduled: "2026-10-06", initialStart: "2026-10-07",
                selectedStart: "2026-10-07", startWasResolved: true,
                replacingUnsupported: false))
    }

    @Test("explicit start correction writes the valid selected date")
    func unresolvedStartCorrectionWritesScheduled() {
        #expect(
            FacetRecurrenceEdit.requiresScheduledWrite(
                storedScheduled: "not-a-date", initialStart: "2026-10-05",
                selectedStart: "2026-10-05", startWasResolved: false,
                replacingUnsupported: false))
    }

    @Test("a new start writes missing Scheduled values", arguments: [nil, ""] as [String?])
    func missingScheduledIsWritten(storedScheduled: String?) {
        #expect(
            FacetRecurrenceEdit.requiresScheduledWrite(
                storedScheduled: storedScheduled, initialStart: "2026-10-05",
                selectedStart: "2026-10-05", startWasResolved: true,
                replacingUnsupported: false))
    }

    @Test("unsupported constraints keep the common draft absent")
    func unsupportedRuleStaysRaw() {
        let projection = FacetRecurrenceProjection.load(
            rule: "FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13", scheduled: "2026-10-06",
            dateCreated: "2026-10-01T12:00:00Z", today: "2026-10-05")
        #expect(projection.hasResolvedStart)
        #expect(projection.start == "2026-10-06")
        #expect(projection.editableDraft == nil)
    }
}
