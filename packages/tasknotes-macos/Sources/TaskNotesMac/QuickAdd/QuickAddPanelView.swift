internal import KeyboardShortcuts
internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

/// What the floating panel shows: one field, and what the core made of it.
///
/// Three lines, and the middle one is the reason the panel is worth building
/// rather than reusing the list screens' compose row. That row can stay silent
/// about what it parsed, because the task appears in the list behind it a moment
/// later. This one cannot: it closes on Return, over an application that is not
/// TaskNotes, and the created task is then never seen. The preview strip is the
/// only feedback there is.
struct QuickAddPanelView: View {
    @Bindable var controller: QuickAddPanelController

    @FocusState private var isFieldFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            field
            Divider()
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        // A material rather than a colour, for the same reason the sync banner
        // uses one: this window floats over an arbitrary application, so it has
        // to sit correctly against whatever is behind it and follow the system
        // appearance with no toggle of its own.
        .background(.regularMaterial)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.panel)
        .accessibilityLabel("Quick Add")
        // `.task(id:)` rather than `.onAppear`: the panel and its hosting view
        // are built once and reused, so `onAppear` fires exactly once in the
        // app's life and every summoning after the first would have no caret.
        .task(id: controller.focusToken) { isFieldFocused = true }
    }

    // ── The field ──────────────────────────────────────────────────────────

    @ViewBuilder
    private var field: some View {
        HStack(spacing: 12) {
            Image(systemName: "plus.circle.fill")
                .font(.title2)
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            PlainTextField(
                text: $controller.text,
                prompt: "Add a task — try “pay rent tomorrow !high p:Home”",
                onSubmit: controller.submit,
                onCancel: controller.dismiss
            )
            .focused($isFieldFocused)
            .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.field)
            .accessibilityLabel("New task")
            // A reported submission failure is about the line that was in the
            // field when Return was pressed. Editing it makes the report stale,
            // and a stale report holding the strip would hide the marks for the
            // line being typed now.
            .onChange(of: controller.text) { controller.clearSubmissionFailure() }
        }
        .padding(.horizontal, 18)
        .frame(height: 56)
    }

    // ── What the core understood ───────────────────────────────────────────

    /// The preview strip, the failure, or the key hint — always exactly one, and
    /// always the same height.
    ///
    /// Fixed height on purpose. A strip that appeared as soon as a token was
    /// recognised would resize a floating window under the user's hands while
    /// they typed, which is the one thing a window over somebody else's app must
    /// not do.
    ///
    /// A refused submission outranks the preview. The line is still in the field
    /// precisely because it was not created, and "what the core understood" is
    /// the wrong answer to a Return that did nothing.
    @ViewBuilder
    private var footer: some View {
        Group {
            if let refusal = controller.submissionFailure {
                failure(refusal)
            } else {
                switch controller.preview {
                case .none:
                    unavailable
                case .some(.success(let preview)):
                    if preview.marks.isEmpty {
                        hint(preview)
                    } else {
                        marks(preview)
                    }
                case .some(.failure(let error)):
                    failure(error)
                }
            }
        }
        .padding(.horizontal, 18)
        .frame(height: 40, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func marks(_ preview: QuickAddPreview) -> some View {
        HStack(spacing: 6) {
            ForEach(preview.marks) { mark in
                QuickAddMarkView(mark: mark)
            }
            Spacer(minLength: 8)
            keys(canAdd: preview.isSubmittable)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.preview)
        // ⚠️ `.contain` makes this container a real element in the tree, and an
        // unlabelled container is a container VoiceOver announces as nothing.
        // Found by `performAccessibilityAudit()` on the flow that opens the
        // panel — "Element has no description", against a bare `Group`. The
        // marks inside carry their own spoken labels; this names the group they
        // belong to.
        .accessibilityLabel("Recognised details")
    }

    /// What the panel says before anything has been recognised.
    ///
    /// The syntax, stated once, in the one place somebody is looking while they
    /// learn it. It is replaced by the marks the moment the core recognises
    /// something, so it is a lesson rather than furniture.
    ///
    /// An earlier draft said "No date, project, or priority recognised" once
    /// there was a title but no tokens. Rendered, it reads as a complaint about
    /// a perfectly good task — and it is redundant, because the absence of chips
    /// already says it. Showing what *could* be added is the useful half, and
    /// the moment somebody is typing a plain title is exactly when it lands.
    private func hint(_ preview: QuickAddPreview) -> some View {
        HStack(spacing: 6) {
            Text(syntax)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer(minLength: 8)
            keys(canAdd: preview.isSubmittable)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.hint)
        // `.combine` rather than `.contain`: the syntax line and the key
        // reminder are one piece of prose to a screen reader, not two elements
        // worth stepping through.
        .accessibilityLabel("Syntax: \(syntax)")
    }

    private func failure(_ error: CoreError) -> some View {
        Label(error.userMessage, systemImage: "exclamationmark.triangle.fill")
            .font(.caption)
            // The one tone in this app that means "yours to fix", and the same
            // orange the sync banner spends on it. Red is *late* and nothing
            // else, everywhere in this app.
            .foregroundStyle(.orange)
            .lineLimit(1)
            .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.preview)
    }

    private var unavailable: some View {
        Label("TaskNotes cannot reach its stored data.", systemImage: "externaldrive.badge.xmark")
            .font(.caption)
            .foregroundStyle(.orange)
            .lineLimit(1)
            .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.preview)
    }

    /// The two keys the panel answers to.
    ///
    /// Spelled out because this window has no buttons: a panel summoned by a
    /// hotkey over another application has to say how to commit and how to
    /// leave, and a **Create** button would be a mouse trip for something the
    /// user's hands are already on the keyboard for.
    ///
    /// ⚠️ `canAdd` is not cosmetic. `!high @errands` parses into two marks and
    /// **no title**, so Return does nothing — and a line still reading "Return
    /// to add" beside two confident-looking chips is the panel lying about what
    /// it is about to do. Rendering that state is what found it.
    private func keys(canAdd: Bool) -> some View {
        // Words, not glyphs — and that is a fix rather than a preference. Both
        // `⏎`/`⎋` in a text font and the `return`/`escape` SF Symbols were
        // rendered first: at caption size the escape mark is an unreadable
        // smudge in either form, which turns the one line telling somebody how
        // to close a floating window into decoration.
        Text(canAdd ? "Return to add  ·  Esc to close" : "Add a title  ·  Esc to close")
            .font(.caption)
            .foregroundStyle(.tertiary)
            .fixedSize()
            .accessibilityHidden(true)
    }

    private var syntax: String {
        "!priority  ·  p:Project  ·  @context  ·  #tag  ·  a date"
    }
}

