import AppKit
import SwiftUI
import TaskNotesKit
import TaskNotesUniFFI
import Testing

@testable import TaskNotesMac

/// The Today screen and its pieces, rendered to PNG for human review.
///
/// This is the plan's "Image snapshot — SwiftUI — `.image` via `NSHostingView`"
/// row. It is deliberately **not** a regression gate yet: nothing is compared
/// against a committed golden, because committing binaries before anybody has
/// agreed the screen looks right would freeze an unreviewed design and turn
/// every subsequent improvement into a "failing" test. What it does today is
/// produce the images, at a fixed size, a fixed scale, a fixed instant and both
/// system appearances, and prove they are not blank.
///
/// Every case renders offscreen inside `swift test`. See ``OffscreenSnapshot``
/// for the three mechanisms that guarantee it, and for why a window exists at
/// all.
///
/// `.serialized` because they all share one `NSApplication` and one main
/// run loop, and because a render that has to spin the run loop cannot do so
/// while another one is spinning it.
@Suite("Today, rendered offscreen", .serialized)
@MainActor
struct TodaySnapshotTests {
    /// The whole screen with a day's worth of work on it.
    @Test("the Today screen, populated", arguments: SnapshotAppearance.allCases)
    func todayPopulated(appearance: SnapshotAppearance) throws {
        let seeded = try SnapshotFixtures.populated()
        try record(
            TodayView(store: seeded.store),
            named: "today-populated",
            size: Self.screenSize,
            appearance: appearance
        )
    }

    /// The screen with nothing on it, in the reading a fresh launch gets.
    ///
    /// "Nothing due today", not "All clear": the celebration is only honest
    /// after the viewer has actually finished something on this screen, and
    /// `hasInteracted` is false for a store nobody has touched.
    @Test("the Today screen, empty", arguments: SnapshotAppearance.allCases)
    func todayEmpty(appearance: SnapshotAppearance) throws {
        let seeded = try SnapshotFixtures.empty()
        try record(
            TodayView(store: seeded.store),
            named: "today-empty",
            size: Self.screenSize,
            appearance: appearance
        )
    }

    /// One row per state the row view actually branches on.
    ///
    /// Rendered inside a `List` rather than bare, because the row's appearance
    /// is half `List`'s: the inset style supplies the row's insets, its
    /// separators, and its background, and a row drawn outside one would be a
    /// picture of something the app never shows.
    @Test(
        "a task row",
        arguments: RowVariant.allCases, SnapshotAppearance.allCases
    )
    func taskRow(variant: RowVariant, appearance: SnapshotAppearance) throws {
        let row = try variant.row()
        try record(
            List {
                TaskRowView(
                    row: row,
                    onToggle: {},
                    onDelete: {},
                    onSchedule: { _ in },
                    onScheduleDate: { _ in }
                )
            }
            .listStyle(.inset),
            named: "row-\(variant.rawValue)",
            size: Self.rowSize,
            appearance: appearance
        )
    }

    /// The same screen in a window too narrow for its longest title.
    ///
    /// The row hangs two marks off the end of the title, so the question this
    /// answers is what happens when the title has no end to hang them off:
    /// SwiftUI compresses a flexible `Text` before a fixed-size `Image`, which
    /// *should* mean the title truncates and the marks survive. "Should" is not
    /// evidence, and a priority flag that silently disappears at narrow widths
    /// is exactly the kind of thing that ships.
    @Test(
        "the Today screen, too narrow for its longest title", arguments: SnapshotAppearance.allCases
    )
    func todayNarrow(appearance: SnapshotAppearance) throws {
        let seeded = try SnapshotFixtures.populated()
        try record(
            TodayView(store: seeded.store),
            named: "today-narrow",
            size: Self.narrowSize,
            appearance: appearance
        )
    }

