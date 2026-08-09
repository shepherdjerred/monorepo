internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

/// One task, as a row.
///
/// ## Hover actions, not swipes
///
/// The React Native row is driven by `SwipeActions`; there is no swipe on a
/// Mac. The desktop idiom is a trailing cluster that fades in on hover, and the
/// space it occupies is **reserved whether or not it is showing** — a row whose
/// contents shift as the pointer crosses it feels broken, and the shift also
/// makes the target move out from under the pointer that summoned it.
///
/// Hover is deliberately not the *only* route to any of these: everything here
/// is also in the right-click menu and in the menu bar, because hover is
/// invisible to the keyboard and to VoiceOver.
///
/// ## Accessibility: `.contain`, not `.combine`
///
/// The plan's standing warning is that `.accessibilityIdentifier()` on a
/// container pushes the identifier onto child text and leaves the container
/// unidentified, and that `.combine` is the fix. That is right for the sidebar,
/// whose rows are pure text — and **wrong here**, because `.combine` flattens
/// the row into a single element and takes the checkbox's separate action with
/// it. `.contain` makes the row an accessibility *container*: the identifier
/// lands on the row, and the checkbox, schedule and delete controls keep their
/// own identifiers and remain individually actionable under VoiceOver.
struct TaskRowView: View {
    let row: TaskRowState
    let onToggle: () -> Void
    let onDelete: () -> Void
    let onSchedule: (ScheduleChoice) -> Void
    let onScheduleDate: (String?) -> Void

    @State private var isHovering = false
    @State private var isSchedulePresented = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            TaskCheckbox(row: row, action: onToggle)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Text(row.task.title)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        // Struck through and dimmed rather than removed: the
                        // row stays put so the completion is felt, which is the
                        // whole reason the Today filter keeps a checked
                        // recurring occurrence visible.
                        .strikethrough(row.isCompleted, color: .secondary)
                        .foregroundStyle(row.isCompleted ? .secondary : .primary)

                    // Annotations on the title, trailing it rather than leading
                    // it: a marker in front would make every row's title start
                    // at a different x, and a column of ragged title starts is
                    // harder to scan than the markers are worth.
                    PriorityMarker(priority: row.task.priority)
                    if row.isRecurring {
                        RecurrenceMarker(occurrence: row.occurrence?.text)
                    }
                }

                // **Always the second line, never sometimes.** Showing it only
                // when there is a project or a context made rows with subtitles
                // visibly taller than rows without, so the list had no rhythm
                // and the eye had to re-find the baseline on every row. A space
                // reserves exactly one caption line's height and scales with
                // Dynamic Type, which a hard-coded frame would not.
                Text(subtitle ?? " ")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .accessibilityHidden(subtitle == nil)
            }

            Spacer(minLength: 8)

            if row.isPending {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .help("Waiting to sync")
                    // Stated once, by the row's label. A decoration that is
                    // also its own VoiceOver stop makes the row take four swipes
                    // to say what it already said in one.
                    .accessibilityHidden(true)
            }

            // `displayDate`, not `due`: a recurring task is typically
            // `scheduled`-only, so a due-date badge left the date column empty
            // on exactly the rows whose date is the reason they are on screen.
            // Red here is the row's only red, and it means one thing — late.
            if let date = row.displayDate {
                Text(date.text)
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(
                        date.isOverdue ? AnyShapeStyle(.red) : AnyShapeStyle(.secondary)
                    )
                    .accessibilityHidden(true)
            }

            hoverActions
        }
        .padding(.vertical, 4)
        .contentShape(.rect)
        .onHover { isHovering = $0 }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AccessibilityIdentifier.TaskList.row(row.id))
        .accessibilityLabel(accessibilityLabel)
    }

    /// The trailing cluster, always laid out and only sometimes visible.
    ///
    /// `.opacity` rather than a conditional: removing the views would reflow
    /// the row under the pointer. Hidden controls are also taken out of the
    /// accessibility tree, which is correct — they are a pointer affordance,
    /// and the same commands reach the keyboard through the context menu and
    /// the menu bar.
    private var hoverActions: some View {
        HStack(spacing: 2) {
            Button {
                isSchedulePresented = true
            } label: {
                Image(systemName: "calendar")
            }
            .help("Schedule…")
            .accessibilityLabel("Schedule")
            .accessibilityIdentifier(AccessibilityIdentifier.TaskList.rowSchedule(row.id))
            .popover(isPresented: $isSchedulePresented, arrowEdge: .bottom) {
                SchedulePopover(
                    current: row.due?.date,
                    onChoose: { choice in
                        isSchedulePresented = false
                        onSchedule(choice)
                    },
                    onPick: { date in
                        isSchedulePresented = false
                        onScheduleDate(date)
                    }
                )
            }

            Button(role: .destructive, action: onDelete) {
                Image(systemName: "trash")
            }
            .help("Delete")
            .accessibilityLabel("Delete")
            .accessibilityIdentifier(AccessibilityIdentifier.TaskList.rowDelete(row.id))
        }
        .buttonStyle(.borderless)
        .font(.callout)
        .opacity(isHovering || isSchedulePresented ? 1 : 0)
        .accessibilityHidden(!(isHovering || isSchedulePresented))
    }

    /// Projects and contexts, the two things worth a second line.
    ///
    /// `projectDisplayName` is the core's, because a project is stored as
    /// either a wikilink or a bare name and turning one into the other is a
    /// rule both clients have to share.
    private var subtitle: String? {
        var parts = row.task.projects.map { projectDisplayName(value: $0) }
        parts.append(contentsOf: row.task.contexts.map { "@\($0)" })
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// The row's spoken description.
    ///
    /// Mirrors `rowAccessibilityLabel` in the React Native app, which is the
    /// same product making the same promise to the same user.
    ///
    /// ⚠️ **Every clause here has a visible counterpart, and vice versa.** That
    /// is the rule this row broke before: recurrence was announced by the
    /// checkbox's value and drawn nowhere, so a VoiceOver user knew something a
    /// sighted user could not see. Adding a clause without adding a mark — or a
    /// mark without a clause — puts it straight back.
    private var accessibilityLabel: String {
        var parts = ["Task: \(row.task.title)"]
        if row.isCompleted { parts.append("completed") }
        if let priority = PriorityMarker.spoken(row.task.priority) { parts.append(priority) }
        if row.isRecurring { parts.append("repeats") }
        if row.displayDate?.isOverdue == true { parts.append("overdue") }
        if let date = row.displayDate {
            parts.append(row.isRecurring ? "occurrence of \(date.text)" : "due \(date.text)")
        }
        if let project = row.task.projects.first {
            parts.append("project \(projectDisplayName(value: project))")
        }
        if row.isPending { parts.append("waiting to sync") }
        return parts.joined(separator: ", ")
    }
}