/// One thing the core recognised, as a chip.
///
/// Priority draws the row's own ``PriorityMarker`` rather than a glyph of its
/// own, which is what keeps one vocabulary across the app: a `!!` in the panel
/// and a `!!` on the task's row afterwards are the same mark, and priority is
/// never a colour in either place.
private struct QuickAddMarkView: View {
    let mark: QuickAddMark

    var body: some View {
        HStack(spacing: 3) {
            switch mark.kind {
            case .priority(let priority):
                PriorityMarker(priority: priority)
            case .due(let badge):
                Image(systemName: mark.systemImage ?? "calendar")
                    .font(.caption2)
                    // Red is late, and only late. A due date the core bucketed
                    // as overdue is the one thing in this panel that gets it.
                    .foregroundStyle(
                        badge.isOverdue ? AnyShapeStyle(.red) : AnyShapeStyle(.secondary))
            case .project, .context, .tag, .recurrence:
                if let symbol = mark.systemImage {
                    Image(systemName: symbol)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Text(mark.text)
                .font(.caption)
                .foregroundStyle(isLate ? AnyShapeStyle(.red) : AnyShapeStyle(.primary))
                .lineLimit(1)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(.quaternary, in: .capsule)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.mark(mark.text))
        .accessibilityLabel(mark.spoken)
    }

    private var isLate: Bool {
        switch mark.kind {
        case .due(let badge): badge.isOverdue
        case .priority, .project, .context, .tag, .recurrence: false
        }
    }
}
