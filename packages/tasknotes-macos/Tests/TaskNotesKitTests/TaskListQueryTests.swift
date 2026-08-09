import Foundation
import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

/// The other three screens' membership rules, which are the only thing that
/// distinguishes them from Today.
///
/// One corpus for all three, deliberately: the four screens are partitions of
/// one vault, and asserting each against its own hand-built fixture would let
/// two of them claim the same task without anything noticing.
@Suite("List membership")
struct TaskListMembershipTests {
    /// 2026-07-22 is a Wednesday, so "this week" runs through Sunday the 26th.
    private static let corpus: [CoreTask] = [
        coreTask(id: "overdue.md", due: "2026-07-01"),
        coreTask(id: "due-today.md", due: "2026-07-22"),
        coreTask(id: "due-tomorrow.md", due: "2026-07-23"),
        coreTask(id: "due-this-week.md", due: "2026-07-24"),
        coreTask(id: "due-later.md", due: "2026-08-14"),
        coreTask(id: "untriaged.md"),
        coreTask(id: "has-project.md", projects: ["[[Work]]"]),
        coreTask(id: "has-context.md", contexts: ["home"]),
        coreTask(id: "finished.md", status: .done, due: "2026-07-22"),
        coreTask(id: "cancelled-undated.md", status: .cancelled),
        coreTask(id: "archived.md", due: "2026-07-22", archived: true),
        coreTask(id: "daily.md", scheduled: "2026-07-22", recurrence: "FREQ=DAILY"),
        coreTask(id: "friday.md", scheduled: "2026-07-24", recurrence: "FREQ=WEEKLY;BYDAY=FR"),
    ]

    private func ids(_ section: SidebarSection) throws -> [TaskId] {
        try TaskListModel.build(
            section: section,
            tasks: Self.corpus,
            pendingTaskIds: [],
            calendar: fixedCalendar(),
            text: fixedText()
        ).rows.map(\.id)
    }

    @Test("Inbox is what has no organizing metadata at all")
    func inboxIsUntriagedWork() throws {
        // ⚠️ Stricter than the React Native screen, which tests only
        // `projects.length === 0` and so files a fully-scheduled, contexted,
        // repeating task under "needs triage". Inbox is worth having only if
        // reaching zero means something.
        #expect(try ids(.inbox) == ["untriaged.md"])
    }

    @Test("Upcoming is strictly ahead of today, and never today itself")
    func upcomingExcludesTodayAndThePast() throws {
        // `daily.md` is absent on purpose: its next uncompleted occurrence is
        // *today*, so it belongs on Today. `friday.md` is present at the 24th,
        // which is the occurrence Upcoming is showing it for — and it sits
        // between the 24th and the 14th of August rather than at the end,
        // because on a grouped screen the flattened rows follow the *day
        // headings*, not the order the tasks arrived in.
        #expect(
            try ids(.upcoming) == [
                "due-tomorrow.md", "due-this-week.md", "friday.md", "due-later.md",
            ])
    }

    @Test("Upcoming groups by the core's own buckets, in date order")
    func upcomingGroupsReadAsDays() throws {
        let model = try TaskListModel.build(
            section: .upcoming,
            tasks: Self.corpus,
            pendingTaskIds: [],
            calendar: fixedCalendar(),
            text: fixedText()
        )

        // `Tomorrow` and `This Week` are the core's own heading strings;
        // `Aug 14` is the one bucket `dateGroupHeading` deliberately leaves to
        // the shell, and it is a formatted date rather than the word "Later".
        #expect(model.groups.map(\.heading) == ["Tomorrow", "This Week", "Aug 14"])
        #expect(model.groups.map { $0.rows.count } == [1, 2, 1])
        // The flattened rows follow the groups, so a selection built from one
        // matches the other.
        #expect(model.rows.map(\.id) == model.groups.flatMap { $0.rows.map(\.id) })
    }

    @Test("a recurring row on Upcoming completes the occurrence it is showing")
    func upcomingCompletesWhatItDraws() throws {
        // The invariant the `about:` parameter exists for. A row printed under
        // "This Week" whose checkbox silently completed a past occurrence is
        // the drawn-versus-acted disagreement the row design forbids.
        let model = try TaskListModel.build(
            section: .upcoming,
            tasks: Self.corpus,
            pendingTaskIds: [],
            calendar: fixedCalendar(),
            text: fixedText()
        )
        let row = try #require(model.rows.first { $0.id == "friday.md" })

        #expect(row.completionTarget == "2026-07-24")
        #expect(row.displayDate?.date == "2026-07-24")
        guard case .setInstanceComplete(_, let date, let completed) = row.completionCommand else {
            Issue.record("expected a per-occurrence completion, got \(row.completionCommand)")
            return
        }
        #expect(date == "2026-07-24")
        #expect(completed)
    }

    @Test("Browse is everything the vault holds except what was archived")
    func browseIsTheWholeCorpus() throws {
        // Completed and cancelled tasks included: Browse is the only screen
        // where the status filter has anything to bite on, and a "browse
        // everything" list that hides two of six statuses is not browsing
        // everything. Archived is the one exclusion, and it is the plugin's.
        #expect(try ids(.browse) == Self.corpus.map(\.id).filter { $0 != "archived.md" })
    }

    @Test("each screen states how much of itself it is hiding")
    func theCountKnowsWhatWasNarrowedAway() throws {
        let model = try TaskListModel.build(
            section: .browse,
            tasks: Self.corpus,
            pendingTaskIds: [],
            calendar: fixedCalendar(),
            query: TaskListQuery(search: "due"),
            text: fixedText()
        )

        // Twelve of the thirteen fixtures reach Browse — only the archived one
        // does not — and five of those twelve are titled after a due date.
        #expect(model.admittedCount == 12)
        #expect(model.rows.count == 5)
        #expect(model.isNarrowed)
    }
}

