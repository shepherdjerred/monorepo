public import TaskNotesUniFFI

/// What a list screen shows, derived from one store snapshot.
///
/// One type for Today, Inbox, Upcoming and Browse. ``SidebarSection`` supplies
/// the four things that differ — the membership rule, the grouping, the
/// starting sort, and the words — and everything else below is shared. See
/// `TaskListShape.swift` for why the screens are configurations rather than
/// four near-identical implementations.
///
/// ## The pipeline, and why the steps are in this order
///
/// 1. **Membership** — the screen's own predicate, entirely core calls.
/// 2. **Facets** — the projects, contexts and tags the filter menu can offer,
///    taken from what the screen admitted rather than from the whole vault, so
///    the menu never offers a value that would empty the list.
/// 3. **Search** — narrow to what the user typed.
/// 4. **Filter** — `taskFilterApply`, the core's.
/// 5. **Sort** — `taskSortApply`, the core's, and only when the screen or the
///    user asked for one.
/// 6. **Rows and groups** — derivation and presentation.
///
/// Facets are computed at step 2 rather than step 5 on purpose: a filter menu
/// that only offered values surviving the *current* filter would remove each
/// option as it was chosen, so a two-project filter would be unreachable.
///
/// ## Order is never invented
///
/// With no sort configured the rows come out in exactly the order the core
/// produced them. That order is the user's — the core carries it in an
/// `IndexMap` and it crosses the FFI as an ordered `Vec` — and a tidying sort
/// on this side would silently override it on every screen at once. Sorting
/// happens only through `taskSortApply`, and only when something asked.
public struct TaskListModel: Sendable, Equatable {
    /// Which screen this is.
    public let section: SidebarSection

    /// The calendar every row below was derived against.
    ///
    /// Carried rather than re-read so the heading, the buckets, and the
    /// completion targets are all answers about the same instant.
    public let calendar: ViewerCalendar

    /// The screen's title line.
    ///
    /// `Wednesday, July 22` on Today, where the day *is* the subject; the
    /// destination's own name everywhere else.
    public let heading: String

    /// The rows, grouped as the screen groups them.
    ///
    /// Always at least one group for a non-empty list. Ungrouped screens
    /// produce exactly one, with no heading.
    public let groups: [TaskListGroup]

    /// Every row, flattened, in the order they are drawn.
    ///
    /// The selection, the menu-bar commands and the inspector all work in row
    /// terms and none of them care about grouping.
    public let rows: [TaskRowState]

    /// What the filter menu can offer, drawn from the screen's own corpus.
    public let facets: TaskListFacets

    /// The query the rows were narrowed by.
    public let query: TaskListQuery

    /// What narrowed the corpus *before* the reader's own query, when
    /// something did.
    ///
    /// This is how the project, context, tag and saved-view screens exist
    /// without being screens: they are this list, over a corpus one
    /// `apply_filter` call smaller, under a different heading. Nothing else
    /// about them differs, which is why adding them cost one optional
    /// parameter rather than three near-copies of this file.
    ///
    /// It is applied at the very top of the pipeline — before membership,
    /// before facets — so `admittedCount` counts within the scope and the
    /// filter menu offers only values that exist inside it.
    public let scope: TaskListScope?

    /// How many tasks the screen admitted before searching and filtering.
    ///
    /// The difference between this and `rows.count` is what makes an empty list
    /// legible: "no tasks here" and "your filter matched none of the 34 tasks
    /// here" are different news, and a screen that says the first when it means
    /// the second sends the reader looking for missing data.
    public let admittedCount: Int

    /// `No tasks` / `1 task` / `7 tasks` — the count beside the heading.
    ///
    /// The React Native app's exact wording, because it is the same product.
    public var countLabel: String {
        switch rows.count {
        case 0: "No tasks"
        case 1: "1 task"
        case let count: "\(count) tasks"
        }
    }

    public var isEmpty: Bool { rows.isEmpty }

    /// Whether anything was narrowed away — which is the only reason an empty
    /// screen might not be an empty screen.
    public var isNarrowed: Bool { query.isNarrowing }

