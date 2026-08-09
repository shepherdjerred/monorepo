import AppKit
import Foundation
import SwiftUI
import TaskNotesKit
import TaskNotesUniFFI
import Testing

@testable import TaskNotesMac

/// The quick-add panel's contents, the pomodoro window, and the time report,
/// rendered offscreen.
///
/// ## ⚠️ What these images cannot prove, and it is the important half
///
/// An offscreen renderer draws a view into a bitmap this process owns. It never
/// orders a window in, never activates an application, and never sees a
/// keystroke. So **nothing here can show that the global hotkey fires, that the
/// panel appears over another application, or that it does so without pulling
/// TaskNotes forward** — the three properties that are the entire point of the
/// panel. What is covered instead is split in two:
///
///   * these images, for everything the panel *says*, and
///   * ``QuickAddPanelConfigurationTests``, for the window properties that make
///     it non-activating — which are ordinary `NSWindow` state and can be
///     asserted without ever showing the window.
///
/// The remaining gap — that macOS honours those properties, and that
/// `RegisterEventHotKey` delivers — is a real run or an XCUITest, and is
/// reported as such rather than papered over with a green test.
@Suite("The capture and timing surfaces, rendered offscreen", .serialized)
@MainActor
struct CaptureAndTimingSnapshotTests {
    // ── The quick-add panel ────────────────────────────────────────────────

    /// The panel in each state its footer has.
    ///
    /// Four states rather than one, because the footer is the whole feature: it
    /// is the only account the user ever gets of what Return will create, and
    /// each branch says something different. The syntax hint is the one worth
    /// staring at — it is where somebody learns that `!high` and `p:` mean
    /// anything at all.
    @Test(
        "the quick-add panel",
        arguments: QuickAddVariant.allCases, SnapshotAppearance.allCases
    )
    func quickAddPanel(variant: QuickAddVariant, appearance: SnapshotAppearance) throws {
        let seeded = try SnapshotFixtures.populated()
        let controller = QuickAddPanelController(store: .success(seeded.store))
        controller.prepare()
        controller.text = variant.text

        try record(
            QuickAddPanelView(controller: controller)
                // The panel's own size, so the image is the window rather than
                // a view stretched to whatever a test picked.
                .frame(
                    width: QuickAddPanel.contentSize.width,
                    height: QuickAddPanel.contentSize.height
                ),
            named: "quickadd-\(variant.rawValue)",
            size: QuickAddPanel.contentSize,
            appearance: appearance
        )
    }

    // ── The pomodoro window ────────────────────────────────────────────────

    /// The timer in each state its controls branch on.
    ///
    /// The running and finished cases are built from a session whose start
    /// instant is offset from **real** now, because the window's ticking branch
    /// is a `TimelineView(.periodic)` and that reads the system clock rather
    /// than the timer's injected one. Offsetting the session instead keeps the
    /// two consistent without the view having to know it is being photographed.
    @Test(
        "the pomodoro window",
        arguments: PomodoroVariant.allCases, SnapshotAppearance.allCases
    )
    func pomodoro(variant: PomodoroVariant, appearance: SnapshotAppearance) throws {
        let seeded = try SnapshotFixtures.populated()
        try record(
            PomodoroView(timer: variant.timer(), store: .success(seeded.store)),
            named: "pomodoro-\(variant.rawValue)",
            size: Self.pomodoroSize,
            appearance: appearance
        )
    }

    // ── The time report ────────────────────────────────────────────────────

    /// A report with a spread of totals, so the bars are reviewable as a set.
    ///
    /// The durations are chosen to cross every branch of the format: minutes
    /// only, hours only, and both — because the whole reason this window does
    /// not use the core's `elapsedFormat` is that `1:30:00` reads as a video
    /// length, and the fix is only reviewable by reading real numbers.
    @Test("the time report", arguments: SnapshotAppearance.allCases)
    func timeReport(appearance: SnapshotAppearance) throws {
        try record(
            TimeReportContent(report: TimeReport.of(summary: Self.summary)),
            named: "time-report",
            size: Self.reportSize,
            appearance: appearance
        )
    }

    @Test("the time report with nothing tracked", arguments: SnapshotAppearance.allCases)
    func timeReportEmpty(appearance: SnapshotAppearance) throws {
        try record(
            TimeReportContent(report: TimeReport.ofTrackedTotals(tasks: [])),
            named: "time-report-empty",
            size: Self.reportSize,
            appearance: appearance
        )
    }

    /// The window's own size, measured off the running app rather than guessed:
    /// `.windowResizability(.contentSize)` makes the window hug the view, and
    /// the real one comes out 292 × 424 in content. A larger frame here would be
    /// a picture of a window this app never opens.
    private static let pomodoroSize = CGSize(width: 292, height: 424)
    private static let reportSize = CGSize(width: 480, height: 440)

    /// A day's tracked work, in the shape the server sends.
    private static var summary: TimeSummary {
        TimeSummary(
            totalTime: 411,
            topTasks: [
                TopTask(
                    taskId: "Tasks/Reply to the landlord about the boiler inspection window.md",
                    title: "Reply to the landlord about the boiler inspection window",
                    minutes: 185
                ),
                TopTask(
                    taskId: "Tasks/Ship the release notes.md", title: "Ship the release notes",
                    minutes: 120),
                TopTask(
                    taskId: "Tasks/Draft the offsite agenda.md", title: "Draft the offsite agenda",
                    minutes: 60),
                TopTask(taskId: "Tasks/Stand-up.md", title: "Stand-up", minutes: 33),
                TopTask(
                    taskId: "Tasks/Water the plants.md", title: "Water the plants", minutes: 13),
            ]
        )
    }
}

