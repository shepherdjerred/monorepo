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
        detail(identity: section.rawValue)
    }

    /// The detail pane, named by a raw identity.
    ///
    /// The one overload a scoped screen can use: ``TaskListView`` holds a
    /// ``TaskListScope`` rather than a destination, and a scope's `identity` is
    /// by construction the identity of the destination that produced it. All
    /// three spellings funnel through here so they cannot drift.
    public static func detail(identity: String) -> String {
        "\(namespace).detail.\(identity)"
    }

    /// A source-list row for any destination — a section, a project, a context,
    /// a tag, a saved view, or the board.
    ///
    /// A second overload rather than a replacement, and the two agree on the
    /// four sections by construction: `TaskNotesDestination.section(.today)`
    /// has identity `today`, so this produces exactly what the overload above
    /// produces. That is a requirement, not a coincidence — these identifiers
    /// are what a UI test looks elements up by, and quietly renaming one makes
    /// a test find nothing while still reporting success.
    public static func sidebarItem(_ destination: TaskNotesDestination) -> String {
        "\(namespace).sidebar.\(destination.identity)"
    }

    /// The detail pane for any destination. Same agreement as above.
    public static func detail(_ destination: TaskNotesDestination) -> String {
        detail(identity: destination.identity)
    }

    /// A sidebar group header — `Projects`, `Contexts`, `Tags`, `Views`.
    public static func sidebarGroup(_ name: String) -> String {
        "\(namespace).sidebar.group.\(name)"
    }

    /// The Settings window's root.
    public static let settings = "\(namespace).settings"

    /// The Settings server-address field.
    public static let settingsServerURL = "\(namespace).settings.serverURL"

    /// The bearer-token field in Settings ▸ Server.
    ///
    /// A `SecureField`, so a UI test can address it but cannot read the value
    /// back — AppKit returns bullets for a secure field's value, which is the
    /// behaviour we want and also the reason no test asserts on what is typed.
    public static let settingsServerToken = "\(namespace).settings.serverToken"

    /// Settings ▸ Parked, the dead-letter list.
    public static let settingsParked = "\(namespace).settings.parked"

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

        /// One token inside a list field, keyed by the field and by the value's
        /// **stored** spelling — which is what a test asserting on the vault's
        /// frontmatter already knows, and which survives a display rule changing.
        public static func token(field: String, value: String) -> String {
            "\(field).token.\(value)"
        }

        /// A token's remove control.
        public static func tokenRemove(field: String, value: String) -> String {
            "\(field).token.\(value).remove"
        }

        /// The text entry inside a list field, where completion happens.
        ///
        /// Distinct from the field itself: the field is the whole control
        /// including its tokens, and a test typing into it means this.
        public static func tokenEntry(field: String) -> String {
            "\(field).entry"
        }

        /// The completion list a list field floats below itself while editing.
        public static func tokenSuggestions(field: String) -> String {
            "\(field).suggestions"
        }

        /// One offered name inside that list.
        public static func tokenSuggestion(field: String, value: String) -> String {
            "\(field).suggestion.\(value)"
        }

        /// The recurrence row.
        public static let recurrence = "\(namespace).inspector.recurrence"

        /// The control that opens recurrence editing.
        public static let recurrenceEdit = "\(namespace).inspector.recurrence.edit"

        /// The recurrence editor sheet.
        public static let recurrenceSheet = "\(namespace).inspector.recurrence.sheet"

        /// Explicit consent to replace an unsupported stored rule.
        public static let recurrenceReplace = "\(namespace).inspector.recurrence.replace"

        /// The common recurrence editor's weekday controls.
        public static let recurrenceWeekdays = "\(namespace).inspector.recurrence.weekdays"

        /// The common recurrence editor's cadence picker.
        public static let recurrenceFrequency = "\(namespace).inspector.recurrence.frequency"

        /// One visible cadence choice in the common recurrence editor.
        public static func recurrenceFrequencyOption(_ value: String) -> String {
            "\(recurrenceFrequency).\(value)"
        }

        /// The recurrence sheet's Apply control.
        public static let recurrenceApply = "\(namespace).inspector.recurrence.apply"

        /// The control that stops a task repeating.
        public static let stopRepeating = "\(namespace).inspector.recurrence.stop"

        /// The recurrence-anchor picker.
        public static let recurrenceAnchor = "\(namespace).inspector.recurrence.anchor"

        /// One visible anchor choice in the common recurrence editor.
        public static func recurrenceAnchorOption(_ value: String) -> String {
            "\(recurrenceAnchor).\(value)"
        }

        /// The time-estimate field.
        public static let timeEstimate = "\(namespace).inspector.timeEstimate"

        /// The rendered note body.
        public static let details = "\(namespace).inspector.details"

        /// The plain-text markdown source editor.
        public static let detailsSource = "\(namespace).inspector.details.source"

        /// The control that switches the note body between reading and editing.
        public static let detailsMode = "\(namespace).inspector.details.mode"
    }

    /// The floating quick-add panel.
    ///
    /// ⚠️ The panel is an `NSPanel` outside every scene, so a UI test reaches it
    /// through the application element rather than through a window — which is
    /// exactly why its identifiers have to be namespaced separately from the
    /// list screens' compose row. The two look alike and are not the same
    /// control: one lives in a window and keeps focus after a submit, the other
    /// floats over another application and closes.
    public enum QuickAdd {
        /// The panel's root.
        public static let panel = "\(namespace).quickAdd"

        /// The natural-language entry field.
        public static let field = "\(namespace).quickAdd.field"

        /// The strip showing what the core understood.
        public static let preview = "\(namespace).quickAdd.preview"

        /// One recognised token. Keyed by what it says, which is what a test
        /// looking for "Tomorrow" or "High" already knows.
        public static func mark(_ text: String) -> String {
            "\(namespace).quickAdd.preview.\(text)"
        }

        /// The line reading out the two keys the panel answers to.
        public static let hint = "\(namespace).quickAdd.hint"

        /// The Settings control that rebinds the global hotkey.
        public static let shortcutRecorder = "\(namespace).quickAdd.shortcut"
    }

    /// The pomodoro timer and the time report, which are windows of their own.
    public enum Timing {
        /// The pomodoro window's root.
        public static let pomodoro = "\(namespace).pomodoro"

        /// The countdown itself.
        public static let countdown = "\(namespace).pomodoro.countdown"

        /// The window's primary control.
        ///
        /// One identifier rather than one per verb, because it is one button:
        /// Start, Pause, Resume and Start Break are four states of the same
        /// control, and a test that had to guess which identifier was present
        /// would be asserting on the label it can already read.
        public static let primary = "\(namespace).pomodoro.primary"

        /// The control that abandons the interval.
        public static let stop = "\(namespace).pomodoro.stop"

        /// The picker naming the task the interval is against.
        public static let subject = "\(namespace).pomodoro.subject"

        /// The picker choosing between a focus and a rest interval.
        public static let phase = "\(namespace).pomodoro.phase"

        /// The time-report window's root.
        public static let report = "\(namespace).timeReport"

        /// The report's grand total.
        public static let reportTotal = "\(namespace).timeReport.total"

        /// One task's row in the report, keyed by task id for the same reason a
        /// list row is.
        public static func reportRow(_ taskId: String) -> String {
            "\(namespace).timeReport.row.\(taskId)"
        }

        /// The report's empty state.
        public static let reportEmpty = "\(namespace).timeReport.empty"
    }

    /// The Kanban board.
    ///
    /// ⚠️ **Every drag target below has a non-drag identifier beside it.** A
    /// drop destination that only a pointer can reach is invisible to
    /// VoiceOver and to `performAccessibilityAudit()`, and a UI test cannot
    /// synthesize a drag at all — so the identifiers that matter most here are
    /// the ones on the *menu items* that perform the same move.
    public enum Board {
        /// The scrolling row of columns.
        public static let board = "\(namespace).board"

        /// One column, keyed by the core's wire value for its status —
        /// `open`, `in-progress`, `done` — so a test names the column it means
        /// rather than a position that a reordered enum would shift.
        public static func column(_ status: String) -> String {
            "\(namespace).board.column.\(status)"
        }

        /// A column's heading and count.
        public static func columnHeader(_ status: String) -> String {
            "\(namespace).board.column.\(status).header"
        }

        /// A column with nothing in it, which is a state worth being able to
        /// assert on: an empty column must still be a drop target.
        public static func columnEmpty(_ status: String) -> String {
            "\(namespace).board.column.\(status).empty"
        }

        /// One card, keyed by task id.
        public static func card(_ taskId: String) -> String {
            "\(namespace).board.card.\(taskId)"
        }

        // A card's completion control has **no identifier of its own**, on
        // purpose: it is literally `TaskCheckbox`, the same view the list row
        // uses, so it carries `TaskList.rowToggle`. Minting a second name for
        // one control would let a UI test believe it had covered both.

        /// The **keyboard and VoiceOver route to a move**: one item per target
        /// column inside a card's context menu, keyed by the status it moves to.
        public static func moveTo(_ status: String) -> String {
            "\(namespace).board.moveTo.\(status)"
        }

        /// The board's empty state.
        public static let empty = "\(namespace).board.empty"
    }

    /// Saved views — the stored queries, and the sheet that makes one.
    public enum SavedViews {
        // A saved view's sidebar row has **no identifier of its own**: it is
        // `sidebarItem(.savedView(id:))`, the same function every other source
        // list row uses, keyed by the view's stable id rather than by its
        // renameable name. A second name for one row would let a UI test
        // believe it had covered both.

        /// The command that keeps the current query as a view.
        public static let save = "\(namespace).savedView.save"

        /// The editor sheet's root.
        public static let editor = "\(namespace).savedView.editor"

        /// The editor's name field.
        public static let editorName = "\(namespace).savedView.editor.name"

        /// One choice in the editor's symbol picker.
        public static func editorSymbol(_ symbol: String) -> String {
            "\(namespace).savedView.editor.symbol.\(symbol)"
        }

        /// The editor's confirm button.
        public static let editorConfirm = "\(namespace).savedView.editor.confirm"

        /// The control that deletes a saved view.
        public static let delete = "\(namespace).savedView.delete"

        /// The control that puts the shipped views back.
        public static let restoreDefaults = "\(namespace).savedView.restoreDefaults"

        /// The banner shown when the stored views could not be read.
        public static let error = "\(namespace).savedView.error"
    }
}