    /// Derive a screen from a snapshot.
    ///
    /// - Parameters:
    ///   - section: which screen.
    ///   - tasks: `TaskNotesStore.tasks`, in the core's order.
    ///   - pendingTaskIds: `TaskNotesStore.pendingTaskIds`.
    ///   - calendar: where and when the viewer is.
    ///   - query: the search, filter and sort the user has applied.
    ///   - text: the locale formatter; injected so a test can pin a locale.
    ///   - scope: a narrowing applied *before* everything else, or `nil` for the
    ///     section's whole corpus. This is what makes the project, context, tag
    ///     and saved-view screens configurations of this list rather than
    ///     screens of their own.
    /// - Returns: the screen, with its rows grouped and ordered as it draws
    ///   them.
    /// - Throws: `CoreError` when the core rejects the viewer's calendar or one
    ///   of the tasks' own stored values.
    public static func build(
        section: SidebarSection,
        tasks: [CoreTask],
        pendingTaskIds: [TaskId],
        calendar: ViewerCalendar,
        query: TaskListQuery = TaskListQuery(),
        text: TaskDateText = TaskDateText(),
        scope: TaskListScope? = nil
    ) throws(CoreError) -> TaskListModel {
        // Step zero, above membership: a scoped screen is this screen over a
        // smaller corpus. Applied here rather than beside the reader's own
        // filter so that `admittedCount` counts within the scope and the filter
        // menu offers only values the scope actually contains — the same reason
        // facets are taken from what the *screen* admitted rather than from the
        // vault.
        let corpus = scope?.narrow(tasks) ?? tasks

        var admitted: [CoreTask] = []
        // The occurrence each row is about, for the screens that answer that
        // question. Kept beside the list rather than inside it because the core
        // filter and sort take and return plain tasks, so anything travelling
        // with a task has to survive a round trip through them by id.
        var occurrences: [TaskId: String] = [:]
        for task in corpus {
            switch try section.admits(task, calendar: calendar) {
            case .excluded:
                continue
            case .included(let about):
                admitted.append(task)
                if let about { occurrences[task.id] = about }
            }
        }

        let available = TaskListFacets(of: admitted)
        let ordered = try narrowed(admitted, by: query, calendar: calendar)
        let derived = try rows(
            of: ordered,
            pendingTaskIds: pendingTaskIds,
            occurrences: occurrences,
            calendar: calendar,
            text: text
        )
        let grouped =
            section.isGrouped ? try TaskListGroup.byDay(derived) : TaskListGroup.flat(derived)

        // Spelled out rather than `scope?.title ?? try …`: a `??` whose
        // right-hand side throws widens the whole expression's thrown type back
        // to `any Error`, which no longer converts to this function's
        // `throws(CoreError)`. Same trap, same fix, as `TaskRowState`'s
        // occurrence branch.
        let screenTitle: String
        if let scoping = scope {
            screenTitle = scoping.title
        } else {
            screenTitle = try section.heading(on: calendar, text: text)
        }
        return TaskListModel(
            section: section,
            calendar: calendar,
            // A scope names the screen. "Website" rather than "Browse" is the
            // whole visible difference between a project screen and the corpus
            // it is a slice of, and putting it here keeps the model and the
            // window title reading off one value.
            heading: screenTitle,
            groups: grouped,
            // Flattened *from the groups*, not from the pass above: grouping
            // reorders, and a selection or a menu-bar command built against
            // one order acting on the other is how a "complete the selection"
            // ends up completing the wrong rows.
            rows: grouped.flatMap(\.rows),
            facets: available,
            query: query,
            scope: scope,
            admittedCount: admitted.count
        )
    }

    /// Search, filter and sort, all of them the core's.
    ///
    /// Search and filter are **one** step, because the core made search a
    /// dimension of `FilterConfig` rather than something a shell bolts on. The
    /// Swift substring matcher this replaced was the one piece of genuine core
    /// logic left in this target, and it is gone.
    ///
    /// - Throws: `CoreError` when the core refuses the sort.
    private static func narrowed(
        _ admitted: [CoreTask],
        by query: TaskListQuery,
        calendar: ViewerCalendar
    ) throws(CoreError) -> [CoreTask] {
        // Skipped when nothing is filtered, because `taskFilterApply` copies
        // every task across the FFI and the common case is an inactive filter.
        // `taskFilterIsActive` is the core's own predicate, so "nothing is
        // filtered" is not a judgement made here.
        let filtered =
            taskFilterIsActive(filter: query.filter)
            ? taskFilterApply(tasks: admitted, filter: query.filter)
            : admitted
        guard let sort = query.sort else { return filtered }
        // `today` is passed because `SortField.effectiveDate` consults it to
        // expand a recurrence rule. The core is explicit that `nil` is not a
        // fallback but a statement of fact — "nobody told this call what day it
        // is" — under which a rule-only task sorts as undated. A screen that
        // already holds a `ViewerCalendar` has no business saying that.
        return try CoreErrors.rethrowingCore("sorting the list") {
            try taskSortApply(tasks: filtered, sort: sort, today: calendar.today)
        }
    }

