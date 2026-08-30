internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

// The inspector's rows, one type each. Split out of `TaskInspectorForm` because
// three of the four carry their own presentation state — a popover, an editing
// mode — and a form that owned all of it would have five booleans whose only
// relationship is that they happen to live in the same panel.

/// The completion control, at the top of the panel.
///
/// It dispatches ``TaskRowState/completionCommand``, which is the *same* value
/// the list row's checkbox uses. That sharing is the whole point rather than a
/// convenience: for a recurring task, completing marks the **scheduled
/// occurrence**, not the day of the click, and a rule that fires on the 1st
/// completed on the 12th must record `…-01`. Rebuilding that here would be a
/// second chance to get it wrong, and it was already a live bug once in the
/// React Native app.
struct CompletionRow: View {
    let row: TaskRowState
    let dispatch: (CommandInput) -> Void

    var body: some View {
        Button {
            dispatch(row.completionCommand)
        } label: {
            Label {
                Text(row.isCompleted ? "Completed" : "Mark as Completed")
            } icon: {
                // `.secondary` in both states, matching the list row's
                // checkbox: the control is a control, and dimming it when the
                // task is done makes the one thing you click to *undo* the
                // completion look disabled.
                Image(systemName: row.isCompleted ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(.secondary)
                    .contentTransition(.symbolEffect(.replace.downUp))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.toggle)
        .accessibilityAddTraits(.isToggle)
        .accessibilityValue(occurrenceDescription)
    }

    /// Which occurrence the control is talking about.
    ///
    /// The same words the panel prints, taken from the same badge, so the spoken
    /// reading and the drawn one are one sentence about one date.
    private var occurrenceDescription: String {
        guard let occurrence = row.occurrence else { return "" }
        return "occurrence of \(occurrence.text)"
    }
}

// The three list-of-names rows are ``TokenListField``, which owns its own
// caption. They are **not** `LabeledContent`, and that was measured rather than
// chosen: the trailing column of a labelled row in a ~340-point inspector is
// barely a hundred points wide, and a task with two projects rendered exactly
// one of them with no indication the other existed. A field that lies about a
// task's data is worse than one that is taller, so the label goes above and the
// tokens get the whole width to wrap into.

/// A date row — due or scheduled — over the shared scheduling popover.
///
/// The popover is the list's, reused verbatim rather than reimplemented: it
/// already resolves "this weekend" and "next week" through the core, where the
/// non-obvious readings live (this weekend is *today* when it is already
/// Saturday), and a second copy here would be a second opinion on those.
struct InspectorDateRow: View {
    let label: String
    let badge: DateBadge?
    let calendar: ViewerCalendar
    let identifier: String

    /// A resolved date, or `nil` to delete the frontmatter key.
    let onPick: (String?) -> Void

    /// A choice the core refused to resolve.
    let onFail: (CoreError) -> Void

    @State private var isPresented = false

    var body: some View {
        LabeledContent(label) {
            Button {
                isPresented = true
            } label: {
                HStack(spacing: 6) {
                    Text(badge?.text ?? "None")
                        .monospacedDigit()
                        // The panel's only red, and it means what it means
                        // everywhere else in this app: late. An absent date is
                        // tertiary rather than red — "no due date" is not a
                        // problem, it is the common case.
                        .foregroundStyle(tint)
                    Image(systemName: "calendar")
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.borderless)
            .accessibilityIdentifier(identifier)
            .accessibilityLabel("\(label): \(badge?.text ?? "none")")
            .popover(isPresented: $isPresented, arrowEdge: .bottom) {
                SchedulePopover(
                    current: badge?.date,
                    onChoose: choose,
                    onPick: { date in
                        isPresented = false
                        guard date != badge?.date else { return }
                        onPick(date)
                    }
                )
            }
        }
    }

    private var tint: AnyShapeStyle {
        guard let badge else { return AnyShapeStyle(.tertiary) }
        return badge.isOverdue ? AnyShapeStyle(.red) : AnyShapeStyle(.primary)
    }

    private func choose(_ choice: ScheduleChoice) {
        isPresented = false
        switch choice.resolving(on: calendar) {
        case .success(let date):
            guard date != badge?.date else { return }
            onPick(date)
        case .failure(let error): onFail(error)
        }
    }
}

/// The recurrence row and its common-pattern editing sheet.
///
/// Every description, parse decision and built rule comes from the shared
/// core. Swift owns only the controls and the explicit consent required before
/// replacing a stored rule that the common editor cannot preserve.
struct InspectorRecurrenceRow: View {
    let summary: RecurrenceSummary?
    let task: CoreTask
    let calendar: ViewerCalendar
    let apply: (TaskFieldEdit) -> Void
    let applyRecurrence: (TaskRecurrenceEdit) -> Void

    @State private var isPresented = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let summary {
                Text("Repeats")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(summary.description ?? summary.rule)
                    .font(
                        summary.description == nil
                            ? .system(.caption, design: .monospaced) : .caption
                    )
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if summary.editableDraft == nil, summary.description != nil {
                    Text(summary.rule)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if let caption = caption(summary) {
                    Text(caption)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if !summary.isExpandable {
                    Label("This rule cannot be read", systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Button(summary.editableDraft == nil ? "Replace Rule…" : "Edit Repeat…") {
                        isPresented = true
                    }
                    .accessibilityIdentifier(AccessibilityIdentifier.Inspector.recurrenceEdit)
                    Button("Stop Repeating") {
                        apply(RecurrenceSummary.stopRepeating)
                    }
                    .accessibilityIdentifier(AccessibilityIdentifier.Inspector.stopRepeating)
                }
            } else {
                LabeledContent("Repeats") {
                    Button("Never") { isPresented = true }
                        .buttonStyle(.borderless)
                        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.recurrenceEdit)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.recurrence)
        .sheet(isPresented: $isPresented) {
            RecurrenceEditorSheet(
                existingRule: summary?.rule,
                editableDraft: summary?.editableDraft,
                storedScheduled: task.scheduled,
                start: start,
                anchor: summary?.anchor ?? task.recurrenceAnchor ?? .scheduled,
                onApply: applyRecurrence
            )
        }
    }

    /// The count and the next occurrence, in words, or `nil` when the core
    /// answered neither.
    ///
    /// Both clauses restate something the core computed. "Next: Today" uses the
    /// badge's own words rather than a raw `2026-07-22`, so the panel and the
    /// list row say the same thing about the same date.
    ///
    /// The count is omitted entirely when the core has no number, rather than
    /// rendered as "Repeats indefinitely" — which contradicted the sentence
    /// directly above it for rules the summary can still describe. See
    /// ``RecurrenceSummary/occurrenceDescription``. A rule with no bound already
    /// says so by ending without a bound clause.
    ///
    /// `anchorIsImplied` is deliberately **not** shown. The picker directly
    /// below already displays the effective anchor, so a sentence saying
    /// "anchored to the scheduled date by default" restated the control beneath
    /// it in twice the space — and the effective behaviour is identical whether
    /// the key is stored or absent, so there is nothing for a reader to act on.
    /// The flag stays on ``RecurrenceSummary`` because the *core's* reading of
    /// an absent anchor is worth pinning in a test.
    private func caption(_ summary: RecurrenceSummary) -> String? {
        var parts: [String] = []
        if let occurrences = summary.occurrenceDescription {
            parts.append(occurrences)
        }
        if let next = summary.next {
            parts.append("Next: \(next.text)")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var start: String { task.scheduled.map { String($0.prefix(10)) } ?? calendar.today }
}

/// The note body: rendered markdown, or the source that produced it.
///
/// **Plain-text editing of markdown source, rendered read-only** — the same
/// thing the React Native app does, and the reason macOS 15 costs nothing here.
/// There is no WYSIWYG, so the rich `TextEditor` that would need macOS 26 buys
/// nothing.
///
/// The two modes are an explicit toggle rather than click-to-edit. Click-to-edit
/// reads well in Notes, where the rendered and edited forms look nearly the
/// same; here they do not — clicking a heading would replace it with `## `, and
/// a user who did not mean to edit has no idea what happened.
struct InspectorDetailsSection: View {
    let detail: TaskDetail
    @Binding var source: String
    @State private var isEditing: Bool
    let onCommit: () -> Void

    init(detail: TaskDetail, source: Binding<String>, onCommit: @escaping () -> Void) {
        self.detail = detail
        _source = source
        // An empty body opens in the editor and a written one opens rendered.
        // Always opening rendered would make the first thing a user sees on an
        // empty note a blank area with no visible way in.
        _isEditing = State(initialValue: (detail.task.details ?? "").isEmpty)
        self.onCommit = onCommit
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Spacer()
                Button(isEditing ? "Done" : "Edit") {
                    if isEditing { onCommit() }
                    isEditing.toggle()
                }
                .buttonStyle(.borderless)
                .font(.caption)
                .accessibilityIdentifier(AccessibilityIdentifier.Inspector.detailsMode)
            }

            if isEditing {
                MarkdownSourceEditor(text: $source, onCommit: onCommit)
                    .frame(minHeight: 140)
                    // A visible edge, because the editor draws its own
                    // `textBackgroundColor` — which inside a grouped form
                    // section is a white slab with no boundary, and reads as a
                    // rendering glitch rather than as a field.
                    .clipShape(.rect(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(.quaternary))
                    .accessibilityIdentifier(AccessibilityIdentifier.Inspector.detailsSource)
                    .accessibilityLabel("Note body, markdown source")
            } else if detail.body.isEmpty {
                Text("No details")
                    .font(.callout)
                    .foregroundStyle(.tertiary)
                    .accessibilityIdentifier(AccessibilityIdentifier.Inspector.details)
            } else {
                MarkdownBodyView(detail.body)
                    .accessibilityIdentifier(AccessibilityIdentifier.Inspector.details)
                    .accessibilityLabel("Note body")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
