internal import Observation
public import TaskNotesUniFFI

public import struct Foundation.Date

/// The one pomodoro interval this app is running, if any.
///
/// ## Why it is not `@State` in the window
///
/// Because closing the window would end the interval, and "I closed the timer
/// window while it was running" is not a way of saying "stop". It lives beside
/// the store for the app's lifetime instead — one timer per app, exactly as
/// there is one per server — so the window becomes a *view* of a running
/// interval rather than its owner, and can be closed and reopened without
/// touching it.
///
/// ## Failures are held, not thrown
///
/// ``PomodoroSession``'s arithmetic goes through the core and can therefore
/// fail on a start instant the core cannot place on the timeline. Nothing a
/// SwiftUI action can do with a thrown error, so the failure is kept in
/// ``lastError`` for the window to show, and the session is left exactly as it
/// was — a timer that silently reset itself because a clock read failed would be
/// worse than one that says so and keeps counting.
@MainActor
@Observable
public final class PomodoroTimer {
    /// The current interval.
    public private(set) var session: PomodoroSession = .idle()

    /// The last failure the core reported while reading the clock.
    ///
    /// Separate from `TaskNotesStore.lastStoreError`, and deliberately not
    /// merged into it: a timer arithmetic failure is not a sync problem and
    /// putting it in the sync channel would raise the connection banner on every
    /// list screen in the app.
    public private(set) var lastError: CoreError?

    /// Where "now" comes from.
    ///
    /// The same seam ``SystemClock`` has, for the same reason: a test asserting
    /// that twenty-five minutes have passed cannot wait twenty-five minutes.
    private let instant: @Sendable () -> Date

    /// A timer over an interval and a clock.
    ///
    /// `session` is a parameter rather than always `.idle()` for the same
    /// reason ``PomodoroSession``'s memberwise initializer is public: a timer
    /// restored from `pomodoro_status()` starts life mid-interval, and a type
    /// that could only ever begin idle would have to be mutated into that state
    /// through the transitions instead — which would mean re-deriving a start
    /// instant the server already told us.
    public init(
        session: PomodoroSession = .idle(),
        instant: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.session = session
        self.instant = instant
    }

    /// Read the clock, for a caller that has to derive a display from it.
    public func now() -> Date { instant() }

    /// Begin an interval.
    public func start(phase: PomodoroPhase, taskId: TaskId?) {
        lastError = nil
        session = session.started(phase: phase, taskId: taskId, at: instant())
    }

    /// Hold the clock where it is.
    public func pause() {
        switch CoreErrors.capturing({ () throws(CoreError) -> PomodoroSession in
            try session.paused(at: instant())
        }) {
        case .success(let held): session = held
        case .failure(let error): lastError = error
        }
    }

    /// Start the clock again from what was banked.
    public func resume() {
        lastError = nil
        session = session.resumed(at: instant())
    }

    /// Abandon the interval, keeping the phase and the chosen task.
    public func stop() {
        lastError = nil
        session = session.stopped()
    }

    /// Set up an interval of `phase`, without starting it.
    ///
    /// Deliberately not "start with a different length": choosing focus or
    /// break is choosing what to do next, and a picker that began a countdown
    /// would make an exploratory click cost a real interval.
    ///
    /// Only meaningful while idle — an interval that has already banked time
    /// cannot change its length without silently rewriting what "half done"
    /// means — so the window disables the control rather than this guarding it.
    public func select(phase: PomodoroPhase) {
        lastError = nil
        session = .idle(phase: phase, taskId: session.taskId)
    }

    /// Move to the interval that follows, without starting it.
    public func advance() {
        lastError = nil
        session = session.next
    }

    /// Point the interval at a different task.
    ///
    /// Allowed while running, because noticing halfway through that the timer is
    /// against the wrong task and having to stop and restart it would throw away
    /// the very minutes the user was trying to record.
    public func retarget(to taskId: TaskId?) {
        lastError = nil
        session = PomodoroSession(
            phase: session.phase,
            taskId: taskId,
            plannedSeconds: session.plannedSeconds,
            runningSince: session.runningSince,
            bankedSeconds: session.bankedSeconds
        )
    }

    /// Clear the held failure, once the window has shown it.
    public func clearError() {
        lastError = nil
    }
}
