import AppKit
import SwiftUI
import TaskNotesKit
import TaskNotesUniFFI
import Testing

@testable import TaskNotesMac

/// The inspector, rendered offscreen for human review.
///
/// Same posture as the list snapshots: not a regression gate, no golden files,
/// both appearances every time. What it produces is images a person reads —
/// which is the only way to catch the things that are wrong without being
/// incorrect, like a priority ramp that does not descend or a rule string that
/// overflows its row.
///
/// ## The form is rendered directly, and the panel is not
///
/// ``TaskInspector`` reads its subject from `@FocusedValue`, which an offscreen
/// `NSHostingView` with no key window cannot supply — so rendering it produces
/// the empty state and only ever the empty state. That is a real state and it is
/// captured here, but the populated cases go through ``TaskInspectorForm`` with
/// a `TaskDetail` built the way the panel builds one. Nothing is faked: the
/// detail comes from a real `TaskRowState` derived by the core against a pinned
/// calendar, so these are pictures of states the app can actually reach.
@Suite("The inspector, rendered offscreen", .serialized)
@MainActor
struct InspectorSnapshotTests {
    /// A task with something in every field.
    ///
    /// Its title is deliberately longer than a 340-point panel can hold on one
    /// line, so this is also the picture of the **wrapping** title field. That
    /// pairs with the compose row's snapshot, which covers the single-line path:
    /// between them both of `PlainTextField`'s modes have visual coverage, and an
    /// `NSViewRepresentable` that silently renders wrong is not a compiler error.
    @Test("the inspector, populated", arguments: SnapshotAppearance.allCases)
    func populated(appearance: SnapshotAppearance) throws {
        try record(
            form(for: InspectorFixtures.rich),
            named: "inspector-populated",
            size: Self.panelSize,
            appearance: appearance
        )
    }

    /// A repeating task, which is the case the recurrence row exists for — and
    /// the one where the read-only rule string is visible.
    @Test("the inspector, a recurring task", arguments: SnapshotAppearance.allCases)
    func recurring(appearance: SnapshotAppearance) throws {
        try record(
            form(for: InspectorFixtures.recurring),
            named: "inspector-recurring",
            size: Self.panelSize,
            appearance: appearance
        )
    }

    /// A task with nothing filled in.
    ///
    /// Worth its own image because it is what every newly created task looks
    /// like, and because it is where placeholder text either reads as an
    /// invitation or as an error.
    @Test("the inspector, a bare task", arguments: SnapshotAppearance.allCases)
    func bare(appearance: SnapshotAppearance) throws {
        try record(
            form(for: InspectorFixtures.bare),
            named: "inspector-bare",
            size: Self.panelSize,
            appearance: appearance
        )
    }

    /// Nothing selected — the resting state of an open panel.
    @Test("the inspector, nothing selected", arguments: SnapshotAppearance.allCases)
    func emptySelection(appearance: SnapshotAppearance) throws {
        let seeded = try SnapshotFixtures.populated()
        try record(
            TaskInspector(store: seeded.store),
            named: "inspector-empty",
            size: Self.panelSize,
            appearance: appearance
        )
    }

    /// The markdown renderer, over a document using every block it can draw.
    ///
    /// A renderer is only reviewable as a whole document. One image per block
    /// kind would not show that a heading sits too close to the paragraph above
    /// it, that a code block's inset does not match a quote's, or that a table's
    /// columns collapse in a 340-point panel — which are the three things most
    /// likely to be wrong.
    @Test("the rendered note body", arguments: SnapshotAppearance.allCases)
    func renderedBody(appearance: SnapshotAppearance) throws {
        let body = try MarkdownBody.of(source: InspectorFixtures.everyBlock)
        try record(
            ScrollView { MarkdownBodyView(body).padding(16) },
            named: "inspector-markdown",
            size: Self.bodySize,
            appearance: appearance
        )
    }

    /// The same note as editable source.
    ///
    /// The plain-text half of "plain-text editing of markdown source, rendered
    /// read-only". Worth an image because the monospaced source and the rendered
    /// output have to look like two views of one thing rather than two features.
    @Test("the markdown source editor", arguments: SnapshotAppearance.allCases)
    func sourceEditor(appearance: SnapshotAppearance) throws {
        try record(
            SourceEditorHarness(source: InspectorFixtures.everyBlock),
            named: "inspector-source",
            size: Self.bodySize,
            appearance: appearance
        )
    }

