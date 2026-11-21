/// Namespaced accessibility identifiers shared between SwiftUI surfaces and XCUITest targets.
public enum AccessibilityIdentifier {
    private static let namespace = "red.sjer.tasknotes"

    public static let sidebar = "\(namespace).sidebar"

    public static func sidebarSection(_ section: FacetSection) -> String {
        "\(namespace).sidebar.\(section.rawValue)"
    }

    public static func sidebarDestination(_ destination: FacetDestination) -> String {
        "\(namespace).sidebar.\(destination.identity)"
    }

    public static func detail(_ destination: FacetDestination) -> String {
        detail(identity: destination.identity)
    }

    public static func detail(identity: String) -> String {
        "\(namespace).detail.\(identity)"
    }

    public static func sidebarGroup(_ name: String) -> String {
        "\(namespace).sidebar.group.\(name)"
    }

    public static let settings = "\(namespace).settings"
    public static let settingsServerURL = "\(namespace).settings.serverURL"
    public static let settingsServerToken = "\(namespace).settings.serverToken"
    public static let settingsConnect = "\(namespace).settings.connect"
    public static let settingsSyncNow = "\(namespace).settings.syncNow"

    public enum TaskList {
        public static let list = "\(namespace).tasklist"
        public static let heading = "\(namespace).tasklist.heading"
        public static let search = "\(namespace).tasklist.search"
        public static let count = "\(namespace).tasklist.count"
        public static let empty = "\(namespace).tasklist.empty"
        public static let composeField = "\(namespace).tasklist.compose"
        public static let newTask = "\(namespace).tasklist.newTask"
        public static let refresh = "\(namespace).tasklist.refresh"
        public static let viewMode = "\(namespace).tasklist.viewMode"

        public static func group(_ heading: String) -> String {
            "\(namespace).tasklist.group.\(heading)"
        }

        public static func row(_ taskId: String) -> String {
            "\(namespace).tasklist.row.\(taskId)"
        }

        public static func rowToggle(_ taskId: String) -> String {
            "\(namespace).tasklist.row.\(taskId).toggle"
        }

        public static func rowSchedule(_ taskId: String) -> String {
            "\(namespace).tasklist.row.\(taskId).schedule"
        }

        public static func rowDelete(_ taskId: String) -> String {
            "\(namespace).tasklist.row.\(taskId).delete"
        }
    }

    public enum SyncBanner {
        public static let banner = "\(namespace).syncBanner"
        public static let retry = "\(namespace).syncBanner.retry"
        public static let openSettings = "\(namespace).syncBanner.openSettings"
    }

    public enum Schedule {
        public static let popover = "\(namespace).schedule"
        public static let picker = "\(namespace).schedule.picker"

        public static func shortcut(_ name: String) -> String {
            "\(namespace).schedule.\(name)"
        }
    }

    public enum Inspector {
        public static let panel = "\(namespace).inspector"
        public static let toggle = "\(namespace).inspector.toggle"
        public static let empty = "\(namespace).inspector.empty"
        public static let title = "\(namespace).inspector.title"
        public static let priority = "\(namespace).inspector.priority"
        public static let due = "\(namespace).inspector.due"
        public static let project = "\(namespace).inspector.project"
        public static let section = "\(namespace).inspector.section"
        public static let labels = "\(namespace).inspector.labels"
        public static let recurrence = "\(namespace).inspector.recurrence"
        public static let recurrenceEdit = "\(namespace).inspector.recurrence.edit"
        public static let recurrenceSheet = "\(namespace).inspector.recurrence.sheet"
        public static let recurrenceApply = "\(namespace).inspector.recurrence.apply"
        public static let stopRepeating = "\(namespace).inspector.recurrence.stop"
        public static let subtasks = "\(namespace).inspector.subtasks"
        public static let details = "\(namespace).inspector.details"
        public static let detailsSource = "\(namespace).inspector.details.source"
        public static let detailsMode = "\(namespace).inspector.details.mode"
        public static let deleteTask = "\(namespace).inspector.delete"
    }

    public enum QuickAdd {
        public static let panel = "\(namespace).quickAdd"
        public static let field = "\(namespace).quickAdd.field"
        public static let preview = "\(namespace).quickAdd.preview"
        public static let hint = "\(namespace).quickAdd.hint"
        public static let shortcutRecorder = "\(namespace).quickAdd.shortcut"

        public static func mark(_ text: String) -> String {
            "\(namespace).quickAdd.preview.\(text)"
        }
    }

    public enum Board {
        public static let board = "\(namespace).board"
        public static let empty = "\(namespace).board.empty"

        public static func column(_ identifier: String) -> String {
            "\(namespace).board.column.\(identifier)"
        }

        public static func columnHeader(_ identifier: String) -> String {
            "\(namespace).board.column.\(identifier).header"
        }

        public static func columnEmpty(_ identifier: String) -> String {
            "\(namespace).board.column.\(identifier).empty"
        }

        public static func card(_ taskId: String) -> String {
            "\(namespace).board.card.\(taskId)"
        }

        public static func moveTo(_ identifier: String) -> String {
            "\(namespace).board.moveTo.\(identifier)"
        }
    }
}
