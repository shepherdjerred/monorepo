import Foundation
import TaskNotesKit
import TaskNotesTestSupport
import Testing

@Suite("Facet Quick Capture, Recurrence, Filter Queries, Markdown & Host Primitives")
struct FacetParsersAndHostTests {
    @Test(
        "FacetQuickCaptureParser extracts date, time, recurrence, project, section, label, and priority"
    )
    func quickCaptureParserTokens() throws {
        let fixedNow = try #require(ViewerCalendar.parseISO8601("2026-06-15T08:00:00Z"))
        let calendar = ViewerCalendar(today: "2026-06-15", timeZone: .gmt, instant: fixedNow)
        let taxonomy = Self.sampleTaxonomy()

        let parsed = FacetQuickCaptureParser.parse(
            "Deploy sync worker tomorrow 9am #Work/Sprint @backend @newtag p1 every weekday",
            projects: [taxonomy.project],
            sections: [taxonomy.section],
            labels: [taxonomy.label],
            defaultProjectId: "inbox",
            calendar: calendar
        )

        #expect(parsed.title == "Deploy sync worker")
        #expect(parsed.projectId == "proj-work")
        #expect(parsed.sectionId == "sec-sprint")
        #expect(parsed.priority == .p1)
        #expect(parsed.dueDate == "2026-06-16")
        #expect(parsed.dueDatetime?.hasPrefix("2026-06-16T09:00") == true)
        #expect(parsed.recurrenceRule == "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")
        #expect(parsed.labelIds == ["lbl-backend"])
        #expect(parsed.unmatchedLabels == ["newtag"])
        #expect(parsed.chips.count >= 5)
    }

    @Test(
        "FacetRecurrenceCodec parses, summarizes, and advances RFC 5545 RRULEs including COUNT exhaustion"
    )
    func recurrenceCodecRoundTripAndCount() throws {
        let draft = try #require(
            FacetRecurrenceCodec.parse("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=2")
        )
        #expect(draft.frequency == .weekly)
        #expect(draft.interval == 2)
        #expect(draft.byDay.map(\.weekday) == [.monday, .thursday])
        #expect(draft.end == .count(2))
        #expect(FacetRecurrenceCodec.summary(for: draft).contains("Every 2 weeks"))

        let ref = try #require(ViewerCalendar.parseISO8601("2026-06-15T10:00:00Z"))
        let firstStep = FacetRecurrenceCodec.nextOccurrence(
            rule: draft.rruleString,
            dueDate: "2026-06-15",
            dueDatetime: nil,
            referenceDate: ref
        )
        guard case .advanced(let nextDate, let decrementedRule) = firstStep else {
            Issue.record("Expected advanced occurrence")
            return
        }
        #expect(ViewerCalendar.civilDateString(for: nextDate, timeZone: .gmt) == "2026-06-18")
        #expect(decrementedRule.contains("COUNT=1"))

        let finalStep = FacetRecurrenceCodec.nextOccurrence(
            rule: decrementedRule,
            dueDate: "2026-06-18",
            dueDatetime: nil,
            referenceDate: nextDate
        )
        #expect(finalStep == .ended)
    }

    @Test(
        "FacetFilterQueryEvaluator supports conjunctions, unions, priorities, projects, labels, and due clauses"
    )
    func filterQueryEvaluation() throws {
        let fixedNow = try #require(ViewerCalendar.parseISO8601("2026-06-15T08:00:00Z"))
        let calendar = ViewerCalendar(today: "2026-06-15", timeZone: .gmt, instant: fixedNow)
        let fixture = Self.sampleFilterFixture()

        let matches = FacetFilterQueryEvaluator.filterTasks(
            fixture.tasks,
            query: "(p1 & today & #Ops) | @oncall",
            projects: [fixture.project],
            sections: [],
            labels: [fixture.label],
            calendar: calendar
        )
        #expect(matches.map(\.id) == ["t1", "t2"])

        let noDateOnly = FacetFilterQueryEvaluator.filterTasks(
            fixture.tasks,
            query: "no date",
            projects: [fixture.project],
            sections: [],
            labels: [fixture.label],
            calendar: calendar
        )
        #expect(noDateOnly.map(\.id) == ["t2"])
    }

    @Test(
        "MarkdownBody, TaskNotesURL, FacetIntentQueue, FacetWidgetProjection, and bundled contracts validate"
    )
    func hostPrimitivesAndContracts() throws {
        let markdown = try MarkdownBody.of(
            source: "# Heading\n\nParagraph with `code`.\n\n- First\n- Second\n\n> Quoted note"
        )
        #expect(markdown.blocks.count >= 5)

        let projectLink = TaskNotesURL(.destination(.project(id: "proj-42"))).url
        #expect(TaskNotesURL(projectLink)?.target == .destination(.project(id: "proj-42")))
        let quickAddLink = try #require(URL(string: "tasknotes://quick-add"))
        #expect(TaskNotesURL(quickAddLink)?.target == .action(.quickAdd))

        let scratch = try TemporaryDirectory()
        let queue = try FacetIntentQueue(directory: scratch.url.appending(path: "intents"))
        let queued = try queue.enqueue(title: "Pick up dry cleaning tomorrow")
        #expect(try queue.pending().map(\.id) == [queued.id])
        try queue.acknowledge(id: queued.id)
        #expect(try queue.pending().isEmpty)

        let config = FacetServerConfiguration(
            suiteName: "red.sjer.facet.tests.\(UUID().uuidString)"
        )
        #expect(config.baseURLString() == "https://tasknotes.tailnet-1a49.ts.net")
        #expect(throws: FacetServerConfigError.self) {
            _ = try FacetServerConfiguration.parseBaseURL("ftp://example.com")
        }

        #expect(FacetPresentationTokens.shared.schemaVersion == 1)
        #expect(FacetColorPolicy.shared.schemaVersion == 1)
        #expect(FacetFeedbackPolicy.shared.events["completed"]?.sound == "complete")
    }
}

