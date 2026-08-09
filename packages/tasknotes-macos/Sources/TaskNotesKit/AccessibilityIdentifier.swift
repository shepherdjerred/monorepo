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

    /// The task list screens: Today now, and its Inbox/Upcoming/Browse
    /// parameterizations later.
    public enum TaskList {
        /// The scrollable list of rows.
        public static let list = "\(namespace).tasklist"

        /// The day heading above the list.
        public static let heading = "\(namespace).tasklist.heading"

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
}