    /// A form for a task, built the way the panel builds one.
    private func form(for task: CoreTask) throws -> some View {
        let row = try TaskRowState(
            task: task,
            isPending: false,
            calendar: InspectorFixtures.calendar,
            text: TaskDateText(locale: Locale(identifier: "en_US"))
        )
        let detail = try TaskDetail.build(
            row: row,
            calendar: InspectorFixtures.calendar,
            text: TaskDateText(locale: Locale(identifier: "en_US")),
            duration: TaskDurationText(locale: Locale(identifier: "en_US"))
        )
        return TaskInspectorForm(
            detail: detail,
            vocabulary: TaskVocabulary.of(tasks: InspectorFixtures.vault),
            apply: { _ in },
            attempt: { _ in true },
            dispatch: { _ in }
        )
    }

    /// The panel at its ideal width, tall enough to show the whole form.
    private static let panelSize = CGSize(width: 340, height: 980)

    /// The note body at the same width.
    private static let bodySize = CGSize(width: 340, height: 560)
}

/// The source editor needs a binding, which a snapshot has nowhere to put.
private struct SourceEditorHarness: View {
    @State var source: String

    var body: some View {
        MarkdownSourceEditor(text: $source, onCommit: {})
            .padding(8)
    }
}

/// The tasks the inspector snapshots are rendered against.
///
/// Pinned exactly as the list fixtures are, and for the same reason: the instant
/// decides which dates are overdue, the offset decides which civil day a zoned
/// value lands on, and the locale decides the words. A snapshot reading any of
/// the three from the machine would render differently in Berlin and
/// differently tomorrow.
@MainActor
enum InspectorFixtures {
    /// 2026-07-22, a Wednesday, in America/Los_Angeles.
    static let calendar = ViewerCalendar(today: "2026-07-22", utcOffsetSeconds: -25_200)

    /// A task with something in every editable field, including an overdue due
    /// date so the panel's only red is on screen.
    static var rich: CoreTask {
        inspectorTask(
            id: "Tasks/Reply to the landlord.md",
            title: "Reply to the landlord about the boiler inspection window",
            status: .inProgress,
            priority: .high,
            due: "2026-07-19",
            scheduled: "2026-07-22",
            projects: ["[[Projects/Flat|the flat]]", "Admin"],
            contexts: ["home", "errands"],
            tags: ["urgent", "waiting"],
            timeEstimate: 90,
            details: """
                Ask about the **window** for the annual inspection.

                - confirm the boiler model
                - ask whether they need access to the loft
                """
        )
    }

    /// A repeating task: no due date, a rule with an interval and a `BYDAY`,
    /// which is exactly the shape a Swift-side summary would have mangled.
    static var recurring: CoreTask {
        inspectorTask(
            id: "Tasks/Stand-up.md",
            title: "Stand-up",
            priority: .medium,
            scheduled: "2026-07-20",
            recurrence: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=12",
            contexts: ["work"]
        )
    }

    /// A task with nothing filled in — what a newly created one looks like.
    static var bare: CoreTask {
        inspectorTask(id: "Tasks/Untitled.md", title: "Buy milk")
    }

    /// A vault, so the token fields have real completions behind them.
    static var vault: [CoreTask] { [rich, recurring, bare] }

    /// A note using every block the renderer can draw.
    static let everyBlock = """
        # Boiler inspection

        Notes from the **call**, with `context` and a [link](https://example.com).

        ## What they need

        - access to the loft
        - the boiler model
            - it is on the sticker inside the door

        1. call back
        2. confirm the window

        > They said any weekday before noon.

        ```bash
        rg --files-with-matches boiler ~/vault
        ```

        ---

        | room | access |
        | --- | --- |
        | loft | yes |
        | shed | no |
        """
}

/// A task carrying the fields the inspector renders.
///
/// Separate from the list fixtures' `coreTask`, which exposes neither tags, a
/// time estimate, nor a note body — the three fields these images exist to show.
@MainActor
func inspectorTask(
    id: String,
    title: String,
    status: TaskStatus = .open,
    priority: Priority = .normal,
    due: String? = nil,
    scheduled: String? = nil,
    recurrence: String? = nil,
    projects: [ProjectName] = [],
    contexts: [ContextName] = [],
    tags: [TagName] = [],
    timeEstimate: UInt32? = nil,
    details: String? = nil
) -> CoreTask {
    CoreTask(
        id: id,
        path: id,
        title: title,
        status: status,
        priority: priority,
        due: due,
        scheduled: scheduled,
        contexts: contexts,
        projects: projects,
        tags: tags,
        recurrence: recurrence,
        recurrenceAnchor: nil,
        completeInstances: [],
        skippedInstances: [],
        completedDate: nil,
        dateCreated: nil,
        dateModified: nil,
        timeEstimate: timeEstimate,
        timeEntries: [],
        blockedBy: [],
        reminders: [],
        archived: false,
        totalTrackedTime: 0,
        isBlocked: false,
        isBlocking: false,
        extraFields: "{}",
        details: details
    )
}
