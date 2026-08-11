import Foundation
import Synchronization
import TaskNotesKit
import TaskNotesUniFFI
import Testing

/// The timer, driven by an injected clock rather than by waiting.
///
/// Every assertion below would otherwise take twenty-five minutes to make,
/// which is the whole reason ``PomodoroTimer`` takes an instant source. The
/// arithmetic itself is the core's — `elapsedSecondsSince` and `elapsedFormat`
/// — so what is under test here is the *state machine*: what a pause banks, what
/// a resume restores, and that a stop does not quietly keep counting.
@Suite("The pomodoro session")
struct PomodoroSessionTests {
    private static let start = Date(timeIntervalSince1970: 1_784_746_800)

    @Test("a fresh session is idle, at the full focus interval")
    func idle() throws {
        let session = PomodoroSession.idle()
        #expect(session.isIdle)
        #expect(!session.isRunning)
        #expect(!session.isPaused)
        #expect(session.phase == .work)
        #expect(session.plannedSeconds == 25 * 60)
        #expect(try session.display(at: Self.start) == "25:00")
    }

    @Test("a started session counts down from its planned length")
    func counting() throws {
        let session = PomodoroSession.idle()
            .started(phase: .work, taskId: "Tasks/Write it up.md", at: Self.start)

        #expect(session.isRunning)
        #expect(try session.elapsedSeconds(at: Self.start) == 0)
        #expect(try session.remainingSeconds(at: Self.start.addingTimeInterval(65)) == 25 * 60 - 65)
        #expect(try session.display(at: Self.start.addingTimeInterval(65)) == "23:55")
    }

    /// The one place the format matters, and the reason it is the core's.
    ///
    /// `MM:SS` under an hour and `H:MM:SS` past it — a running clock that does
    /// not change width every minute. The time *report* deliberately does not
    /// use this; see ``TimeReport``.
    @Test("the countdown is the core's timer format")
    func timerFormat() throws {
        let long = PomodoroSession(
            phase: .work,
            taskId: nil,
            plannedSeconds: 90 * 60,
            runningSince: nil,
            bankedSeconds: 0
        )
        #expect(try long.display(at: Self.start) == "1:30:00")
    }

    @Test("a pause banks what was spent and stops the clock")
    func pausing() throws {
        let running = PomodoroSession.idle()
            .started(phase: .work, taskId: nil, at: Self.start)
        let held = try running.paused(at: Self.start.addingTimeInterval(300))

        #expect(!held.isRunning)
        #expect(held.isPaused)
        #expect(held.bankedSeconds == 300)
        // An hour later it still reads twenty minutes: a held clock is held.
        #expect(try held.display(at: Self.start.addingTimeInterval(3600)) == "20:00")
    }

    /// Pressing Pause twice must not bank the same interval twice.
    @Test("pausing an already-paused session changes nothing")
    func doublePause() throws {
        let held = try PomodoroSession.idle()
            .started(phase: .work, taskId: nil, at: Self.start)
            .paused(at: Self.start.addingTimeInterval(300))
        #expect(try held.paused(at: Self.start.addingTimeInterval(900)) == held)
    }

    @Test("a resume continues from what was banked, not from zero")
    func resuming() throws {
        let held = try PomodoroSession.idle()
            .started(phase: .work, taskId: nil, at: Self.start)
            .paused(at: Self.start.addingTimeInterval(300))
        let resumed = held.resumed(at: Self.start.addingTimeInterval(3600))

        #expect(resumed.isRunning)
        #expect(try resumed.elapsedSeconds(at: Self.start.addingTimeInterval(3660)) == 360)
        #expect(try resumed.display(at: Self.start.addingTimeInterval(3660)) == "19:00")
    }

    @Test("a stop returns to idle but keeps the task")
    func stopping() throws {
        let stopped = PomodoroSession.idle()
            .started(phase: .work, taskId: "Tasks/Write it up.md", at: Self.start)
            .stopped()

        #expect(stopped.isIdle)
        #expect(stopped.taskId == "Tasks/Write it up.md")
        #expect(try stopped.display(at: Self.start.addingTimeInterval(3600)) == "25:00")
    }