    /// All six priorities, in rank order, in one image.
    ///
    /// **A ramp is only reviewable as a ramp.** The previous one — red, red,
    /// blue, orange, grey, grey — was not obviously broken in any single row;
    /// it was obviously broken the moment the six were stacked, because the top
    /// two ranks were the same red and `normal` shouted louder than `medium`.
    /// One image per rank could not have caught that, so this renders the whole
    /// sequence and the reviewer's job is to read down it and see it descend.
    @Test("the priority ramp, in rank order", arguments: SnapshotAppearance.allCases)
    func priorityRamp(appearance: SnapshotAppearance) throws {
        let rows = try priorityAll().map { priority in
            try TaskRowState(
                task: coreTask(
                    id: "Tasks/\(priorityLabel(priority: priority)).md",
                    title: priorityLabel(priority: priority),
                    priority: priority,
                    due: SnapshotFixtures.today
                ),
                isPending: false,
                calendar: SnapshotFixtures.calendar,
                text: TaskDateText(locale: Locale(identifier: "en_US"))
            )
        }
        try record(
            List(rows) { row in
                TaskRowView(
                    row: row,
                    onToggle: {},
                    onDelete: {},
                    onSchedule: { _ in },
                    onScheduleDate: { _ in }
                )
            }
            .listStyle(.inset),
            named: "priority-ramp",
            size: Self.rampSize,
            appearance: appearance
        )
    }

    /// The connection banner, in each state it has something to say.
    @Test(
        "the sync banner",
        arguments: BannerVariant.allCases, SnapshotAppearance.allCases
    )
    func syncBanner(variant: BannerVariant, appearance: SnapshotAppearance) throws {
        let message = try #require(variant.message(), "\(variant.rawValue) produced no banner")
        try record(
            VStack(spacing: 0) {
                SyncBannerView(message: message, onRetry: {})
                Divider()
                Spacer()
            },
            named: "banner-\(variant.rawValue)",
            size: Self.bannerSize,
            appearance: appearance
        )
    }

    /// A window-sized canvas. Wide enough that a long title truncates rather
    /// than wrapping the layout into a shape the app never has.
    private static let screenSize = CGSize(width: 760, height: 460)

    /// Narrow enough that the longest fixture title cannot fit.
    private static let narrowSize = CGSize(width: 420, height: 460)
    private static let rowSize = CGSize(width: 560, height: 76)
    private static let rampSize = CGSize(width: 560, height: 320)
    private static let bannerSize = CGSize(width: 560, height: 76)
}

/// The row states worth looking at.
///
/// Each one is a branch `TaskRowView` genuinely takes: the strikethrough and
/// the dimmed tint, the red overdue badge, the recurrence's per-occurrence
/// checkbox, and the waiting-to-sync glyph.
///
/// The three added last are about the two things a single row cannot show.
/// `priorityHighest`/`priorityHigh`/`priorityLow` exist because the priority
/// ramp is only reviewable as a *sequence* — the old one put the top two ranks
/// in the same red, and no single image could have revealed that. And
/// `recurringOverdue` is the case that motivated printing the occurrence at
/// all: a repeating task with no due date, sitting on an occurrence that has
/// already passed.
enum RowVariant: String, CaseIterable, Sendable {
    case normal
    case completed
    case overdue
    case recurring
    case recurringOverdue
    case pending
    case priorityHighest
    case priorityHigh
    case priorityLow

    /// The row this variant renders, derived exactly as the screen derives it.
    ///
    /// Through `TaskRowState` rather than by hand: `isCompleted`,
    /// `completionTarget` and the due badge are all core answers, and a fixture
    /// that set them directly would be a picture of a state the app cannot
    /// reach.
    @MainActor
    func row() throws(CoreError) -> TaskRowState {
        try TaskRowState(
            task: task,
            isPending: self == .pending,
            calendar: SnapshotFixtures.calendar,
            text: TaskDateText(locale: Locale(identifier: "en_US"))
        )
    }

