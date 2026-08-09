internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

// The list screen's pieces, as their own views.
//
// Split out because the screen's type had outgrown the linter's body limit,
// which turned out to be pointing at something real: Inbox, Upcoming and Browse
// are parameterizations of this screen, and a heading, a compose row, an empty
// state and a context menu that are already separate views are three quarters
// of that generalization done. The pieces that stayed behind in `TaskListView`
// are the ones that genuinely need the screen's state.

/// The screen's heading and its task count.
struct TaskListHeader: View {
    let model: TaskListModel

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(model.heading)
                .font(.title2.weight(.semibold))
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.heading)
            Spacer()
            Text(count)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.count)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    /// The count, and how much of the screen it is counting.
    ///
    /// A bare `6 tasks` on a filtered list is a true statement that reads as a
    /// false one — the reader has no way to tell it apart from a vault with six
    /// tasks in it. Saying `6 of 34` states the narrowing in the one place the
    /// eye is already looking for a number.
    private var count: String {
        guard model.isNarrowed, model.admittedCount != model.rows.count else {
            return model.countLabel
        }
        return "\(model.rows.count) of \(model.admittedCount)"
    }
}

/// A day heading inside a grouped list.
///
/// Only Upcoming has these. The words are the core's for the near buckets —
/// `Tomorrow`, `This Week` — and a formatted date beyond them, which is exactly
/// where `dateGroupHeading` answers `nil` and hands the job to the shell.
struct TaskListGroupHeader: View {
    let heading: String

    var body: some View {
        Text(heading)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.secondary)
            .accessibilityIdentifier(AccessibilityIdentifier.TaskList.group(heading))
    }
}

/// The inline compose row.
///
/// An inline row rather than a sheet, and the difference is not cosmetic: a
/// sheet is modal, and adding a task is the one thing in this app that should
/// never block reading the list you are adding it to. It is also where the
/// core's natural-language parser earns its keep — `pay rent tomorrow !high`
/// arrives as a title, a date and a priority because `parseTaskInput` says so,
/// on both clients, identically.
struct TaskComposeRow: View {
    @Binding var text: String
    var focus: FocusState<Bool>.Binding
    let onSubmit: () -> Void
    let onCancel: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "plus.circle")
                .imageScale(.large)
                .foregroundStyle(.secondary)
            PlainTextField(
                text: $text,
                prompt: "New task — try “pay rent tomorrow !high”",
                onSubmit: onSubmit,
                onCancel: onCancel
            )
            .focused(focus)
            .accessibilityIdentifier(AccessibilityIdentifier.TaskList.composeField)
            .accessibilityLabel("New task")
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .background(.quinary)
    }
}

/// Why a list is empty, and what to do about it.
///
/// ## Three readings, and the distinction is the whole feature
///
///   * **Narrowed** — there are tasks here, and you hid them. This one comes
///     first because getting it wrong is the most expensive: a screen that says
///     "Inbox is empty" while a stale filter hides eleven tasks sends the reader
///     to look for missing data, and the only honest remedy — drop the filter —
///     is the one thing the message did not mention.
///   * **Cleared** — you finished everything on this screen, in this session.
///   * **Empty** — there was never anything here.
///
/// "All clear" is a statement about *you* and it is only true if you actually
/// finished something; showing the celebration to someone who opened an
/// already-empty list congratulates them for nothing, which is worse than
/// saying nothing.
struct TaskListEmptyState: View {
    let section: SidebarSection
    let isNarrowed: Bool
    let hasInteracted: Bool
    let onNewTask: () -> Void
    let onClearFilters: () -> Void

    var body: some View {
        VStack {
            Spacer()
            ContentUnavailableView {
                Label(title, systemImage: symbol)
            } description: {
                Text(description)
            } actions: {
                if isNarrowed {
                    Button("Clear Filters", action: onClearFilters)
                        .accessibilityIdentifier(AccessibilityIdentifier.Query.clearFilters)
                } else {
                    Button("New Task", action: onNewTask)
                }
            }
            Spacer()
        }
        .accessibilityIdentifier(AccessibilityIdentifier.TaskList.empty)
    }

    private var title: String {
        if isNarrowed { return "No matches" }
        if hasInteracted { return cleared }
        return empty
    }

