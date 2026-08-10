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
                    // `row.isTerminal`, not `row.isCompleted`, and not the
                    // row's `isRetired`. On a board the strikethrough answers
                    // the question the *column* asks, and the checkbox answers
                    // the question the *gesture* asks. See the channel table
                    // below.
                    .strikethrough(row.isTerminal, color: .secondary)
                    .foregroundStyle(row.isTerminal ? .secondary : .primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                PriorityMarker(priority: row.task.priority, isDimmed: row.isTerminal)
                if row.isRecurring {
                    RecurrenceMarker(occurrence: row.occurrence?.text, isDimmed: row.isTerminal)
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

    // ── Why this card reads `isTerminal` and the list row reads `isRetired`
    //
    // ## Why a card and a row disagree about the word "completed"
    //
    // ``TaskRowState/isCompleted`` is deliberately *occurrence*-level: for a
    // recurring task it is the state of the occurrence a click would target,
    // which is what makes the checkbox and the gesture incapable of
    // disagreeing. A list row is right to draw that — Today's whole subject is
    // today's work, so a struck-through row means "today's instance is done"
    // and the row staying put is what makes the completion feel like it
    // landed.
    //
    // **A board asks a different question.** A card's column *is* its
    // `status`, so a card makes a claim about the task as a whole simply by
    // being where it is. Borrowing the row's occurrence-level treatment put a
    // struck-through, dimmed card inside the **Open** column — two channels
    // contradicting each other, in the one layout where position is a
    // statement. Rendering it made that obvious; it is visible in
    // `board.{light,dark}.png` before this change, on *Take vitamins*.
    //
    // So the channels are split by what they are about:
    //
    // | channel | question | source |
    // |---|---|---|
    // | strikethrough, dimmed marks | is the **task** finished? | `task.status` |
    // | checkbox fill | is the **occurrence** done? | `row.isCompleted` |
    //
    // The checkbox keeps the occurrence, and it must: the gesture targets the
    // occurrence, and `TaskCheckbox` already speaks *"occurrence of …"* as its
    // value. A ticked checkbox on an un-struck card inside Open is then the
    // honest reading — *today is done, the task is not* — rather than a
    // contradiction.
    //
    // ⚠️ **The rejected alternative was to file such a card under Done**, and
    // it is worth recording why it is not merely a matter of taste. The board
    // dispatches `setStatus` on a drop, and `KanbanBoardTests` pins that every
    // card's column equals its status — there is no default column precisely
    // because the status is a closed enum. A card shown in Done whose status
    // is `open` would break that invariant, make dragging it out write a field
    // it never had, and — worst — the card would **move itself back to Open
    // overnight**, when the rule's next occurrence comes due and nobody
    // touched anything.
    //
    // Both predicates now live on `TaskRowState`, below the SwiftUI line,
    // where a headless test can pin them and their relationship. This comment
    // records the *choice between them*, which is a property of this screen and
    // belongs with the screen.

    /// The date's colour, and the one place red appears on a card.
    ///
    /// A finished task cannot be late, so its date is never red however far
    /// past it is. Keyed on ``TaskRowState/isTerminal`` for the same reason the
    /// strikethrough is: a recurring task whose current occurrence is done is
    /// still live, and its next occurrence can genuinely be overdue.
    private func dateTint(_ date: DateBadge) -> AnyShapeStyle {
        guard date.isOverdue, !row.isTerminal else { return AnyShapeStyle(.secondary) }
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
        // The same split the drawing makes, said in words. "Completed" is the
        // task, and it has the strikethrough as its visible counterpart; "this
        // occurrence is done" is the checkbox, and has the tick. Saying only
        // "completed" for a live recurring task would tell a VoiceOver reader
        // the opposite of what the column beside it says.
        if row.isTerminal {
            // The core's own label, lowercased into the sentence — so a
            // cancelled task is announced as "cancelled" rather than as
            // "completed", which is what a hard-coded word got wrong. It is
            // also one less piece of vocabulary this shell invents for a
            // status the core already names, and it keeps the board and the
            // list row saying the same words for the same state.
            parts.append(taskStatusLabel(status: row.task.status).lowercased())
        } else if row.isCompleted {
            parts.append("this occurrence is done")
        }
        if let priority = PriorityMarker.spoken(row.task.priority) { parts.append(priority) }
        if row.isRecurring { parts.append("repeats") }
        if !row.isTerminal, row.displayDate?.isOverdue == true { parts.append("overdue") }
        // `spokenDate`, the row's own clause: the card's label is the row's
        // label plus a column, so the date is named by the same field here as
        // there.
        if let date = row.spokenDate { parts.append(date) }
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