    @Test("an interval that has run its length is finished, floored at zero")
    func finished() throws {
        let session = PomodoroSession.idle()
            .started(phase: .work, taskId: nil, at: Self.start)
        let after = Self.start.addingTimeInterval(26 * 60)

        #expect(try session.remainingSeconds(at: after) == 0)
        #expect(try session.display(at: after) == "00:00")
        #expect(try session.hasFinished(at: after))
        #expect(try session.progress(at: after) == 1)
    }

    /// An idle session has not "finished" — it has not begun.
    @Test("an idle session is never finished")
    func idleIsNotFinished() throws {
        #expect(try !PomodoroSession.idle().hasFinished(at: Self.start))
    }

    @Test("the next interval is the other phase, not started")
    func pairing() throws {
        let work = PomodoroSession.idle(phase: .work, taskId: "Tasks/a.md")
        let rest = work.next
        #expect(rest.phase == .`break`)
        #expect(rest.plannedSeconds == 5 * 60)
        #expect(rest.isIdle)
        #expect(rest.taskId == "Tasks/a.md")
        #expect(rest.next.phase == .work)
    }

    /// The projection the window reads, and the shape the core will one day
    /// supply directly.
    @Test("the session projects into the core's own record")
    func projection() throws {
        let running = PomodoroSession.idle()
            .started(phase: .work, taskId: "Tasks/a.md", at: Self.start)
        let status = try running.status(at: Self.start.addingTimeInterval(60))

        #expect(
            status
                == PomodoroStatus(
                    active: true,
                    taskId: "Tasks/a.md",
                    timeRemaining: 24 * 60,
                    phase: .work
                )
        )
        #expect(try PomodoroSession.idle().status(at: Self.start).active == false)
    }

    /// Clock skew is the core's problem and it clamps rather than going
    /// negative — asserted here because the window would otherwise draw a
    /// countdown running backwards.
    @Test("a start instant in the future reads as no time elapsed")
    func skew() throws {
        let session = PomodoroSession.idle()
            .started(phase: .work, taskId: nil, at: Self.start.addingTimeInterval(600))
        #expect(try session.elapsedSeconds(at: Self.start) == 0)
        #expect(try session.display(at: Self.start) == "25:00")
    }

    // ── The holder ─────────────────────────────────────────────────────────

    @MainActor
    @Test("the timer holds one interval and a phase choice does not start it")
    func timerHolder() throws {
        let clock = MovableClock(now: Self.start)
        let timer = PomodoroTimer(instant: clock.read)

        timer.select(phase: .`break`)
        #expect(timer.session.isIdle)
        #expect(timer.session.phase == .`break`)

        timer.start(phase: .work, taskId: "Tasks/a.md")
        #expect(timer.session.isRunning)

        clock.advance(by: 120)
        timer.pause()
        #expect(timer.session.bankedSeconds == 120)
        #expect(timer.lastError == nil)

        timer.stop()
        #expect(timer.session.isIdle)
        #expect(timer.session.taskId == "Tasks/a.md")
    }

    @MainActor
    @Test("retargeting keeps a running interval running")
    func retarget() throws {
        let clock = MovableClock(now: Self.start)
        let timer = PomodoroTimer(instant: clock.read)
        timer.start(phase: .work, taskId: nil)
        clock.advance(by: 30)
        timer.retarget(to: "Tasks/b.md")

        #expect(timer.session.isRunning)
        #expect(timer.session.taskId == "Tasks/b.md")
        #expect(try timer.session.elapsedSeconds(at: clock.read()) == 30)
    }
}

/// A clock a test can push forward.
///
/// `Mutex` rather than a plain `var`, because the closure `PomodoroTimer` stores
/// is `@Sendable` and reaches this from whichever isolation the timer is in.
private final class MovableClock: Sendable {
    private let instant: Mutex<Date>

    init(now: Date) {
        instant = Mutex(now)
    }

    var read: @Sendable () -> Date {
        { self.instant.withLock { $0 } }
    }

    func advance(by seconds: TimeInterval) {
        instant.withLock { $0 = $0.addingTimeInterval(seconds) }
    }
}
