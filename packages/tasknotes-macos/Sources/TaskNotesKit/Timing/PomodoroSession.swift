public import TaskNotesUniFFI

public import struct Foundation.Date

/// A running pomodoro interval, as a value.
///
/// ## 🔴 The server owns pomodoros, and the core cannot reach it — reported gap
///
/// The React Native app's timer is **entirely server-side**: `PomodoroScreen`
/// calls `startPomodoro`/`pausePomodoro`/`stopPomodoro`, which are `POST`s to
/// `/api/pomodoro/{start,pause,stop}`, and it renders whatever
/// `/api/pomodoro/status` last returned. The Rust core exports the
/// `PomodoroStatus` and `PomodoroPhase` *records* — this file projects into
/// them — but exports **no way to fetch or drive them**: `FfiSyncEngine` has no
/// pomodoro method, `TaskNotesApi` exposes only `baseUrl()` and `cancelAll()`,
/// and `net/endpoints.rs` knows only `/api/tasks`.
///
/// Writing those four requests in Swift is exactly the wire duplication Phase
/// 4.5 deleted, so this file **does not**. What it has instead is a local
/// interval: the phase, the task it is against, how long it is meant to run,
/// and when it started. That is genuinely the host's half of the job even once
/// the core catches up — the core is sans-I/O and reads no clock, so it can
/// never tick a timer — and the seam is deliberately shaped so that the day
/// `pomodoro_status()` lands, ``status(at:)`` is replaced by the core's answer
/// and no view above changes.
///
/// Two things are therefore **not** implemented here, on purpose, because they
/// are policy rather than arithmetic and policy belongs in one place:
///
///   * **No automatic work → break → work cycling.** Which interval follows
///     which, and how many focus intervals precede a long break, is the
///     server's to decide; a Swift copy would be a second answer.
///   * **No time entry is written.** A finished interval should append to the
///     task's `timeEntries`, and the server does that as part of
///     `/api/pomodoro/stop`. Doing it from here would mean this client's
///     tracked time and the phone's disagree.
///
/// ## Why the elapsed arithmetic goes through the core
///
/// ``elapsedSeconds(at:)`` calls the core's `elapsedSecondsSince`, and
/// ``display(at:)`` calls the core's `elapsedFormat`. Subtracting two `Date`s
/// would have been shorter and is the wrong shape: the core's version clamps
/// host/server clock skew to zero rather than producing a negative duration,
/// rejects a start value it cannot place on the timeline instead of guessing,
/// and is the same code the phone runs. When a session does start arriving from
/// the server, its `startTime` is an RFC 3339 string written by
/// `Date.prototype.toISOString` — which is precisely what this type already
/// stores.
public struct PomodoroSession: Sendable, Equatable {
    /// Which half of the cycle this interval is.
    public let phase: PomodoroPhase

    /// The task being worked on, if one was chosen.
    ///
    /// Optional because a break is not against a task, and because starting a
    /// timer with nothing selected is a legitimate way to use one.
    public let taskId: TaskId?

    /// How long the interval is meant to run, in whole seconds.
    public let plannedSeconds: UInt64

    /// When the current run began, RFC 3339, or `nil` when nothing is running.
    public let runningSince: String?

    /// Seconds already spent in this interval before the current run.
    ///
    /// What a pause banks. Kept separately from ``runningSince`` rather than by
    /// rewriting the start instant, because the start instant is the value the
    /// server will one day supply and rewriting it would make a restored
    /// session and a locally paused one two different shapes.
    public let bankedSeconds: UInt64

    /// An interval in whatever state the caller can describe.
    ///
    /// Public rather than the synthesized internal memberwise initializer,
    /// because this is the shape a session arriving from `pomodoro_status()`
    /// would be built in — a phase, a task, a length, and a start instant the
    /// *server* chose. Everything else in this type is a transition between two
    /// of these, and the transitions are what the app uses.
    public init(
        phase: PomodoroPhase,
        taskId: TaskId?,
        plannedSeconds: UInt64,
        runningSince: String?,
        bankedSeconds: UInt64
    ) {
        self.phase = phase
        self.taskId = taskId
        self.plannedSeconds = plannedSeconds
        self.runningSince = runningSince
        self.bankedSeconds = bankedSeconds
    }

    /// A focus interval, the length the React Native app falls back to.
    ///
    /// ⚠️ 25 and 5 minutes are the classic technique's numbers and match
    /// `PomodoroScreen`'s `25 * 60` fallback. They are stated here because the
    /// window has to draw *something* before a timer has ever run; the
    /// authoritative lengths are the server's, and arrive with
    /// `pomodoro_status()`.
    public static let workSeconds: UInt64 = 25 * 60

    /// A rest interval.
    public static let breakSeconds: UInt64 = 5 * 60

    /// A phase's default length.
    public static func plannedSeconds(for phase: PomodoroPhase) -> UInt64 {
        switch phase {
        case .work: workSeconds
        case .`break`: breakSeconds
        }
    }

    /// Nothing running, ready to start `phase`.
    public static func idle(
        phase: PomodoroPhase = .work,
        taskId: TaskId? = nil
    ) -> PomodoroSession {
        PomodoroSession(
            phase: phase,
            taskId: taskId,
            plannedSeconds: plannedSeconds(for: phase),
            runningSince: nil,
            bankedSeconds: 0
        )
    }

    /// Whether the clock is moving.
    public var isRunning: Bool { runningSince != nil }

    /// Whether the interval has begun and is currently held.
    public var isPaused: Bool { runningSince == nil && bankedSeconds > 0 }

    /// Whether nothing has been spent on this interval yet.
    public var isIdle: Bool { runningSince == nil && bankedSeconds == 0 }