    /// Derive a row per task, in the order given.
    ///
    /// - Throws: `CoreError` when the core rejects one of the tasks' own stored
    ///   values.
    private static func rows(
        of ordered: [CoreTask],
        pendingTaskIds: [TaskId],
        occurrences: [TaskId: String],
        calendar: ViewerCalendar,
        text: TaskDateText
    ) throws(CoreError) -> [TaskRowState] {
        // A set, because `pendingTaskIds` is scanned once per surviving task
        // and a linear search would make a large vault quadratic on every
        // keystroke that redraws the list.
        let pending = Set(pendingTaskIds)
        var derived: [TaskRowState] = []
        derived.reserveCapacity(ordered.count)
        for task in ordered {
            derived.append(
                try TaskRowState(
                    task: task,
                    isPending: pending.contains(task.id),
                    calendar: calendar,
                    text: text,
                    about: occurrences[task.id]
                )
            )
        }
        return derived
    }

    /// ``build(section:tasks:pendingTaskIds:calendar:query:text:)``, as a
    /// `Result`.
    ///
    /// A SwiftUI `body` cannot `try`, and a helper that wraps the throwing call
    /// at the call site does not compile: a closure written inside a
    /// `@MainActor` view infers `any Error` as its thrown type, which no longer
    /// converts to the `throws(CoreError)` parameter. Doing the conversion here,
    /// inside the module where isolation is uniform, keeps the typed error all
    /// the way to the view — which is the whole reason it is typed.
    public static func of(
        section: SidebarSection,
        tasks: [CoreTask],
        pendingTaskIds: [TaskId],
        calendar: ViewerCalendar,
        query: TaskListQuery = TaskListQuery(),
        text: TaskDateText = TaskDateText(),
        scope: TaskListScope? = nil
    ) -> Result<TaskListModel, CoreError> {
        CoreErrors.capturing { () throws(CoreError) -> TaskListModel in
            try build(
                section: section,
                tasks: tasks,
                pendingTaskIds: pendingTaskIds,
                calendar: calendar,
                query: query,
                text: text,
                scope: scope
            )
        }
    }
}

/// One run of rows under one heading.
public struct TaskListGroup: Sendable, Equatable, Identifiable {
    /// The heading, or `nil` on a screen that does not group.
    ///
    /// `nil` rather than an empty string: "this list has no headings" and "this
    /// heading is blank" are different, and only the first is a state this app
    /// has.
    public let heading: String?

    public let rows: [TaskRowState]

    /// The earliest date in the group, as `YYYY-MM-DD`, for a grouped screen.
    let earliest: String?

    public var id: String { heading ?? "" }

    /// The whole list as one unheaded group.
    static func flat(_ rows: [TaskRowState]) -> [TaskListGroup] {
        rows.isEmpty ? [] : [TaskListGroup(heading: nil, rows: rows, earliest: nil)]
    }

    /// The list split under the headings the core's `dateGroup` names.
    ///
    /// This is `getDateGroup` in the React Native app, verbatim: the near
    /// buckets get the core's own words — `Tomorrow`, `This Week` — and
    /// anything beyond the current week is headed by its own date, which is why
    /// `dateGroupHeading` answers `nil` for exactly that one case. So a far-off
    /// agenda reads as a run of days rather than as one undifferentiated
    /// "Later".
    ///
    /// Groups are ordered by their earliest date. Ordering them by the bucket
    /// enum instead would mean restating in Swift the order the core already
    /// declares, and ISO 8601 dates compare lexicographically *because* that is
    /// what the format is for — no calendar arithmetic happens here.
    ///
    /// - Throws: `CoreError` when a row on a grouped screen has no date. That
    ///   is unreachable by construction — Upcoming admits a task only by a date
    ///   it just resolved — so it means the membership rule and the badge
    ///   disagree, which is worth stopping for rather than filing under an
    ///   invented "No Date" heading.
    static func byDay(_ ungrouped: [TaskRowState]) throws(CoreError) -> [TaskListGroup] {
        // Built as an array of groups rather than a dictionary keyed by
        // heading: a dictionary would have to be re-ordered afterwards anyway,
        // and the number of headings on one screen is small enough that a
        // linear scan per row is cheaper than hashing every one of them.
        var built: [TaskListGroup] = []

        for row in ungrouped {
            guard let date = row.displayDate else {
                throw CoreError.Invariant(
                    message: "\(row.id) reached a grouped list with no date to group it under"
                )
            }
            let label = dateGroupHeading(group: date.group) ?? date.text
            guard let index = built.firstIndex(where: { $0.heading == label }) else {
                built.append(
                    TaskListGroup(heading: label, rows: [row], earliest: date.date))
                continue
            }
            built[index] = built[index].adding(row, on: date.date)
        }

        return built.sorted { left, right in
            (left.earliest ?? "") < (right.earliest ?? "")
        }
    }

    /// This group with one more row in it, and the earlier of the two dates.
    private func adding(_ row: TaskRowState, on date: String) -> TaskListGroup {
        TaskListGroup(
            heading: heading,
            rows: rows + [row],
            earliest: (earliest.map { min($0, date) }) ?? date
        )
    }
}
