internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

/// One status, and the cards in it.
///
/// ## Why the cards sit in a `List`
///
/// A column is a scrolling list of rows, and on macOS that means `NSTableView`
/// or it means giving up momentum scrolling, rubber-banding, live scroll bars,
/// Page Up/Down, Home/End, arrow-key navigation, and the de-emphasized
/// selection every other list in this app gets on focus loss. A `LazyVStack` in
/// a `ScrollView` would have been simpler to write and would have silently lost
/// all of it — and the arrow keys in particular are half of the keyboard story
/// this board owes: **select a card with the arrows, move it with `⌃⌘←/→`**.
///
/// All six columns bind to **one** selection. Clicking in a second column
/// deselects the first by construction, because the id it now holds is not in
/// the first column's data. That is what makes "the selected card" a
/// board-level idea the menu bar can act on, rather than six independent ones.
///
/// ## The drop target is the whole column, and also every card in it
///
/// Two destinations, deliberately. `List` is an `NSTableView` and takes its own
/// interest in drags over its rows, so a drop destination on the column
/// container alone would work over the header and the padding and be unreliable
/// over the cards — which is most of a full column's area. Attaching one to
/// each card as well means the entire column is live: dropping on a card means
/// *this card's column*, which is the reading a user already has.
struct KanbanColumnView: View {
    let column: KanbanColumn

    /// The whole board, for the move targets a card's menu offers.
    let board: KanbanBoard

    @Binding var selection: TaskId?

    let onToggle: (TaskRowState) -> Void
    let onMove: (TaskId, TaskStatus) -> Void
    let onDelete: (TaskId) -> Void

    /// Whether a drag is currently over this column.
    @State private var isTargeted = false

    /// A column is wide enough for a two-line title at the app's body size and
    /// narrow enough that four of them fit a default window. The React Native
    /// column is 260; the extra 20 buys the date and the metadata a line they
    /// do not have to truncate.
    static let width: CGFloat = 280

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            cards
        }
        .frame(width: Self.width)
        .background(.quinary, in: .rect(cornerRadius: 10))
        .overlay {
            // The drop affordance. Accent colour rather than a literal, so it
            // is the user's own highlight colour and tracks appearance and
            // Increase Contrast like everything else here.
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(Color.accentColor, lineWidth: 2)
                .opacity(isTargeted ? 1 : 0)
        }
        .animation(.snappy(duration: 0.12), value: isTargeted)
        .dropDestination(for: TaskId.self) { ids, _ in
            accept(ids)
        } isTargeted: {
            isTargeted = $0
        }
        // ⚠️ `.contain`. A column is a header plus a `List` of cards, each with
        // its own identifier, its own checkbox and its own move menu — the
        // keyboard and VoiceOver route to a move. `.combine` would take all of
        // them. The label is the column's name only; its count is already
        // spoken by the header inside it, and saying it twice is the defect
        // this app hides row metadata to avoid.
        .accessibilityElement(children: .contain)
        .accessibilityLabel(column.title)
        .accessibilityIdentifier(AccessibilityIdentifier.Board.column(column.id))
    }

    private var header: some View {
        HStack(spacing: 6) {
            Text(column.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(headingTint)
            Spacer(minLength: 4)
            Text("\(column.count)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .padding(.horizontal, 6)
                .padding(.vertical, 1)
                .background(.quaternary, in: .capsule)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AccessibilityIdentifier.Board.columnHeader(column.id))
        .accessibilityLabel("\(column.title), \(countLabel)")
    }

    @ViewBuilder
    private var cards: some View {
        if column.isEmpty {
            // Present, empty, and still a drop target — the whole column is
            // one. Said in words rather than as a dashed outline, because an
            // outline that only means something mid-drag says nothing the rest
            // of the time.
            VStack {
                Spacer()
                Text("Nothing here")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    // The words are carried by this container's own label
                    // instead. Kept `.tertiary` on purpose — a placeholder that
                    // looked like a card would read as a card — and stating it
                    // once means the de-emphasis costs a reader nothing.
                    .accessibilityHidden(true)
                Spacer()
            }
            .frame(maxWidth: .infinity)
            .contentShape(.rect)
            // `.combine`, not `.contain`: an empty column is one word and a
            // drop target, with nothing inside to keep addressable.
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Nothing here")
            .accessibilityIdentifier(AccessibilityIdentifier.Board.columnEmpty(column.id))
        } else {
            List(selection: $selection) {
                ForEach(column.rows) { row in
                    KanbanCardView(
                        row: row,
                        moveTargets: board.moveTargets(for: row.id),
                        onToggle: { onToggle(row) },
                        onMove: { onMove(row.id, $0) },
                        onDelete: { onDelete(row.id) },
                        columnTitle: column.title
                    )
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 3, leading: 8, bottom: 3, trailing: 8))
                    .dropDestination(for: TaskId.self) { ids, _ in
                        accept(ids)
                    }
                    .tag(row.id)
                }
            }
            .listStyle(.plain)
            // The column already draws the surface; without this the list
            // paints its own over the top and the rounded corners disappear.
            .scrollContentBackground(.hidden)
        }
    }

    /// Take a drop, or refuse it.
    ///
    /// Returns `false` for anything this board cannot move — an id it does not
    /// hold, or a card already in this column — which is how the system draws
    /// its own "not accepted" snap-back. That is the platform saying no, and it
    /// is better than accepting the drop and silently doing nothing.
    ///
    /// ⚠️ The payload is a plain task id, so a text drag from another
    /// application can land here. It is *validated against the board's own
    /// cards*, not trusted: a dropped string that is not a card on this board is
    /// refused. That is boundary input handled at the boundary, not a fallback.
    private func accept(_ ids: [TaskId]) -> Bool {
        var moved = false
        for id in ids where board.moveCommand(id, to: column.status) != nil {
            onMove(id, column.status)
            moved = true
        }
        return moved
    }

    private var countLabel: String {
        column.count == 1 ? "1 task" : "\(column.count) tasks"
    }

    /// A terminal column — Done, Cancelled — is where work leaves the board, so
    /// its heading sits one step back.
    ///
    /// That is the core's `task_status_is_active`, negated, rather than a list
    /// of "finished-ish" statuses restated in a view.
    private var headingTint: AnyShapeStyle {
        column.isTerminal ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary)
    }
}