    private var symbol: String {
        if isNarrowed { return "line.3.horizontal.decrease.circle" }
        if hasInteracted { return "sun.max" }
        return section.systemImage
    }

    private var description: String {
        if isNarrowed {
            return "No task on this screen matches the current search and filter."
        }
        if hasInteracted { return clearedDescription }
        return emptyDescription
    }

    /// What "you cleared it" says, per screen.
    ///
    /// Different words rather than one shared sentence, because clearing Today
    /// and clearing Inbox are different achievements: one is a day's work, the
    /// other is a triage pass.
    private var cleared: String {
        switch section {
        case .today: "All clear"
        case .inbox: "Inbox zero"
        case .upcoming: "Nothing left ahead"
        case .browse: "Nothing left"
        }
    }

    private var clearedDescription: String {
        switch section {
        case .today: "Every task for today is done. Nice work."
        case .inbox: "Everything here has been filed or finished."
        case .upcoming: "Every scheduled task is done."
        case .browse: "Every task in the vault is done."
        }
    }

    private var empty: String {
        switch section {
        case .today: "Nothing due today"
        case .inbox: "Nothing to triage"
        case .upcoming: "Nothing scheduled"
        case .browse: "No tasks"
        }
    }

    private var emptyDescription: String {
        switch section {
        case .today: "Tasks due today and overdue tasks appear here."
        case .inbox: "Tasks with no project, context, or date appear here."
        case .upcoming: "Tasks due or scheduled after today appear here."
        case .browse: "Every task in the vault appears here."
        }
    }
}

/// The right-click menu, over one row or over a whole selection.
///
/// This single view is what replaces the touch app's long-press menu, its
/// explicit selection mode, and its bottom `BulkActionBar` — all three, because
/// `contextMenu(forSelectionType:)` hands it whichever rows are under the
/// click and does not care whether that is one or fifty.
///
/// It is also where two commands that exist in the React Native codebase but
/// can never be reached finally surface: `TaskList` never passes `onTaskEdit`
/// or `onTaskSetPriority`, so `TaskRow`'s Edit and Priority items are dead
/// code there. Both work here.
struct TaskRowMenu: View {
    let targets: [TaskRowState]
    let onNewTask: () -> Void
    let onToggle: ([TaskRowState]) -> Void
    let onSchedule: (ScheduleChoice) -> Void
    let onPriority: (Priority) -> Void
    let onDelete: () -> Void

    /// The inspector, when there is one in front of the user.
    ///
    /// Read as a focused value rather than passed in, so this menu keeps
    /// working on a screen that has no inspector attached — the item is then
    /// present and disabled, which is the plan's rule.
    @FocusedValue(\.inspectorPresentation) private var inspector: InspectorPresentation?

    var body: some View {
        if targets.isEmpty {
            // A right-click on the empty part of the list still has something
            // to offer, which is the difference between a list and a wall.
            Button("New Task", systemImage: "plus", action: onNewTask)
        } else {
            Button(completionVerb, systemImage: "checkmark.circle") { onToggle(targets) }
            Menu("Schedule", systemImage: "calendar") {
                ForEach(ScheduleChoice.allCases, id: \.self) { choice in
                    Button(choice.title, systemImage: choice.systemImage) { onSchedule(choice) }
                }
            }
            Menu("Priority", systemImage: "flag") {
                // The core's list and the core's labels, so the two clients
                // offer the same options in the same order under the same
                // names.
                ForEach(priorityAll(), id: \.self) { priority in
                    Button(priorityLabel(priority: priority)) { onPriority(priority) }
                }
            }
            Divider()
            // Disabled over a multi-selection rather than hidden: the inspector
            // edits exactly one task, and a form bound to two would have to
            // invent a reading for "two different titles".
            Button("Edit…", systemImage: "pencil") { inspector?.reveal() }
                .disabled(inspector == nil || targets.count != 1)
            Button("Delete", systemImage: "trash", role: .destructive, action: onDelete)
        }
    }

    /// What the completion item says.
    ///
    /// Over a mixed selection it offers to complete, not to un-complete: the
    /// menu should describe the action that makes progress.
    private var completionVerb: String {
        targets.allSatisfy(\.isCompleted) ? "Mark as Not Completed" : "Complete"
    }
}
