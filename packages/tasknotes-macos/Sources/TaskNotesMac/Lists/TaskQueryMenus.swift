internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

/// The toolbar's filter menu.
///
/// The React Native `FilterSortBar` is a strip of chips above the list, which
/// spends a permanent row of vertical space on a control that is used rarely
/// and is empty most of the time. On a Mac the toolbar is where a view's
/// controls live, and a menu is where a set of infrequent toggles belongs — so
/// this is a toolbar menu, and the list starts at the top of the window.
///
/// **Nothing here decides what a filter means.** The dimensions are
/// `FilterConfig`'s, the status and priority vocabularies are
/// `taskStatusAll()` and `priorityAll()` with the core's own labels, the
/// projects/contexts/tags are the ones present in this screen's corpus, and
/// the predicate is `taskFilterApply`. This view only draws the checkmarks.
struct FilterMenu: View {
    @Binding var query: TaskListQuery
    let facets: TaskListFacets

    var body: some View {
        Menu {
            Menu("Status") {
                ForEach(taskStatusAll(), id: \.self) { status in
                    Toggle(
                        taskStatusLabel(status: status),
                        isOn: binding {
                            $0.toggleStatus(status)
                        } reading: {
                            $0.statuses.contains(status)
                        }
                    )
                    .accessibilityIdentifier(
                        AccessibilityIdentifier.Query.filterOption(
                            "status", taskStatusWireValue(status: status)))
                }
            }

            Menu("Priority") {
                ForEach(priorityAll(), id: \.self) { priority in
                    Toggle(
                        priorityLabel(priority: priority),
                        isOn: binding {
                            $0.togglePriority(priority)
                        } reading: {
                            $0.priorities.contains(priority)
                        }
                    )
                    .accessibilityIdentifier(
                        AccessibilityIdentifier.Query.filterOption(
                            "priority", priorityWireValue(priority: priority)))
                }
            }

            facetMenu("Project", values: facets.projects, dimension: "project") { name in
                binding {
                    $0.toggleProject(name)
                } reading: {
                    $0.projects.contains(name)
                }
            }
            facetMenu("Context", values: facets.contexts, dimension: "context", prefix: "@") {
                name in
                binding {
                    $0.toggleContext(name)
                } reading: {
                    $0.contexts.contains(name)
                }
            }
            facetMenu("Tag", values: facets.tags, dimension: "tag", prefix: "#") { name in
                binding {
                    $0.toggleTag(name)
                } reading: {
                    $0.tags.contains(name)
                }
            }

            Divider()

            Toggle(
                "No Due Date",
                isOn: binding {
                    $0.hasNoDueDate.toggle()
                } reading: {
                    $0.hasNoDueDate
                }
            )
            .accessibilityIdentifier(
                AccessibilityIdentifier.Query.filterOption("due", "none"))

            Divider()

            // Names both, because the badge counts both. A user who only
            // typed in the search box still sees `Filter (1)` — search is a
            // dimension of `FilterConfig` in the core, and the count is the
            // core's — so the one control that undoes it has to say so, or the
            // count looks like a bug and the remedy looks unrelated.
            Button("Clear Filters & Search") { query.clearNarrowing() }
                .disabled(!query.isNarrowing)
                .accessibilityIdentifier(AccessibilityIdentifier.Query.clearFilters)
        } label: {
            // Filled *and* counted. `FilterConfig::active_count` is the core's
            // own, so the number beside the funnel and the predicate that
            // empties the list cannot disagree about what "filtered" means —
            // and the fill is a second channel carrying the same fact, for
            // anyone who reads a glyph faster than a digit.
            Label(
                label,
                systemImage: query.isNarrowing
                    ? "line.3.horizontal.decrease.circle.fill"
                    : "line.3.horizontal.decrease.circle"
            )
        }
        // ⚠️ A SwiftUI `Menu` exposes no action equivalent to a click, so
        // `performAccessibilityAudit` reports it as unactionable — verified,
        // not assumed: these two were the only "action is missing" findings on
        // the Inbox screen, and the task and sidebar rows were never flagged.
        //
        // `.isButton` rather than an `.accessibilityAction`: the trait is the
        // true statement (this opens a menu when activated) and an added
        // action would be a second, divergent way to invoke what AppKit
        // already handles.
        .accessibilityAddTraits(.isButton)
        .help(label)
        .accessibilityIdentifier(AccessibilityIdentifier.Query.filterMenu)
    }

    /// `Filter`, or `Filter (3)` once something is set.
    ///
    /// The count is `FilterConfig::active_count`, which counts a non-empty
    /// search as a dimension. That is the right question answered: the badge
    /// exists to say *why this list is shorter than the vault*, and a `(0)`
    /// over a list that a search had emptied would be answering a different
    /// one. See the clear item for how the wording is kept honest.
    private var label: String {
        let count = query.activeFilterCount
        return count == 0 ? "Filter" : "Filter (\(count))"
    }

