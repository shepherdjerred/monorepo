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
///
/// The three that do hold one hold an ``EditedText`` rather than a `String`,
/// because a buffer that cannot say whether the user typed into it commits
/// itself over an edit that arrived while the panel was open. That is the whole
/// of why the type exists; its own documentation has the reasoning.
struct TaskInspectorForm: View {
    let detail: TaskDetail
    let vocabulary: TaskVocabulary

    /// Record a field change.
    let apply: (TaskFieldEdit) -> Void

    /// Record a field change that may be a no-op or a validation failure, and
    /// answer whether the core is now holding it.
    ///
    /// `true` for a recorded mutation and for a commit that turned out to be a
    /// no-op; `false` for a validation failure and for an enqueue that did not
    /// land. Only the buffered text fields read it — everything else is bound
    /// straight through and has no baseline to advance.
    let attempt: (Result<TaskFieldEdit?, CoreError>) async -> Bool

    /// Record something that is not a field edit — a completion, a deletion.
    let dispatch: (CommandInput) -> Void

    @State private var title: EditedText
    @State private var estimate: EditedText
    @State private var details: EditedText
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
        attempt: @escaping (Result<TaskFieldEdit?, CoreError>) async -> Bool,
        dispatch: @escaping (CommandInput) -> Void
    ) {
        self.detail = detail
        self.vocabulary = vocabulary
        self.apply = apply
        self.attempt = attempt
        self.dispatch = dispatch
        _title = State(initialValue: EditedText(stored: detail.task.title))
        _estimate = State(
            initialValue: EditedText(stored: TaskTextEdit.estimateText(of: detail.task)))
        _details = State(initialValue: EditedText(stored: detail.task.details ?? ""))
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
                    onFail: report
                )
                InspectorDateRow(
                    label: "Scheduled",
                    badge: detail.scheduled,
                    calendar: detail.calendar,
                    identifier: AccessibilityIdentifier.Inspector.scheduled,
                    onPick: { apply(.scheduled($0)) },
                    onFail: report
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
                    source: $details.text,
                    isEditing: $isEditingDetails,
                    onCommit: committing(commitDetails)
                )
            }
        }
        .formStyle(.grouped)
        // Take what arrived under the panel — a pull, a queued command
        // draining, an edit made in Obsidian — into every field nobody is
        // editing. Without this the buffers only reseed when the *task* changes
        // and `.id(detail.id)` rebuilds the form, so a refreshed title sat
        // behind a stale buffer that the next commit would write back over it.
        .onChange(of: detail.task.title) { _, stored in title.refresh(stored: stored) }
        .onChange(of: detail.task.timeEstimate) { _, _ in
            estimate.refresh(stored: TaskTextEdit.estimateText(of: detail.task))
        }
        .onChange(of: detail.task.details) { _, stored in
            details.refresh(stored: stored ?? "")
        }
        // Committing on disappear as well as on blur is not belt-and-braces: a
        // panel closed with ⌥⌘I while a field still has focus never fires a
        // blur, and the edit would be lost with no indication it had been.
        .onDisappear(perform: committing(commitText))
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
            text: $title.text,
            prompt: "Title",
            onSubmit: committing(commitTitle),
            // Escape restores what is stored rather than committing. The field
            // is the one place in this panel where "never mind" has to mean
            // something, because it is the only field that can be made invalid.
            onCancel: { title.revert(to: detail.task.title) },
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
            if previous == .title { _Concurrency.Task { await commitTitle() } }
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
                    text: $estimate.text,
                    prompt: "—",
                    onSubmit: committing(commitEstimate),
                    onCancel: { estimate.revert(to: TaskTextEdit.estimateText(of: detail.task)) }
                )
                .help("Whole minutes")
                .focused($focus, equals: .estimate)
                .onChange(of: focus) { previous, _ in
                    if previous == .estimate { _Concurrency.Task { await commitEstimate() } }
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

    /// Surface a failure that never had an edit behind it.
    ///
    /// The date pickers can only fail — a date the core refuses never becomes a
    /// command — so there is no baseline waiting on the answer.
    private func report(_ error: CoreError) {
        _Concurrency.Task { _ = await attempt(.failure(error)) }
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

    /// Offer a buffered field to the core, if the user put anything in it.
    ///
    /// ⚠️ **The `isEdited` guard is the load-bearing half, not the `nil` each
    /// rule already answers for an unchanged value.** Comparing the buffer
    /// against the task only says the two differ; it cannot say *which* is the
    /// newer, and for a field that was refreshed under an open panel the answer
    /// is the task. Committing on difference alone therefore wrote the buffer
    /// the panel opened with back over an edit that arrived while it was open.
    ///
    /// The baseline is only advanced when the core actually took the value, so
    /// a refused title or a mistyped estimate stays an edit rather than being
    /// adopted and forgotten.
    ///
    /// ⚠️ **Validation succeeding is not the value being recorded, and the
    /// baseline waits for the second one.** ``TaskTextEdit`` answers
    /// synchronously, but the write it authorises is not: the enqueue runs on
    /// the engine's queue and the id-counter and queue writes under it can
    /// fail. Advancing on the validation left the field *clean* over text the
    /// core never took — closing the panel then found nothing to retry, and the
    /// next refresh replaced what the user typed with the stored value. The
    /// baseline becomes the text that was **offered**, so anything typed during
    /// the round trip is still an edit.
    private func commitTitle() async {
        guard title.isEdited else { return }
        let offered = title.text
        if await attempt(TaskTextEdit.retitling(offered, of: detail.task)) {
            title.commit(offered)
        }
    }

    private func commitEstimate() async {
        guard estimate.isEdited else { return }
        let offered = estimate.text
        if await attempt(TaskTextEdit.estimating(offered, of: detail.task)) {
            estimate.commit(offered)
        }
    }

    private func commitDetails() async {
        guard details.isEdited else { return }
        let offered = details.text
        if await attempt(.success(TaskTextEdit.rewriting(details: offered, of: detail.task))) {
            details.commit(offered)
        }
    }

    /// Commit every buffered field, one after another.
    ///
    /// Safe to call unconditionally: each one is a no-op for a field the user
    /// did not edit. Sequential rather than concurrent so a panel closed with
    /// three edits in it enqueues them in the order they appear.
    private func commitText() async {
        await commitTitle()
        await commitEstimate()
        await commitDetails()
    }

    /// Drive an awaited commit from one of SwiftUI's synchronous callbacks.
    ///
    /// Blur, Return, and disappear are all `() -> Void`, and the commit they
    /// start now outlives them.
    private func committing(_ commit: @escaping () async -> Void) -> () -> Void {
        { _Concurrency.Task { await commit() } }
    }
}
