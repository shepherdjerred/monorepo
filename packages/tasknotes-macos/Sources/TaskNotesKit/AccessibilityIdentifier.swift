/// Namespaced accessibility identifiers for every interactive element.
///
/// These live in `TaskNotesKit` on purpose: the SwiftUI layer and the XCUITest
/// target both import this module, so renaming an identifier is a compile error
/// in the UI test rather than a test that quietly stops finding its element and
/// then quietly stops asserting anything.
///
/// The namespace prefix keeps them distinguishable from AppKit-supplied
/// identifiers in accessibility inspectors and in `performAccessibilityAudit()`
/// output.
///
/// ⚠️ `.accessibilityIdentifier()` on a container pushes the identifier down
/// onto child text elements and leaves the container itself unidentified. Call
/// `.accessibilityElement(children: .combine)` first. This bites hardest on
/// list rows, which is most of what is below.
public enum AccessibilityIdentifier {
    private static let namespace = "red.sjer.tasknotes"

    /// The `NavigationSplitView` source list itself.
    public static let sidebar = "\(namespace).sidebar"

    /// A source-list row. One identifier per destination, derived from the enum
    /// so a new destination cannot ship without one.
    public static func sidebarItem(_ section: SidebarSection) -> String {
        "\(namespace).sidebar.\(section.rawValue)"
    }

    /// The detail pane for a destination.
    public static func detail(_ section: SidebarSection) -> String {
        "\(namespace).detail.\(section.rawValue)"
    }

    /// The Settings window's root.
    public static let settings = "\(namespace).settings"

    /// The Settings server-address field.
    public static let settingsServerURL = "\(namespace).settings.serverURL"

    /// The task list screens — Today, Inbox, Upcoming and Browse, which are one
    /// parameterized view and therefore one set of identifiers.
    ///
    /// ⚠️ Deliberately **not** namespaced per section. A UI test that had to
    /// know which of the four screens it was on to name the list would be
    /// asserting on the parameterization rather than on the behaviour, and the
    /// four screens are the same controls doing the same things. The section is
    /// already identified by ``AccessibilityIdentifier/detail(_:)``, which
    /// wraps the whole screen, so a test that genuinely cares can scope by it.
    public enum TaskList {
        /// The scrollable list of rows.
        public static let list = "\(namespace).tasklist"

        /// The day heading above the list.
        public static let heading = "\(namespace).tasklist.heading"

        /// A day heading inside a grouped list. Keyed by the heading's own
        /// words, which is what a test looking for "Tomorrow" already knows.
        public static func group(_ heading: String) -> String {
            "\(namespace).tasklist.group.\(heading)"
        }

        /// The toolbar's search field, scoped to the current list.
        public static let search = "\(namespace).tasklist.search"

        /// The task count beside the heading.
        public static let count = "\(namespace).tasklist.count"

        /// The empty state, in either of its two readings.
        public static let empty = "\(namespace).tasklist.empty"

        /// The inline compose field.
        public static let composeField = "\(namespace).tasklist.compose"

        /// The toolbar's new-task button.
        public static let newTask = "\(namespace).tasklist.newTask"

        /// The toolbar's refresh button.
        public static let refresh = "\(namespace).tasklist.refresh"

        /// A row. Keyed by task id, so a test asserts against the task it means
        /// rather than against a position that any completion can shift.
        public static func row(_ taskId: String) -> String {
            "\(namespace).tasklist.row.\(taskId)"
        }

        /// A row's completion control.
        public static func rowToggle(_ taskId: String) -> String {
            "\(namespace).tasklist.row.\(taskId).toggle"
        }

        /// A row's hover-revealed schedule control.
        public static func rowSchedule(_ taskId: String) -> String {
            "\(namespace).tasklist.row.\(taskId).schedule"
        }

        /// A row's hover-revealed delete control.
        public static func rowDelete(_ taskId: String) -> String {
            "\(namespace).tasklist.row.\(taskId).delete"
        }
    }