/// The completion control.
///
/// The animation the plan asks to keep from the touch app, in its platform
/// spelling: `.symbolEffect(.replace)` is the system's own symbol transition,
/// so it matches Reminders and honours Reduce Motion without being asked.
private struct TaskCheckbox: View {
    let row: TaskRowState
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: row.isCompleted ? "checkmark.circle.fill" : "circle")
                .imageScale(.large)
                .foregroundStyle(tint)
                .contentTransition(.symbolEffect(.replace.downUp))
        }
        .buttonStyle(.plain)
        .help(row.isCompleted ? "Mark as not completed" : "Mark as completed")
        .accessibilityIdentifier(AccessibilityIdentifier.TaskList.rowToggle(row.id))
        .accessibilityLabel(row.isCompleted ? "Completed" : "Not completed")
        .accessibilityValue(occurrenceDescription)
        .accessibilityAddTraits(.isToggle)
    }

    /// The control's own colour, and **not** the task's priority.
    ///
    /// It used to carry priority, which put a second meaning on the one glyph
    /// whose job is already to say *done or not done* — and put it in red,
    /// where it collided with the overdue date text. Priority now lives on
    /// ``PriorityMarker``, red now means only *late*, and this is left to be
    /// what it is: a control, drawn in the hierarchical greys that every other
    /// unfilled control on macOS uses.
    ///
    /// No hex literals anywhere in this app. Hierarchical styles and `.red` and
    /// friends already track light and dark, Increase Contrast, and the
    /// accessibility colour filters, which is exactly what "semantic colours
    /// following system appearance" asks for.
    private var tint: AnyShapeStyle {
        row.isCompleted ? AnyShapeStyle(.tertiary) : AnyShapeStyle(.secondary)
    }

    /// Which occurrence the control is talking about.
    ///
    /// Spoken, because for a recurring task it is genuinely ambiguous
    /// otherwise — the checkbox reflects the *scheduled* occurrence, which may
    /// be a date well in the past, and a screen-reader user has no other way to
    /// know that.
    ///
    /// It now says **the same words the row prints** rather than a raw
    /// `2026-07-22`. Both come from ``TaskRowState/occurrence``, so the sighted
    /// reading and the spoken one are the same sentence about the same date,
    /// and neither can be changed without the other.
    private var occurrenceDescription: String {
        guard let occurrence = row.occurrence else { return "" }
        return "occurrence of \(occurrence.text)"
    }
}
