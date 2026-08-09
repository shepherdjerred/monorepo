internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

// The Today screen's pieces, as their own views.
//
// Split out because the screen's type had outgrown the linter's body limit,
// which turned out to be pointing at something real: Inbox, Upcoming and Browse
// are parameterizations of this screen, and a heading, a compose row, an empty
// state and a context menu that are already separate views are three quarters
// of that generalization done. The pieces that stayed behind are the ones that
// genuinely need the screen's state.

/// The day heading and its task count.
struct TodayHeader: View {
    let list: TodayList

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(list.heading)
                .font(.title2.weight(.semibold))
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.heading)
            Spacer()
            Text(list.countLabel)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier(AccessibilityIdentifier.TaskList.count)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
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

/// The empty state, in both of its readings.
///
/// The distinction is the whole feature. "Nothing due today" is a statement
/// about the vault; "All clear" is a statement about *you*, and it is only true
/// if you actually finished something on this screen. Showing the celebration
/// to someone who opened an already-empty list is congratulating them for
/// nothing, which is worse than saying nothing.
struct TodayEmptyState: View {
    let hasInteracted: Bool
    let onNewTask: () -> Void

    var body: some View {
        VStack {
            Spacer()
            ContentUnavailableView {
                Label(
                    hasInteracted ? "All clear" : "Nothing due today",
                    systemImage: hasInteracted ? "sun.max" : "checklist"
                )
            } description: {
                Text(
                    hasInteracted
                        ? "Every task for today is done. Nice work."
                        : "Tasks due today and overdue tasks appear here."
                )
            } actions: {
                Button("New Task", action: onNewTask)
            }
            Spacer()
        }
        .accessibilityIdentifier(AccessibilityIdentifier.TaskList.empty)
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
/// code there. Priority works here. Edit is present and disabled, because the
/// inspector it opens is the next phase and a command that disappears until
/// then teaches nobody where it lives.
struct TaskRowMenu: View {
    let targets: [TaskRowState]
    let onNewTask: () -> Void
    let onToggle: ([TaskRowState]) -> Void
    let onSchedule: (ScheduleChoice) -> Void
    let onPriority: (Priority) -> Void
    let onDelete: () -> Void

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
            Button("Edit…", systemImage: "pencil") {}
                .disabled(true)
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