    /// The filter and sort surface, which every list screen carries.
    ///
    /// It is one surface rather than a Browse-only one because the React Native
    /// app already puts a `FilterSortBar` on Today, Inbox *and* Upcoming — the
    /// screens differ in what they admit, not in what can be done to what they
    /// admitted.
    public enum Query {
        /// The toolbar's filter menu.
        public static let filterMenu = "\(namespace).query.filter"

        /// One value inside the filter menu, keyed by dimension and value so a
        /// test names the option it means rather than a menu position.
        public static func filterOption(_ dimension: String, _ value: String) -> String {
            "\(namespace).query.filter.\(dimension).\(value)"
        }

        /// The item that drops every filter and the search at once.
        public static let clearFilters = "\(namespace).query.filter.clear"

        /// The toolbar's sort menu.
        public static let sortMenu = "\(namespace).query.sort"

        /// One sort order, keyed by field. `synced` is the unsorted choice.
        public static func sortField(_ field: String) -> String {
            "\(namespace).query.sort.\(field)"
        }

        /// One sort direction.
        public static func sortDirection(_ direction: String) -> String {
            "\(namespace).query.sort.direction.\(direction)"
        }
    }

    /// The connection banner and its controls.
    public enum SyncBanner {
        /// The banner itself, present only when there is something to say.
        public static let banner = "\(namespace).syncBanner"

        /// The banner's retry button, present only for a transient failure the
        /// user can usefully shortcut.
        public static let retry = "\(namespace).syncBanner.retry"

        /// The banner's Settings button, present only when sync cannot work
        /// until something is entered there.
        public static let openSettings = "\(namespace).syncBanner.openSettings"
    }

    /// The scheduling popover, anchored to the control that opened it.
    public enum Schedule {
        /// The popover's root.
        public static let popover = "\(namespace).schedule"

        /// One of the named shortcuts — today, tomorrow, this weekend, next
        /// week, or clearing the date.
        public static func shortcut(_ name: String) -> String {
            "\(namespace).schedule.\(name)"
        }

        /// The calendar picker for an arbitrary date.
        public static let picker = "\(namespace).schedule.picker"
    }

    /// The task inspector — the trailing panel that edits the selection.
    ///
    /// One identifier per editable field, because the inspector is the only
    /// surface in the app where a UI test can assert that a *write* reached the
    /// right frontmatter key. A test that could only find "the third text field"
    /// would keep passing after somebody reordered the form.
    public enum Inspector {
        /// The panel's root.
        public static let panel = "\(namespace).inspector"

        /// The toolbar control that shows and hides the panel.
        public static let toggle = "\(namespace).inspector.toggle"

        /// The empty state, shown for no selection and for a multiple one.
        public static let empty = "\(namespace).inspector.empty"

        /// The title field.
        public static let title = "\(namespace).inspector.title"

        /// The status picker.
        public static let status = "\(namespace).inspector.status"

        /// The priority picker.
        public static let priority = "\(namespace).inspector.priority"

        /// The due-date control, which opens the schedule popover.
        public static let due = "\(namespace).inspector.due"

        /// The scheduled-date control, which opens the schedule popover.
        public static let scheduled = "\(namespace).inspector.scheduled"

        /// The projects token field.
        public static let projects = "\(namespace).inspector.projects"

        /// The contexts token field.
        public static let contexts = "\(namespace).inspector.contexts"

        /// The tags token field.
        public static let tags = "\(namespace).inspector.tags"

        /// The recurrence row. Read-only until the core can summarise a rule.
        public static let recurrence = "\(namespace).inspector.recurrence"

        /// The control that stops a task repeating.
        public static let stopRepeating = "\(namespace).inspector.recurrence.stop"

        /// The recurrence-anchor picker.
        public static let recurrenceAnchor = "\(namespace).inspector.recurrence.anchor"

        /// The time-estimate field.
        public static let timeEstimate = "\(namespace).inspector.timeEstimate"

        /// The rendered note body.
        public static let details = "\(namespace).inspector.details"

        /// The plain-text markdown source editor.
        public static let detailsSource = "\(namespace).inspector.details.source"

        /// The control that switches the note body between reading and editing.
        public static let detailsMode = "\(namespace).inspector.details.mode"
    }
}
