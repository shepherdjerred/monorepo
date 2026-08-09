internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

/// One task, as a row. The same row on all four list screens.
///
/// ## One line, and why the reserved second line went away
///
/// The Phase 8 row reserved a second caption line whether or not the task had a
/// project or a context, buying an even row rhythm at the price of a visible
/// ~14pt void under every unadorned task. That trade was defensible on Today.
/// It is not defensible across fifteen screens, and **Inbox settles it**: Inbox
/// is *defined* as tasks with no project and no context, so every row on that
/// screen would have reserved a second line that could never be filled. A
/// layout whose one benefit is uniformity, applied to a screen where it is
/// uniformly empty, is just a taller list.
///
/// So the row is one line and the metadata trails the title, in the same
/// direction the priority and repeat marks already trail it. That also fixes
/// the complaint the reserved line was introduced to answer, better than it
/// did: what makes a list scannable is a **constant title baseline**, and a
/// single-line row gives that exactly, whereas a two-line row put the title at
/// the top of a tall box and left the eye re-finding it.
///
/// The metadata yields before the title does — `layoutPriority` says so — so a
/// narrow window truncates *"Website · @work"* rather than the thing the row is
/// about.
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

    /// Whether the date column has anything left to say.
    ///
    /// `false` on a grouped screen when the row's date is the words its own
    /// section heading already prints. Upcoming put "Tomorrow" over a run of
    /// rows and then printed "Tomorrow" again on each of them, which is ink
    /// spent to repeat the heading — and the repetition made the two dates that
    /// *were* worth reading (a "Friday" under "This Week") harder to notice,
    /// because they sat in a column of noise.
    ///
    /// A parameter rather than a comparison made here: only the list knows what
    /// its heading says, and a row that guessed would be a second copy of the
    /// grouping rule.
    var showsDate: Bool = true

    @State private var isHovering = false
    @State private var isSchedulePresented = false

    /// The width the date column is pinned to.
    ///
    /// `monospacedDigit()` pins the digits and nothing else, so `Jun`, `Jul`,
    /// `Today` and `Wednesday` all measured differently and every date started
    /// at a different x — in the one column of the list that is read by
    /// scanning straight down it.
    ///
    /// The fix is a minimum width **plus leading alignment**, and the second
    /// half is the part that matters. Right-aligning inside a fixed column
    /// squares the *right* edge, which is conventional for numbers but wrong
    /// here: these are words as often as digits, and the edge a reader's eye
    /// follows down a column is the one each entry starts at. Leading alignment
    /// gives that; the ragged edge that remains is on the trailing side, facing
    /// the hover cluster, which is empty most of the time.
    ///
    /// A *minimum* rather than a fixed width so an outsized value — a long
    /// localized weekday — grows instead of clipping, which is the failure a
    /// hard width would have. `@ScaledMetric` so the column tracks Dynamic
    /// Type, where a date silently turning into `Wed…` would matter most.
    @ScaledMetric(relativeTo: .caption) private var dateColumnWidth: CGFloat = 74

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            TaskCheckbox(row: row, action: onToggle)

            // Annotations trail the title rather than leading it: a marker in
            // front would make every row's title start at a different x, and a
            // column of ragged title starts is harder to scan than the markers
            // are worth.
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(row.task.title)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    // Struck through and dimmed rather than removed: the row
                    // stays put so the completion is felt, which is the whole
                    // reason the Today filter keeps a checked recurring
                    // occurrence visible.
                    .strikethrough(row.isCompleted, color: .secondary)
                    .foregroundStyle(row.isCompleted ? .secondary : .primary)

                PriorityMarker(priority: row.task.priority, isDimmed: row.isCompleted)
                if row.isRecurring {
                    RecurrenceMarker(
                        occurrence: row.occurrence?.text, isDimmed: row.isCompleted)
                }
            }
            .layoutPriority(2)

            if let metadata {
                Text(metadata)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    // Below the title, above the spacer: a narrow window eats
                    // this before it eats what the task is called.
                    .layoutPriority(1)
                    // Spoken by the row's own label instead, so the row reads
                    // as one sentence rather than as a title interrupted by a
                    // list of tags.
                    .accessibilityHidden(true)
            }

            Spacer(minLength: 8)

            if row.isPending {
                // A straight arrow, not a circular one. See `SyncMessage`: this
                // app had three lookalike two-arrow circular glyphs, and a
                // recurring task waiting to sync drew two of them side by side.
                // Queued work goes *up* to the server; only retrying and
                // repeating go round.
                Image(systemName: "arrow.up.circle")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .help("Waiting to sync")
                    // Stated once, by the row's label. A decoration that is
                    // also its own VoiceOver stop makes the row take four
                    // swipes to say what it already said in one.
                    .accessibilityHidden(true)
            }

            // `displayDate`, not `due`: a recurring task is typically
            // `scheduled`-only, so a due-date badge left the date column empty
            // on exactly the rows whose date is the reason they are on screen.
            if showsDate, let date = row.displayDate {
                Text(date.text)
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(dateTint(date))
                    .fixedSize(horizontal: true, vertical: false)
                    .frame(minWidth: dateColumnWidth, alignment: .leading)
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

    /// The date's colour, and the one place red appears on a row.
    ///
    /// **Red means exactly one thing: late.** A completed task cannot be late,
    /// so a completed row's date is never red however far in the past it is —
    /// which is the same reasoning that dims the priority and repeat marks on a
    /// completed row, applied to the channel that carries the most weight.
    private func dateTint(_ date: DateBadge) -> AnyShapeStyle {
        guard date.isOverdue, !row.isCompleted else { return AnyShapeStyle(.secondary) }
        return AnyShapeStyle(.red)
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

    /// Projects and contexts, the two things worth trailing the title with.
    ///
    /// `projectDisplayName` is the core's, because a project is stored as
    /// either a wikilink or a bare name and turning one into the other is a
    /// rule both clients have to share.
    private var metadata: String? {
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
    /// mark without a clause — puts it straight back. It is also why the
    /// overdue clause is suppressed on a completed row: nothing is drawn red
    /// there, so nothing should be said.
    private var accessibilityLabel: String {
        var parts = ["Task: \(row.task.title)"]
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
                // One tint for both states, and shape carries the difference.
                //
                // It used to carry priority, which put a second meaning on the
                // one glyph whose job is already to say *done or not done* —
                // and put it in red, where it collided with the overdue date
                // text. Then the completed state was drawn at `.tertiary`,
                // which in dark mode left a grey check on a grey fill that was
                // hard to see at all. A filled circle with a check in it is
                // already unmistakably different from an empty circle, so the
                // tint has no work left to do and both states sit at the same
                // hierarchical step every other unfilled control on macOS uses.
                //
                // No hex literals anywhere in this app. Hierarchical styles and
                // `.red` and friends already track light and dark, Increase
                // Contrast, and the accessibility colour filters, which is
                // exactly what "semantic colours following system appearance"
                // asks for.
                .foregroundStyle(.secondary)
                .contentTransition(.symbolEffect(.replace.downUp))
        }
        .buttonStyle(.plain)
        .help(row.isCompleted ? "Mark as not completed" : "Mark as completed")
        .accessibilityIdentifier(AccessibilityIdentifier.TaskList.rowToggle(row.id))
        .accessibilityLabel(row.isCompleted ? "Completed" : "Not completed")
        .accessibilityValue(occurrenceDescription)
        .accessibilityAddTraits(.isToggle)
    }

    /// Which occurrence the control is talking about.
    ///
    /// Spoken, because for a recurring task it is genuinely ambiguous
    /// otherwise — the checkbox reflects one specific occurrence, which may be
    /// a date well in the past on Today or a date in the future on Upcoming,
    /// and a screen-reader user has no other way to know that.
    ///
    /// It says **the same words the row prints** rather than a raw
    /// `2026-07-22`. Both come from ``TaskRowState/occurrence``, so the sighted
    /// reading and the spoken one are the same sentence about the same date,
    /// and neither can be changed without the other.
    private var occurrenceDescription: String {
        guard let occurrence = row.occurrence else { return "" }
        return "occurrence of \(occurrence.text)"
    }
}
