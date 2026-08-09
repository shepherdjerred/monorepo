internal import SwiftUI
internal import TaskNotesKit
internal import TaskNotesUniFFI

/// The editable fields, for exactly one task.
///
/// ## Commit per field. There is no Save button, and that is the safe design
///
/// The React Native form stages every field and writes them all on Save, which
/// is right for a modal screen you push and pop. An inspector is not that: it is
/// always there, it tracks the selection, and the platform's own inspectors —
/// Xcode's, Pages', Get Info — commit as you go. A Save button here would also
/// have to answer "what happens when you click another task with unsaved
/// edits", and every answer to that is bad.
///
/// It is also the **safer** shape, for a reason specific to this core. A staged
/// form sends one payload naming every field, so each field the user never
/// opened has to be spelled `unchanged` — and a single mistake there sends
/// `null`, which *deletes* that frontmatter key. Committing one field at a time
/// means every payload has exactly one non-`unchanged` entry and the rest are
/// `unchanged` by construction, because ``UpdateTaskRequest/untouched`` is the
/// only base any of them is built from. The failure mode is removed rather than
/// guarded against.
///
/// ## Where the local state is, and where it deliberately is not
///
/// Only the three free-text fields hold a buffer, because typing cannot dispatch
/// per keystroke. Everything else — status, priority, both dates, all three
/// token lists, the anchor — is bound straight through to the task and
/// dispatches on change, so what is on screen is always the core's own
/// optimistic answer rather than a second copy of it that could drift.
struct TaskInspectorForm: View {
    let detail: TaskDetail
    let vocabulary: TaskVocabulary

    /// Record a field change.
    let apply: (TaskFieldEdit) -> Void

    /// Record a field change that may be a no-op or a validation failure.
    let attempt: (Result<TaskFieldEdit?, CoreError>) -> Void

    /// Record something that is not a field edit — a completion, a deletion.
    let dispatch: (CommandInput) -> Void

    @State private var title: String
    @State private var estimate: String
    @State private var details: String
    @State private var isEditingDetails: Bool

    @FocusState private var focus: Field?

    /// The fields that can hold focus, so losing it can be detected per field.
    ///
    /// Blur is the commit point for a text field, and `@FocusState` over an
    /// enum is the only way to tell "focus left the title" from "focus left the
    /// panel entirely" — which have to commit the same way but must not commit
    /// each other.
    private enum Field: Hashable {
        case title
        case estimate
    }

    init(
        detail: TaskDetail,
        vocabulary: TaskVocabulary,
        apply: @escaping (TaskFieldEdit) -> Void,
        attempt: @escaping (Result<TaskFieldEdit?, CoreError>) -> Void,
        dispatch: @escaping (CommandInput) -> Void
    ) {
        self.detail = detail
        self.vocabulary = vocabulary
        self.apply = apply
        self.attempt = attempt
        self.dispatch = dispatch
        _title = State(initialValue: detail.task.title)
        _estimate = State(initialValue: TaskTextEdit.estimateText(of: detail.task))
        _details = State(initialValue: detail.task.details ?? "")
        // An empty body opens in the editor and a written one opens rendered.
        // The alternative — always opening rendered — makes the first thing a
        // user sees on an empty note a blank area with no visible way in.
        _isEditingDetails = State(initialValue: (detail.task.details ?? "").isEmpty)
    }

