public import SwiftUI

/// Which auxiliary window, as the id `openWindow` takes.
///
/// An enum rather than string literals at three call sites, because a typo in a
/// window id is not a compile error — `openWindow(id:)` simply does nothing, and
/// a menu item that silently opens no window is indistinguishable from one that
/// is broken for some deeper reason.
public enum TimingWindow: String, CaseIterable, Sendable {
    case pomodoro = "red.sjer.tasknotes.window.pomodoro"
    case timeReport = "red.sjer.tasknotes.window.timeReport"

    /// The window's title, in the title bar and in the Window menu.
    public var title: String {
        switch self {
        case .pomodoro: "Pomodoro"
        case .timeReport: "Time Report"
        }
    }

    /// The SF Symbol for the menu item.
    public var systemImage: String {
        switch self {
        case .pomodoro: "timer"
        case .timeReport: "chart.bar"
        }
    }
}

/// The pomodoro timer and the time report, as scenes.
///
/// ## `Window`, not `WindowGroup`
///
/// There is one timer and one report, so there must be one window of each.
/// `WindowGroup` would let ⌘N — or a second menu click — open a second copy,
/// and two pomodoro windows over one interval is a picture of state that does
/// not exist. `Window` is SwiftUI's singleton scene: opening it a second time
/// brings the existing one forward.
///
/// Bundled into one `Scene` conformer rather than written into the app's
/// `body`, so `App/TaskNotesApp.swift` stays at entry-point scope — the same
/// reason `AppEnvironment` assembles the store rather than the `@main` file
/// doing it.
///
/// ## There are deliberately no `Commands` for these
///
/// SwiftUI adds a Window-menu item for every `Window` scene by itself, from
/// launch and before either window has ever been opened. That is measured, not
/// assumed: an earlier draft declared the pair explicitly and the running app's
/// Window menu read `Pomodoro, Time Report, Pomodoro, Time Report`. The
/// automatic items are also the ones that open these windows in the test above,
/// so nothing is lost by dropping ours.
public struct TimingScenes: Scene {
    private let environment: AppEnvironment

    public init(environment: AppEnvironment) {
        self.environment = environment
    }

    public var body: some Scene {
        Window(TimingWindow.pomodoro.title, id: TimingWindow.pomodoro.rawValue) {
            PomodoroView(timer: environment.pomodoro, store: environment.store)
        }
        // A dial, three buttons and two pickers have one right size and no
        // reason to be dragged bigger. `.contentSize` pins the window to what
        // the content asks for, which is also what stops the dial floating in a
        // field of grey when somebody resizes by reflex.
        .defaultSize(width: 340, height: 460)
        .windowResizability(.contentSize)

        Window(TimingWindow.timeReport.title, id: TimingWindow.timeReport.rawValue) {
            TimeReportView(store: environment.store)
        }
        // A list of rows genuinely benefits from being made taller, so this one
        // resizes freely.
        .defaultSize(width: 480, height: 440)
    }
}
