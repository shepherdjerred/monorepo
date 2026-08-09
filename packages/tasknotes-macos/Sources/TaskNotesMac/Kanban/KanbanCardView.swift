internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

/// One task, as a card on the board.
///
/// ## A card is a row with two lines and a border, not a new design
///
/// It reuses ``PriorityMarker`` and ``RecurrenceMarker`` verbatim, and it
/// spends colour under exactly the same rules the list row does: **red means
/// late and nothing else**, priority is a mark rather than a hue, and a
/// completed card's date is never red however far past it is. A board that
/// invented its own priority colours — the React Native card draws a
/// `PRIORITY_COLORS` dot — would put a second, contradictory legend two clicks
/// from the first.
///
/// The one genuine difference from the row: a card's title wraps to two lines
/// instead of truncating at one. A column is 280pt wide, so one line would
/// truncate most real titles, and the constant-baseline argument that makes the
/// list row single-line does not apply to a grid where nothing is being scanned
/// straight down.
///
/// ## Dragging is an addition, never the only route
///
/// `.draggable` is the reason this screen exists on a desktop at all — it was
/// impractical on touch, and pulling a card between columns is the interaction
/// the board is for. But a drag is invisible to the keyboard, invisible to
/// VoiceOver, and cannot be synthesized by XCUITest. So **every move a drag can
/// make is also in the context menu below**, keyed by target column, and also
/// on `⌃⌘←` / `⌃⌘→` through the Task menu. The drag is the shortcut; the menu
/// is the feature.
struct KanbanCardView: View {
    let row: TaskRowState

    /// The columns this card could move to — every column but its own.
    let moveTargets: [KanbanColumn]

    let onToggle: () -> Void
    let onMove: (TaskStatus) -> Void
    let onDelete: () -> Void

    /// What column the card is in, spoken rather than only drawn.
    ///
    /// The column heading is a separate accessibility element above a
    /// scrollable list, so a VoiceOver reader arriving at a card has no way to
    /// know which column they are in. Sighted readers get it from position.
    /// Saying it satisfies the row rule this app already holds: every clause
    /// spoken has a visible counterpart, and this one's counterpart is the
    /// heading.
    let columnTitle: String

    /// The inspector, when the frontmost window has one.
    @FocusedValue(\.inspectorPresentation) private var inspector: InspectorPresentation?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                TaskCheckbox(row: row, action: onToggle)
                Text(row.task.title)
                    .lineLimit(2)
                    .strikethrough(row.isCompleted, color: .secondary)
                    .foregroundStyle(row.isCompleted ? .secondary : .primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                PriorityMarker(priority: row.task.priority, isDimmed: row.isCompleted)
                if row.isRecurring {
                    RecurrenceMarker(occurrence: row.occurrence?.text, isDimmed: row.isCompleted)
                }
                if row.isPending {
                    // On the **title** line, beside the other two marks, and not
                    // on the caption line below. A first pass put it there and
                    // rendering showed why that is wrong: a task with no date
                    // and no project got a caption line containing nothing but
                    // a right-aligned glyph floating in space. The three marks
                    // are one cluster and they belong together.
                    //
                    // A straight arrow, not a circular one — queued work goes
                    // *up* to the server, and this app already spends two
                    // circular two-arrow glyphs on retrying and repeating.
                    Image(systemName: "arrow.up.circle")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }

            if metadata != nil || row.displayDate != nil {
                HStack(spacing: 6) {
                    if let date = row.displayDate {
                        Text(date.text)
                            .font(.caption)
                            .monospacedDigit()
                            .foregroundStyle(dateTint(date))
                    }
                    if let metadata {
                        Text(metadata)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    Spacer(minLength: 0)
                }
                // The whole strip is spoken by the card's own label instead, so
                // the card reads as one sentence rather than as a title
                // interrupted by a date and a list of tags.
                .accessibilityHidden(true)
                // Aligned under the title rather than under the checkbox.
                .padding(.leading, 22)
            }
        }
        .padding(8)
        .background(.background.secondary, in: .rect(cornerRadius: 6))
        .overlay {
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(.separator, lineWidth: 1)
        }
        .contentShape(.rect)
        // `.contain`, not `.combine`: combining flattens the card into one
        // element and takes the checkbox's separate action with it. See
        // `TaskRowView` for the full argument — it is the same one.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AccessibilityIdentifier.Board.card(row.id))
        .accessibilityLabel(accessibilityLabel)
        .draggable(row.id) {
            // A drag preview that is the card itself, without the drop shadow
            // AppKit would otherwise put under a plain text payload. The
            // payload is the task id — a `String` — because that is what the
            // drop handler resolves against the board it is dropping into; a
            // dropped id the board does not hold is refused rather than
            // guessed at.
            KanbanDragPreview(title: row.task.title)
        }
        .contextMenu { menu }
    }

    @ViewBuilder
    private var menu: some View {
        Button(
            row.isCompleted ? "Mark as Not Completed" : "Complete",
            systemImage: "checkmark.circle",
            action: onToggle
        )

        // The keyboard and VoiceOver equivalent of the drag. Present even when
        // empty — which it cannot be, since a board always has more than one
        // column — and disabled rather than hidden if it ever were, per the
        // definition of done.
        Menu("Move to", systemImage: "arrow.right.square") {
            ForEach(moveTargets) { target in
                Button(target.title) { onMove(target.status) }
                    .accessibilityIdentifier(AccessibilityIdentifier.Board.moveTo(target.id))
            }
        }
        .disabled(moveTargets.isEmpty)

        Divider()

        Button("Edit…", systemImage: "pencil") { inspector?.reveal() }
            .disabled(inspector == nil)
        Button("Delete", systemImage: "trash", role: .destructive, action: onDelete)
    }

    /// The date's colour, and the one place red appears on a card.
    ///
    /// A completed task cannot be late, so a completed card's date is never
    /// red. Identical to the list row's rule, deliberately.
    private func dateTint(_ date: DateBadge) -> AnyShapeStyle {
        guard date.isOverdue, !row.isCompleted else { return AnyShapeStyle(.secondary) }
        return AnyShapeStyle(.red)
    }

    /// Projects and contexts, the two things worth trailing a card with.
    private var metadata: String? {
        var parts = row.task.projects.map { projectDisplayName(value: $0) }
        parts.append(contentsOf: row.task.contexts.map { "@\($0)" })
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// The card's spoken description.
    ///
    /// The list row's label plus the column, because the column is the one
    /// thing a board conveys purely by position.
    private var accessibilityLabel: String {
        var parts = ["Task: \(row.task.title)"]
        parts.append(columnTitle)
        if row.isCompleted { parts.append("completed") }
        if let priority = PriorityMarker.spoken(row.task.priority) { parts.append(priority) }
        if row.isRecurring { parts.append("repeats") }
        if !row.isCompleted, row.displayDate?.isOverdue == true { parts.append("overdue") }
        if let date = row.displayDate {
            parts.append(row.isRecurring ? "occurrence of \(date.text)" : "due \(date.text)")
        }
        if let metadata { parts.append(metadata) }
        if row.isPending { parts.append("waiting to sync") }
        return parts.joined(separator: ", ")
    }
}

/// What the pointer carries while a card is in flight.
///
/// Its own small view rather than the card itself: a dragged `KanbanCardView`
/// would carry a live `@FocusedValue` and a context menu into a preview that
/// can do nothing with either.
private struct KanbanDragPreview: View {
    let title: String

    var body: some View {
        Text(title)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.background.secondary, in: .rect(cornerRadius: 6))
    }
}