/// Searching, filtering and sorting — the surface every list screen carries.
@Suite("List queries")
struct TaskListQueryTests {
    private static let corpus: [CoreTask] = [
        coreTask(
            id: "zulu.md", title: "Zulu", priority: .low, due: "2026-08-01",
            projects: ["[[Areas/Work|Work]]"], contexts: ["office"]),
        coreTask(
            id: "alpha.md", title: "Alpha", priority: .highest, due: "2026-07-25",
            projects: ["Work"]),
        coreTask(id: "mike.md", title: "Mike", status: .done, contexts: ["home"]),
    ]

    private func model(_ query: TaskListQuery) throws -> TaskListModel {
        try TaskListModel.build(
            section: .browse,
            tasks: Self.corpus,
            pendingTaskIds: [],
            calendar: fixedCalendar(),
            query: query,
            text: fixedText()
        )
    }

    @Test("an empty query leaves the core's own order untouched")
    func nothingIsSortedUntilSomethingAsks() throws {
        // `TaskListQuery()` has no sort, and that is a real answer rather than
        // a missing default: the core carries the vault's order in an
        // `IndexMap` and that order is the user's.
        #expect(try model(TaskListQuery()).rows.map(\.id) == ["zulu.md", "alpha.md", "mike.md"])
        // Browse is the one screen that starts sorted, matching the React
        // Native app's `DEFAULT_SORT`.
        #expect(SidebarSection.browse.defaultSort == SortConfig(field: .dueDate, direction: .asc))
        #expect(SidebarSection.today.defaultSort == nil)
    }

    @Test("sorting is the core's, including where it puts the undated")
    func sortingRoutesThroughTheCore() throws {
        let byDue = try model(
            TaskListQuery(sort: SortConfig(field: .dueDate, direction: .asc)))
        // Undated last — and last in *both* directions, which is the core's
        // deliberate asymmetry rather than something restated here.
        #expect(byDue.rows.map(\.id) == ["alpha.md", "zulu.md", "mike.md"])

        let byDueDescending = try model(
            TaskListQuery(sort: SortConfig(field: .dueDate, direction: .desc)))
        #expect(byDueDescending.rows.map(\.id) == ["zulu.md", "alpha.md", "mike.md"])

        let byPriority = try model(
            TaskListQuery(sort: SortConfig(field: .priority, direction: .asc)))
        #expect(byPriority.rows.first?.id == "alpha.md")
    }

    @Test("search reads the title, the projects, the contexts and the tags")
    func searchLooksWhereTheReferenceScreenLooks() throws {
        #expect(try model(TaskListQuery(search: "alph")).rows.map(\.id) == ["alpha.md"])
        #expect(try model(TaskListQuery(search: "OFFICE")).rows.map(\.id) == ["zulu.md"])
        // Projects are matched raw, so `Areas/` is reachable — going through
        // `projectDisplayName` would have made the folder half unsearchable.
        #expect(try model(TaskListQuery(search: "areas")).rows.map(\.id) == ["zulu.md"])
        #expect(try model(TaskListQuery(search: "   ")).rows.count == 3, "blank narrows nothing")
    }

    @Test("filtering is the core's, wikilink equivalence included")
    func filteringRoutesThroughTheCore() throws {
        // `[[Areas/Work|Work]]` and `Work` are the same project. That the
        // filter finds both is `projectMatches`, and it is exactly why the
        // facet list deduplicates on the canonical path rather than the string.
        var byProject = FilterConfig.unfiltered
        byProject.toggleProject("Work")
        #expect(
            try model(TaskListQuery(filter: byProject)).rows.map(\.id) == ["zulu.md", "alpha.md"])

        var byStatus = FilterConfig.unfiltered
        byStatus.toggleStatus(.done)
        #expect(try model(TaskListQuery(filter: byStatus)).rows.map(\.id) == ["mike.md"])

        // Toggling twice is off again, which is what a menu checkmark means.
        byStatus.toggleStatus(.done)
        #expect(byStatus.statuses.isEmpty)
        #expect(!TaskListQuery(filter: byStatus).isFiltered)
    }

    @Test("the facet menu offers one entry per project, not one per spelling")
    func facetsDeduplicateOnTheCanonicalPath() throws {
        let facets = try model(TaskListQuery()).facets
        #expect(facets.projects == ["Work"])
        #expect(facets.contexts == ["home", "office"])
    }

    @Test("facets come from the screen's corpus, not from what survived the filter")
    func facetsSurviveTheirOwnFilter() throws {
        // The trap this closes: a menu that only offered values present in the
        // *current* result would remove each option as it was chosen, so a
        // two-project filter would be unreachable and an empty result would
        // offer nothing at all to undo it.
        var onlyDone = FilterConfig.unfiltered
        onlyDone.toggleStatus(.done)
        let narrowed = try model(TaskListQuery(filter: onlyDone))

        #expect(narrowed.rows.map(\.id) == ["mike.md"])
        #expect(narrowed.facets.projects == ["Work"])
        #expect(narrowed.facets.contexts == ["home", "office"])
    }

    @Test("clearing drops the search and the filter but keeps the ordering")
    func clearingLeavesTheOrderAlone() {
        var query = TaskListQuery(
            search: "alpha",
            filter: .unfiltered,
            sort: SortConfig(field: .title, direction: .desc))
        query.filter.toggleStatus(.done)
        #expect(query.isNarrowing)

        query.clearNarrowing()

        #expect(!query.isNarrowing)
        #expect(query.search.isEmpty)
        #expect(query.sort == SortConfig(field: .title, direction: .desc))
    }
}