    /// One facet dimension, present and empty rather than absent.
    ///
    /// **Disabled, never hidden.** A vault with no contexts in it still has a
    /// Context menu, greyed out — a menu that changes shape as data arrives
    /// teaches nobody where a control lives, and the definition of done says so
    /// in as many words.
    @ViewBuilder
    private func facetMenu(
        _ title: String,
        values: [String],
        dimension: String,
        prefix: String = "",
        binding make: @escaping (String) -> Binding<Bool>
    ) -> some View {
        Menu(title) {
            ForEach(values, id: \.self) { value in
                Toggle("\(prefix)\(value)", isOn: make(value))
                    .accessibilityIdentifier(
                        AccessibilityIdentifier.Query.filterOption(dimension, value))
            }
        }
        .disabled(values.isEmpty)
    }

    /// A menu toggle over one dimension of the core's filter record.
    ///
    /// Spelled as a factory because `FilterConfig` is generated and has no
    /// `Bool` properties to bind to directly — every dimension is membership in
    /// a list, so "on" is a question and "flip it" is a mutation, and both have
    /// to be supplied.
    private func binding(
        writing mutate: @escaping (inout FilterConfig) -> Void,
        reading isOn: @escaping (FilterConfig) -> Bool
    ) -> Binding<Bool> {
        Binding(
            get: { isOn(query.filter) },
            set: { _ in mutate(&query.filter) }
        )
    }
}

/// The toolbar's sort menu.
///
/// Two independent choices — the key and the direction — rather than six
/// combined items, because that is what they are, and because the direction is
/// meaningless without a key. `Picker` in its inline style gives real menu-item
/// state, so the current order carries a checkmark instead of four identical
/// buttons.
struct SortMenu: View {
    @Binding var query: TaskListQuery

    var body: some View {
        Menu {
            Picker("Sort By", selection: field) {
                // ⚠️ **"As Synced" is a first-class choice, not the absence of
                // one.** The core carries the vault's own list order in an
                // `IndexMap` and that order is the user's; a screen that always
                // imposed a sort would make it unreachable. Three of the four
                // screens start here.
                Text("As Synced")
                    .tag(SortChoice.synced)
                    .accessibilityIdentifier(
                        AccessibilityIdentifier.Query.sortField("synced"))
                ForEach(SortChoice.sorted, id: \.self) { choice in
                    Text(choice.title)
                        .tag(choice)
                        .accessibilityIdentifier(
                            AccessibilityIdentifier.Query.sortField(choice.identifier))
                }
            }
            .pickerStyle(.inline)

            Picker("Order", selection: direction) {
                Text("Ascending")
                    .tag(SortDirection.asc)
                    .accessibilityIdentifier(
                        AccessibilityIdentifier.Query.sortDirection("asc"))
                Text("Descending")
                    .tag(SortDirection.desc)
                    .accessibilityIdentifier(
                        AccessibilityIdentifier.Query.sortDirection("desc"))
            }
            .pickerStyle(.inline)
            .disabled(query.sort == nil)
        } label: {
            Label("Sort", systemImage: "arrow.up.arrow.down")
        }
        // Same finding as the filter menu above; see the note there.
        .accessibilityAddTraits(.isButton)
        .help("Sort")
        .accessibilityIdentifier(AccessibilityIdentifier.Query.sortMenu)
    }

    private var field: Binding<SortChoice> {
        Binding(
            get: { SortChoice(query.sort?.field) },
            set: { choice in
                guard let chosen = choice.field else {
                    query.sort = nil
                    return
                }
                // The direction survives a change of key, which is what a user
                // who has just put the newest first expects when they switch
                // from due date to title.
                query.sort = SortConfig(
                    field: chosen, direction: query.sort?.direction ?? .asc)
            }
        )
    }

    private var direction: Binding<SortDirection> {
        Binding(
            get: { query.sort?.direction ?? .asc },
            set: { chosen in
                guard let sort = query.sort else { return }
                query.sort = SortConfig(field: sort.field, direction: chosen)
            }
        )
    }
}

/// The sort keys a menu offers, which is the core's three plus "don't".
///
/// A local enum rather than `SortField?` because `Picker` needs a `Hashable`
/// tag and an optional tag is a well-known source of silently-unselectable
/// items in SwiftUI.
enum SortChoice: Hashable, Sendable {
    case synced
    case by(SortField)

    /// The four the core sorts on, in the core's own order.
    static let sorted: [SortChoice] = [
        .by(.effectiveDate), .by(.dueDate), .by(.priority), .by(.title),
    ]

    init(_ field: SortField?) {
        self = field.map(SortChoice.by) ?? .synced
    }

    var field: SortField? {
        switch self {
        case .synced: nil
        case .by(let field): field
        }
    }

    /// The menu label.
    ///
    /// Written here rather than taken from the core, unlike the status and
    /// priority labels: `SortField` has no exported label function, and these
    /// three words name a *view control*, not a piece of vault data — nothing
    /// cross-platform depends on two clients calling it "Due Date".
    var title: String {
        switch self {
        case .synced: "As Synced"
        // Not "Effective Date", which names an implementation. What a reader
        // wants is the date the row *shows* — the core's key consults `due`,
        // `scheduled` and the recurrence rule precisely so that one column and
        // one sort agree.
        case .by(.effectiveDate): "Date"
        case .by(.dueDate): "Due Date"
        case .by(.priority): "Priority"
        case .by(.title): "Title"
        }
    }

    var identifier: String {
        switch self {
        case .synced: "synced"
        case .by(.effectiveDate): "effectiveDate"
        case .by(.dueDate): "dueDate"
        case .by(.priority): "priority"
        case .by(.title): "title"
        }
    }
}
