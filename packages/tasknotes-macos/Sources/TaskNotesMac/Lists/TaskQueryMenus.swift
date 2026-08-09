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

            Button("Clear Filters") { query.clearNarrowing() }
                .disabled(!query.isNarrowing)
                .accessibilityIdentifier(AccessibilityIdentifier.Query.clearFilters)
        } label: {
            // A filled glyph rather than a badge with a number: the core has
            // `FilterConfig::active_count`, documented in Rust as being for
            // exactly that badge, but it is not exported across the FFI — and
            // counting the dimensions again here would be a second opinion
            // about what "filtered" means, sitting next to `taskFilterIsActive`.
            // Fill says the one thing that is knowable without guessing.
            Label(
                "Filter",
                systemImage: query.isFiltered
                    ? "line.3.horizontal.decrease.circle.fill"
                    : "line.3.horizontal.decrease.circle"
            )
        }
        .help("Filter")
        .accessibilityIdentifier(AccessibilityIdentifier.Query.filterMenu)
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

    /// The three the core actually sorts on, in the core's own order.
    static let sorted: [SortChoice] = [.by(.dueDate), .by(.priority), .by(.title)]

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
        case .by(.dueDate): "Due Date"
        case .by(.priority): "Priority"
        case .by(.title): "Title"
        }
    }

    var identifier: String {
        switch self {
        case .synced: "synced"
        case .by(.dueDate): "dueDate"
        case .by(.priority): "priority"
        case .by(.title): "title"
        }
    }
}