/// What is in the quick-add field when the picture is taken.
enum QuickAddVariant: String, CaseIterable, Sendable {
    /// Empty — the state the panel is always summoned into, and the only one
    /// that teaches the syntax.
    case empty
    /// A plain title, which the core recognised nothing in.
    case plain
    /// The line from the brief, with every token kind on it.
    case parsed
    /// Only tokens, so there is no task to create.
    case tokensOnly

    var text: String {
        switch self {
        case .empty: ""
        case .plain: "Take the car in for its service"
        case .parsed: "Fix the boiler !high p:Home @errands #urgent tomorrow"
        case .tokensOnly: "!high @errands"
        }
    }
}

/// The states the pomodoro window's controls actually branch on.
enum PomodoroVariant: String, CaseIterable, Sendable {
    /// Nothing has run. A full interval, Start enabled, Stop dim.
    case idle
    /// Counting down, five minutes in.
    case running
    /// Held. The clock is stopped and Resume replaces Start.
    case paused
    /// Run its length. The controls collapse to the one button that matters.
    case finished
    /// A rest interval, which is the other half of the phase picker and the one
    /// place the dial is not drawn in the accent tint.
    case resting

    @MainActor
    func timer() -> PomodoroTimer {
        // Offset from real now: the running branch of the window is a
        // `TimelineView(.periodic)` reading the system clock.
        let now = Date()
        switch self {
        case .idle:
            return PomodoroTimer()
        case .running:
            return PomodoroTimer(
                session: PomodoroSession(
                    phase: .work,
                    taskId: "Tasks/Ship the release notes.md",
                    plannedSeconds: PomodoroSession.workSeconds,
                    runningSince: Rfc3339.string(from: now.addingTimeInterval(-300)),
                    bankedSeconds: 0
                )
            )
        case .paused:
            return PomodoroTimer(
                session: PomodoroSession(
                    phase: .work,
                    taskId: "Tasks/Ship the release notes.md",
                    plannedSeconds: PomodoroSession.workSeconds,
                    runningSince: nil,
                    bankedSeconds: 620
                )
            )
        case .finished:
            return PomodoroTimer(
                session: PomodoroSession(
                    phase: .work,
                    taskId: "Tasks/Ship the release notes.md",
                    plannedSeconds: PomodoroSession.workSeconds,
                    runningSince: Rfc3339.string(
                        from: now.addingTimeInterval(-Double(PomodoroSession.workSeconds) - 30)),
                    bankedSeconds: 0
                )
            )
        case .resting:
            return PomodoroTimer(
                session: PomodoroSession(
                    phase: .`break`,
                    taskId: nil,
                    plannedSeconds: PomodoroSession.breakSeconds,
                    runningSince: Rfc3339.string(from: now.addingTimeInterval(-95)),
                    bankedSeconds: 0
                )
            )
        }
    }
}

/// The panel's window properties, which no image can show.
///
/// Every one of these is what makes the panel appear over another application
/// without stealing its focus, and every one of them is a single property that
/// somebody could delete while the panel kept looking identical in a snapshot.
/// The window is constructed and never ordered in, so this steals nothing from
/// whoever is using the Mac — the same discipline ``OffscreenSnapshot`` follows.
@Suite("The quick-add panel's window")
@MainActor
struct QuickAddPanelConfigurationTests {
    private func panel() -> QuickAddPanel {
        QuickAddPanel(
            content: NSView(frame: CGRect(origin: .zero, size: QuickAddPanel.contentSize)))
    }

    /// The one property without which the whole feature is a normal window.
    @Test("the panel is non-activating")
    func nonActivating() {
        #expect(panel().styleMask.contains(.nonactivatingPanel))
    }

    /// A panel that cannot become key is a text field nobody can type into.
    @Test("the panel takes the keyboard but never becomes main")
    func keyWithoutMain() {
        let panel = panel()
        #expect(panel.canBecomeKey)
        #expect(!panel.canBecomeMain)
    }

    @Test("the panel floats above the application it was summoned over")
    func floats() {
        let panel = panel()
        #expect(panel.isFloatingPanel)
        #expect(panel.level == .floating)
    }

    /// A global hotkey reaches every Space, so the panel has to as well.
    @Test("the panel follows the user onto any Space, including a full-screen one")
    func everySpace() {
        let behavior = panel().collectionBehavior
        #expect(behavior.contains(.canJoinAllSpaces))
        #expect(behavior.contains(.fullScreenAuxiliary))
    }

    /// Clicking away is a dismissal, not a window left over somebody's editor.
    @Test("the panel hides when the application is deactivated")
    func hidesOnDeactivate() {
        #expect(panel().hidesOnDeactivate)
    }

    /// It is summoned by a key and holds no state worth returning to.
    @Test("the panel is not offered in the Window menu")
    func notInWindowMenu() {
        #expect(panel().isExcludedFromWindowsMenu)
    }

    /// Reused on every summoning, so a close must not take the hosting view.
    @Test("the panel survives being closed")
    func survivesClose() {
        #expect(!panel().isReleasedWhenClosed)
    }

    /// It is never shown by construction; asserted so a future edit that ordered
    /// it in from `init` fails here rather than in front of the user.
    @Test("constructing the panel does not show it")
    func staysHidden() {
        #expect(!panel().isVisible)
    }
}