    /// Begin `phase` against `taskId`, discarding anything banked.
    public func started(
        phase: PomodoroPhase,
        taskId: TaskId?,
        at now: Date
    ) -> PomodoroSession {
        PomodoroSession(
            phase: phase,
            taskId: taskId,
            plannedSeconds: Self.plannedSeconds(for: phase),
            runningSince: Rfc3339.string(from: now),
            bankedSeconds: 0
        )
    }

    /// Hold the clock, banking what has been spent so far.
    ///
    /// A no-op when nothing is running, so a Pause the user pressed twice does
    /// not double-bank the interval.
    public func paused(at now: Date) throws(CoreError) -> PomodoroSession {
        guard isRunning else { return self }
        return PomodoroSession(
            phase: phase,
            taskId: taskId,
            plannedSeconds: plannedSeconds,
            runningSince: nil,
            bankedSeconds: try elapsedSeconds(at: now)
        )
    }

    /// Restart the clock from what was banked.
    public func resumed(at now: Date) -> PomodoroSession {
        guard !isRunning else { return self }
        return PomodoroSession(
            phase: phase,
            taskId: taskId,
            plannedSeconds: plannedSeconds,
            runningSince: Rfc3339.string(from: now),
            bankedSeconds: bankedSeconds
        )
    }

    /// Abandon the interval, keeping the phase and the task chosen.
    ///
    /// The task survives a stop because "stop" means *this interval is over*,
    /// not *I am done with this task* — and re-picking it from a list of
    /// hundreds to start the next one would be the whole reason the window
    /// exists, undone.
    public func stopped() -> PomodoroSession {
        PomodoroSession(
            phase: phase,
            taskId: taskId,
            plannedSeconds: plannedSeconds,
            runningSince: nil,
            bankedSeconds: 0
        )
    }

    /// The interval that follows this one, not started.
    ///
    /// Offered as a *button*, never taken automatically. See the type's note:
    /// which interval follows which is the server's policy, and this only names
    /// the obvious pairing so the user does not have to re-pick a phase.
    public var next: PomodoroSession {
        switch phase {
        case .work: PomodoroSession.idle(phase: .`break`, taskId: taskId)
        case .`break`: PomodoroSession.idle(phase: .work, taskId: taskId)
        }
    }

    /// Whole seconds spent in this interval as of `now`.
    ///
    /// - Throws: `CoreError.Validation` when the stored start instant is not a
    ///   timestamp the core can place on the timeline. Unreachable for a
    ///   session this app started — and the honest shape for one restored from a
    ///   server response, which is what this type is being aimed at.
    public func elapsedSeconds(at now: Date) throws(CoreError) -> UInt64 {
        guard let runningSince else { return bankedSeconds }
        let running = try CoreErrors.rethrowingCore("reading the elapsed time") {
            try elapsedSecondsSince(start: runningSince, now: Rfc3339.string(from: now))
        }
        return bankedSeconds + running
    }

    /// Whole seconds left, floored at zero.
    public func remainingSeconds(at now: Date) throws(CoreError) -> UInt64 {
        let spent = try elapsedSeconds(at: now)
        return spent >= plannedSeconds ? 0 : plannedSeconds - spent
    }

    /// Whether the interval has run its length.
    public func hasFinished(at now: Date) throws(CoreError) -> Bool {
        try remainingSeconds(at: now) == 0 && !isIdle
    }

    /// The countdown, as the window prints it.
    ///
    /// The core's `elapsedFormat` — `MM:SS`, and `H:MM:SS` past an hour — and
    /// this is the one place in the app it belongs. It is a *timer* format: a
    /// ticking clock that does not change width every minute. The time report
    /// deliberately does not use it, because `1:30:00` reads as a video length
    /// rather than as an hour and a half of work.
    public func display(at now: Date) throws(CoreError) -> String {
        elapsedFormat(seconds: try remainingSeconds(at: now))
    }

    /// How far through the interval is, from 0 to 1.
    public func progress(at now: Date) throws(CoreError) -> Double {
        guard plannedSeconds > 0 else { return 0 }
        let spent = try elapsedSeconds(at: now)
        return min(1, Double(spent) / Double(plannedSeconds))
    }

    /// This session as the core's own record.
    ///
    /// The projection exists so every view above reads `PomodoroStatus` and
    /// nothing else. When `pomodoro_status()` lands in the core, the window
    /// switches from calling this to calling that, and no view changes.
    ///
    /// `timeRemaining` narrows to `UInt32` the way the core's own record does;
    /// the interval is bounded by ``plannedSeconds``, so the conversion cannot
    /// overflow for any value this type can hold.
    public func status(at now: Date) throws(CoreError) -> PomodoroStatus {
        let remaining = try remainingSeconds(at: now)
        return PomodoroStatus(
            active: isRunning,
            taskId: taskId,
            timeRemaining: UInt32(min(remaining, UInt64(UInt32.max))),
            phase: phase
        )
    }
}

/// RFC 3339, in UTC, to whole seconds.
///
/// The shape `elapsedSecondsSince` documents it wants, and the shape the server
/// writes — every `startTime` it emits comes from `Date.prototype.toISOString`.
/// Pinned to UTC and to `Locale`-free ISO formatting rather than reaching for a
/// `DateFormatter`, for the same reason ``SystemClock`` does: a value type is
/// `Sendable` and cannot be configured wrong by a user's region setting.
public enum Rfc3339 {
    private static let style = Date.ISO8601FormatStyle(timeZone: .gmt)

    /// `2026-07-22T19:00:00Z`.
    public static func string(from date: Date) -> String {
        style.format(date)
    }
}
