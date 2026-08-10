internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

/// The task inspector: the trailing panel that edits whatever the list has
/// selected.
///
/// ## An inspector, not a third `NavigationSplitView` column
///
/// Both were built out on paper and this is not a close call.
///
/// A third column is a **destination**. Mail's mailboxes → messages → message
/// is a real hierarchy: the third column is where you *went*, it is what the
/// window is about, and the back-forward model, the proxy icon and the window
/// title all follow it. TaskDetail is not that. The list is still what the
/// window is about; the panel shows attributes of the current selection and
/// changes as the selection changes. Selecting a row is not navigation, and the
/// plan says so directly — "selecting a row in any list shows it; it is not a
/// navigation push".
///
/// Three concrete consequences settle it:
///
///   * **It has to be dismissible, and a column is not.** A `NavigationSplitView`
///     column can be collapsed only at the leading edge; a trailing detail
///     column is permanent. Somebody reading a long list wants the width back,
///     and `⌥⌘I` is the platform's answer.
///   * **A column has no honest reading of "nothing selected".** It would show a
///     placeholder pane occupying a third of the window forever. An inspector
///     that is closed occupies nothing, and an open one showing "No Selection"
///     is a normal, expected state rather than a hole.
///   * **The list would be squeezed into the middle.** These list screens have a
///     day heading, a compose row and a sync banner; middle columns are sized for
///     a message list, not a screen.
///
/// It is also what every Mac app with this shape does — Xcode, Numbers, Pages,
/// Keynote, Freeform, Notes' attribute panel — so `⌥⌘I` already means this to
/// anybody who has used one.
///
/// ## Where the selection comes from
///
/// ``InspectorSubject``, a focused scene value the frontmost list publishes.
/// The panel therefore follows the window the user is looking at, works
/// identically for every list screen, and has a real `nil` state when a Settings
/// window is frontmost — which it renders rather than hides.
struct TaskInspector: View {
    let store: TaskNotesStore

    @FocusedValue(\.inspectorSubject) private var subject: InspectorSubject?

    /// Where and when the viewer is, held rather than re-read per redraw so the
    /// scheduled badge, the next occurrence and the list's own row all describe
    /// one instant.
    @State private var calendar: ViewerCalendar

    /// The vault's project, context and tag names, for token completion.
    ///
    /// Cached rather than computed in `body`. Building it walks every task and
    /// asks the core's `projectMatches` about every project it finds, which is
    /// an FFI call per comparison — fine once per change to the vault, far too
    /// much once per redraw of a panel that redraws on every keystroke.
    @State private var vocabulary = TaskVocabulary.empty

    init(store: TaskNotesStore) {
        self.store = store
        _calendar = State(initialValue: store.viewerCalendar())
    }

    var body: some View {
        content
            // ⚠️ `.contain`. The panel is a form of editable fields, each with
            // its own identifier because the inspector is the only surface
            // where a UI test can prove a *write* reached the right frontmatter
            // key. `.combine` would take every one of them.
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Inspector")
            .accessibilityIdentifier(AccessibilityIdentifier.Inspector.panel)
            .inspectorColumnWidth(min: 300, ideal: 340, max: 520)
            .task(id: store.tasks) {
                vocabulary = TaskVocabulary.of(tasks: store.tasks)
                calendar = store.viewerCalendar()
            }
    }

    @ViewBuilder
    private var content: some View {
        if let row = subject?.single {
            switch TaskDetail.of(row: row, calendar: calendar) {
            case .success(let detail):
                TaskInspectorForm(
                    detail: detail,
                    vocabulary: vocabulary,
                    // The id is captured here rather than read back out of the
                    // focused value at dispatch time. The selection can change
                    // between a field losing focus and its commit landing, and
                    // an edit that re-read the selection would write the text
                    // somebody typed into one task onto a different one.
                    apply: { apply($0, to: detail.id) },
                    attempt: { attempt($0, to: detail.id) },
                    dispatch: dispatch
                )
                // A fresh identity per task, so every text buffer in the form
                // is rebuilt when the selection moves. Without it, selecting a
                // second task would leave the first one's half-typed title in
                // the field and commit it against the wrong note.
                .id(detail.id)
            case .failure(let error):
                unavailable(
                    title: "This task cannot be shown",
                    description: error.userMessage,
                    symbol: "exclamationmark.triangle"
                )
            }
        } else {
            unavailable(
                title: emptyTitle,
                description: emptyDescription,
                symbol: "sidebar.right"
            )
        }
    }

    /// The two empty readings, which are genuinely different states.
    ///
    /// "No Selection" is the resting state of an open panel. A *multiple*
    /// selection is not that — the user selected things on purpose, and the
    /// panel has to say why it is not showing them rather than looking broken.
    private var emptyTitle: String {
        let count = subject?.rows.count ?? 0
        return count > 1 ? "\(count) Tasks Selected" : "No Selection"
    }

    private var emptyDescription: String {
        // Deliberately not "multi-edit is unsupported". The panel edits one
        // task; the *bulk* verbs — complete, schedule, priority, delete — are
        // all on the right-click menu and in the menu bar, and pointing at them
        // is more useful than apologising.
        subject.map { $0.rows.count > 1 } == true
            ? "Select a single task to edit it. Right-click the selection for actions that apply to all of them."
            : "Select a task in the list to see and edit it here."
    }

    private func unavailable(title: String, description: String, symbol: String) -> some View {
        ContentUnavailableView {
            Label(title, systemImage: symbol)
        } description: {
            Text(description)
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.empty)
    }

    // ── Dispatch ───────────────────────────────────────────────────────────

    /// Record a field change.
    ///
    /// Nothing is mutated locally. The edit becomes a `CommandInput.update`,
    /// goes through the store into the offline queue, and comes back as a new
    /// snapshot — which is what makes it survive being offline, retried, and
    /// reconciled against a server that changed the task underneath.
    private func apply(_ edit: TaskFieldEdit, to taskId: TaskId) {
        dispatch(edit.command(for: taskId))
    }

    /// Record a field change that might not be one, or might be invalid.
    ///
    /// `nil` means the committed text matched what is stored, and **nothing is
    /// dispatched** — a commit-on-blur field that queued an update every time
    /// the user tabbed past it would produce a network round trip and a
    /// frontmatter rewrite per tab press.
    private func attempt(_ outcome: Result<TaskFieldEdit?, CoreError>, to taskId: TaskId) {
        switch outcome {
        case .success(let edit):
            guard let edit else { return }
            apply(edit, to: taskId)
        case .failure(let error):
            // Into the same channel as a bad quick-add line: something this Mac
            // refused, not something the network did. `status.lastError` is the
            // engine's account of the network and must not be polluted with it.
            store.report(error)
        }
    }

    /// Record the command, then run the pass it armed.
    ///
    /// Detached from the gesture, because the enqueue itself runs on the
    /// engine's queue: `store.dispatch` never takes the engine's mutex from the
    /// main actor, so an edit made while a sync is draining cannot freeze the
    /// panel it was typed into.
    private func dispatch(_ command: CommandInput) {
        _Concurrency.Task {
            await store.dispatch(command)
            await store.settle()
        }
    }
}