    var body: some View {
        Form {
            Section {
                CompletionRow(row: detail.row, dispatch: dispatch)
                titleField
            }

            Section("Status") {
                statusPicker
                priorityPicker
            }

            Section("Dates") {
                InspectorDateRow(
                    label: "Due",
                    badge: detail.due,
                    calendar: detail.calendar,
                    identifier: AccessibilityIdentifier.Inspector.due,
                    onPick: { apply(.due($0)) },
                    onFail: { attempt(.failure($0)) }
                )
                InspectorDateRow(
                    label: "Scheduled",
                    badge: detail.scheduled,
                    calendar: detail.calendar,
                    identifier: AccessibilityIdentifier.Inspector.scheduled,
                    onPick: { apply(.scheduled($0)) },
                    onFail: { attempt(.failure($0)) }
                )
                InspectorRecurrenceRow(summary: detail.recurrence, apply: apply)
            }

            Section("Organize") {
                TokenListField(
                    label: "Projects",
                    identifier: AccessibilityIdentifier.Inspector.projects,
                    values: detail.task.projects,
                    vocabulary: vocabulary.projects,
                    // The core's, because a project is stored as either a
                    // wikilink or a bare name and turning one into the other is
                    // a rule both clients have to share.
                    display: { projectDisplayName(value: $0) },
                    // `projectMatches` and not `contains`: a wikilink covers its
                    // own display name, so plain equality would keep offering a
                    // project that is already attached under its other spelling.
                    isPresent: { name in
                        detail.task.projects.contains {
                            projectMatches(left: $0, right: name)
                        }
                    },
                    prompt: "Add project…",
                    // Same rule on the way in: `TaskVocabulary.adding` is what
                    // stops one project being added twice under two spellings.
                    onAdd: {
                        apply(
                            .projects(TaskVocabulary.adding(project: $0, to: detail.task.projects)))
                    },
                    onRemove: { apply(.projects($0)) }
                )
                TokenListField(
                    label: "Contexts",
                    identifier: AccessibilityIdentifier.Inspector.contexts,
                    values: detail.task.contexts,
                    vocabulary: vocabulary.contexts,
                    display: { "@\($0)" },
                    isPresent: { detail.task.contexts.contains($0) },
                    prompt: "Add context…",
                    onAdd: { apply(.contexts(appending($0, to: detail.task.contexts))) },
                    onRemove: { apply(.contexts($0)) }
                )
                TokenListField(
                    label: "Tags",
                    identifier: AccessibilityIdentifier.Inspector.tags,
                    values: detail.task.tags,
                    vocabulary: vocabulary.tags,
                    display: { "#\($0)" },
                    isPresent: { detail.task.tags.contains($0) },
                    prompt: "Add tag…",
                    onAdd: { apply(.tags(appending($0, to: detail.task.tags))) },
                    onRemove: { apply(.tags($0)) }
                )
            }

            Section("Effort") {
                estimateField
            }

            Section("Details") {
                InspectorDetailsSection(
                    detail: detail,
                    source: $details,
                    isEditing: $isEditingDetails,
                    onCommit: {
                        attempt(.success(TaskTextEdit.rewriting(details: details, of: detail.task)))
                    }
                )
            }
        }
        .formStyle(.grouped)
        // Committing on disappear as well as on blur is not belt-and-braces: a
        // panel closed with ⌥⌘I while a field still has focus never fires a
        // blur, and the edit would be lost with no indication it had been.
        .onDisappear { commitText() }
    }

    // ── Fields ─────────────────────────────────────────────────────────────

    /// The title, as a real `NSTextField` through ``PlainTextField``.
    ///
    /// Not a SwiftUI `TextField`: the definition of done asks for spellcheck,
    /// which is a property of the window's field editor and has no SwiftUI
    /// modifier on macOS. Everything else on that list — ⌃A/⌃E/⌃K/⌃Y, the
    /// Services menu, text drag-and-drop — comes from being a text field at all.
    private var titleField: some View {
        PlainTextField(
            text: $title,
            prompt: "Title",
            onSubmit: commitTitle,
            // Escape restores what is stored rather than committing. The field
            // is the one place in this panel where "never mind" has to mean
            // something, because it is the only field that can be made invalid.
            onCancel: { title = detail.task.title },
            // Wrapping, unlike the compose row. A ~340-point panel truncates a
            // real task title well before its end — `Reply to the landlord
            // about the boiler inspec…` hides the thing the reader opened the
            // inspector to see, and there is no gesture that reveals the rest.
            //
            // Return still submits: the field intercepts `insertNewline(_:)` so
            // "wraps" means the *display* wraps, not that this is a multi-line
            // editor. A literal newline in a title is a value the wire layer
            // carries happily and no list row can draw.
            wraps: true
        )
        .font(.title3)
        .focused($focus, equals: .title)
        .onChange(of: focus) { previous, _ in
            if previous == .title { commitTitle() }
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.title)
        .accessibilityLabel("Title")
    }