extension FacetParsersAndHostTests {
    fileprivate struct SampleTaxonomy {
        let project: Project
        let section: Section
        let label: Label
    }

    fileprivate struct SampleFilterFixture {
        let project: Project
        let label: Label
        let tasks: [Task]
    }

    fileprivate static func sampleTaxonomy() -> SampleTaxonomy {
        SampleTaxonomy(
            project: Project(
                id: "proj-work",
                user_id: "user-1",
                name: "Work",
                color: "blue",
                parent_id: nil,
                child_order: 1,
                is_inbox: false,
                is_favorite: true,
                is_archived: false,
                is_deleted: false,
                created_at: "2026-06-01T00:00:00Z",
                updated_at: "2026-06-01T00:00:00Z"
            ),
            section: Section(
                id: "sec-sprint",
                project_id: "proj-work",
                user_id: "user-1",
                name: "Sprint",
                section_order: 1,
                is_archived: false,
                is_deleted: false,
                created_at: "2026-06-01T00:00:00Z",
                updated_at: "2026-06-01T00:00:00Z"
            ),
            label: Label(
                id: "lbl-backend",
                user_id: "user-1",
                name: "backend",
                color: "teal",
                item_order: 1,
                is_favorite: false,
                is_deleted: false
            )
        )
    }

    fileprivate static func sampleFilterFixture() -> SampleFilterFixture {
        SampleFilterFixture(
            project: Project(
                id: "proj-ops",
                user_id: "u1",
                name: "Ops",
                color: "red",
                parent_id: nil,
                child_order: 1,
                is_inbox: false,
                is_favorite: false,
                is_archived: false,
                is_deleted: false,
                created_at: "",
                updated_at: ""
            ),
            label: Label(
                id: "lbl-oncall",
                user_id: "u1",
                name: "oncall",
                color: "orange",
                item_order: 1,
                is_favorite: false,
                is_deleted: false
            ),
            tasks: [
                makeSampleTask(
                    id: "t1",
                    projectId: "proj-ops",
                    title: "Rotate certificates",
                    priority: .p1,
                    dueDate: "2026-06-15"
                ),
                makeSampleTask(
                    id: "t2",
                    projectId: "inbox",
                    title: "Check alert rules",
                    priority: .p3,
                    labelIds: ["lbl-oncall"]
                ),
            ]
        )
    }

    private static func makeSampleTask(
        id: String,
        projectId: String,
        title: String,
        priority: Priority,
        dueDate: String? = nil,
        labelIds: [String] = []
    ) -> Task {
        Task(
            id: id,
            user_id: "u1",
            project_id: projectId,
            section_id: nil,
            parent_id: nil,
            title: title,
            description: "",
            priority: priority,
            child_order: 1,
            due_date: dueDate,
            due_datetime: nil,
            due_timezone: nil,
            due_string: nil,
            is_recurring: false,
            recurrence_rule: nil,
            label_ids: labelIds,
            completed: false,
            completed_at: nil,
            is_deleted: false,
            created_at: "",
            updated_at: ""
        )
    }
}