    @MainActor
    private var task: CoreTask {
        switch self {
        case .normal:
            coreTask(
                id: "Tasks/Ship the release notes.md",
                title: "Ship the release notes",
                priority: .normal,
                due: SnapshotFixtures.today,
                projects: ["[[Website]]"],
                contexts: ["work"]
            )
        case .completed:
            coreTask(
                id: "Tasks/Book the flights.md",
                title: "Book the flights",
                status: .done,
                priority: .normal,
                due: SnapshotFixtures.today
            )
        case .overdue:
            coreTask(
                id: "Tasks/Renew passport.md",
                title: "Renew passport",
                priority: .highest,
                due: "2026-06-30",
                projects: ["[[Admin]]"]
            )
        case .recurring:
            coreTask(
                id: "Tasks/Stand-up.md",
                title: "Stand-up",
                priority: .medium,
                scheduled: SnapshotFixtures.today,
                recurrence: "FREQ=DAILY",
                contexts: ["work"]
            )
        case .recurringOverdue:
            // No due date, and its occurrence is three weeks gone: the row that
            // used to print nothing at all in the date column.
            coreTask(
                id: "Tasks/Pay rent.md",
                title: "Pay rent",
                priority: .high,
                scheduled: "2026-07-01",
                recurrence: "FREQ=MONTHLY;BYMONTHDAY=1",
                projects: ["[[Admin]]"]
            )
        case .pending:
            coreTask(
                id: "Tasks/Water the plants.md",
                title: "Water the plants",
                priority: .low,
                due: SnapshotFixtures.today,
                contexts: ["home"]
            )
        case .priorityHighest:
            coreTask(
                id: "Tasks/File the tax return.md",
                title: "File the tax return",
                priority: .highest,
                due: SnapshotFixtures.today
            )
        case .priorityHigh:
            coreTask(
                id: "Tasks/Call the plumber.md",
                title: "Call the plumber",
                priority: .high,
                due: SnapshotFixtures.today
            )
        case .priorityLow:
            coreTask(
                id: "Tasks/Sort the bookshelf.md",
                title: "Sort the bookshelf",
                priority: .low,
                due: SnapshotFixtures.today
            )
        }
    }
}

/// The banner states, built through `SyncMessage.of` rather than by hand.
///
/// Going through the real derivation is the point: it is what decides the
/// wording, the tone, and whether a retry button appears at all, and a fixture
/// that constructed `SyncMessage` directly could draw a banner the store can
/// never produce.
///
/// The four are deliberately a **severity sequence**, not four independent
/// pictures, and they are reviewed as one: `pending` (nothing is wrong) below
/// `offline` (wrong, and fixing itself) below `unconfigured`/`authError`
/// (wrong, and yours to fix). If two of them look equally alarming, that is the
/// defect — one orange triangle used to sit on three of them.
enum BannerVariant: String, CaseIterable, Sendable {
    /// Offline: the server did not answer and the engine is backing off.
    case offline
    /// Something local failed — a write, or a command the shell could not build.
    case error
    /// Work is queued and the engine is idle. The common, unalarming case.
    case pending
    /// No server has been set up yet. What a fresh launch shows.
    case unconfigured
    /// A server that answered and refused. The other case that needs Settings.
    case authError

    func message() -> SyncMessage? {
        switch self {
        case .authError:
            SyncMessage.of(
                status: SyncStatus(
                    state: .authError,
                    lastError: .Api(message: "Unauthorized", status: 401),
                    nextRetryAt: nil
                ),
                pendingCount: 0,
                storeError: nil
            )
        case .offline:
            SyncMessage.of(
                status: SyncStatus(
                    state: .backoff,
                    lastError: .Connection(
                        message: "Could not reach the server at tasknotes.local."),
                    nextRetryAt: nil
                ),
                pendingCount: 1,
                storeError: nil
            )
        case .error:
            SyncMessage.of(
                status: SyncStatus(state: .idle, lastError: nil, nextRetryAt: nil),
                pendingCount: 0,
                storeError: .Validation(
                    message: "“next fridayy” is not a date this shell can read.")
            )
        case .pending:
            SyncMessage.of(
                status: SyncStatus(state: .idle, lastError: nil, nextRetryAt: nil),
                pendingCount: 3,
                storeError: nil
            )
        case .unconfigured:
            SyncMessage.of(
                status: SyncStatus(state: .unconfigured, lastError: nil, nextRetryAt: nil),
                pendingCount: 0,
                storeError: nil
            )
        }
    }
}