    /// Status, bound straight through.
    ///
    /// The core's list and the core's labels, in the core's order, so both
    /// clients offer the same options under the same names — and so a status
    /// added to the Rust enum appears here without anybody editing this file.
    private var statusPicker: some View {
        Picker("Status", selection: binding(detail.task.status, TaskFieldEdit.status)) {
            ForEach(taskStatusAll(), id: \.self) { status in
                Text(taskStatusLabel(status: status)).tag(status)
            }
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.status)
    }

    private var priorityPicker: some View {
        Picker("Priority", selection: binding(detail.task.priority, TaskFieldEdit.priority)) {
            ForEach(priorityAll(), id: \.self) { priority in
                Text(priorityLabel(priority: priority)).tag(priority)
            }
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.priority)
    }

    /// The time estimate, in whole minutes.
    ///
    /// Minutes in, words out: the caption beside it is the same number spelled
    /// by ``TaskDurationText``, so a user typing `90` sees "1 hr, 30 min" and
    /// learns the unit without a label that says "minutes" forever.
    ///
    /// The placeholder is an em dash rather than the word "Minutes" — which
    /// overflowed the field and read as a *value* sitting next to "No estimate",
    /// so the row said two contradictory things at once. The unit reaches a
    /// sighted reader through the caption and a VoiceOver user through the
    /// field's own label.
    private var estimateField: some View {
        LabeledContent("Estimate") {
            HStack(spacing: 8) {
                PlainTextField(
                    text: $estimate,
                    prompt: "—",
                    onSubmit: commitEstimate,
                    onCancel: { estimate = TaskTextEdit.estimateText(of: detail.task) }
                )
                .help("Whole minutes")
                .focused($focus, equals: .estimate)
                .onChange(of: focus) { previous, _ in
                    if previous == .estimate { commitEstimate() }
                }
                .frame(width: 72)
                .accessibilityIdentifier(AccessibilityIdentifier.Inspector.timeEstimate)
                .accessibilityLabel("Time estimate in minutes")

                Text(detail.timeEstimateText ?? "No estimate")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
        }
    }

    /// A name added to a list, unless it is already there.
    ///
    /// ⚠️ The result is always the **whole** list, because the update field is a
    /// plain optional array: `nil` means unchanged and `[]` means the empty
    /// list, which is the exact inverse of the clearable fields above.
    private func appending(_ value: String, to current: [String]) -> [String] {
        current.contains(value) ? current : current + [value]
    }

    // ── Commits ────────────────────────────────────────────────────────────

    /// A binding that dispatches instead of storing.
    ///
    /// The getter reads the task the core last handed back, so the control shows
    /// the optimistic result of the previous edit rather than a local copy that
    /// could drift from it. The setter never writes anywhere — it produces a
    /// command, which is the only way state changes in this app.
    private func binding<Value>(
        _ current: Value,
        _ edit: @escaping (Value) -> TaskFieldEdit
    ) -> Binding<Value> {
        Binding(get: { current }, set: { apply(edit($0)) })
    }

    private func commitTitle() {
        attempt(TaskTextEdit.retitling(title, of: detail.task))
    }

    private func commitEstimate() {
        attempt(TaskTextEdit.estimating(estimate, of: detail.task))
    }

    /// Commit every buffered field.
    ///
    /// Each one answers `nil` when it matches what is stored, so this is safe to
    /// call unconditionally — it dispatches only for fields that actually
    /// changed.
    private func commitText() {
        commitTitle()
        commitEstimate()
        attempt(.success(TaskTextEdit.rewriting(details: details, of: detail.task)))
    }
}
