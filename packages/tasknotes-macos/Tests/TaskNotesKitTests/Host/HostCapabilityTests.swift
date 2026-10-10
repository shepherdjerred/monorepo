import Foundation
import Synchronization
import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

@Suite("Clock")
struct SystemClockTests {
    @Test("epoch milliseconds match a known instant")
    func nowMillisMatchesAKnownInstant() {
        // 2026-08-08T00:00:00Z.
        let fixed = Date(timeIntervalSince1970: 1_786_147_200)
        let clock = SystemClock(timeZone: .gmt, instant: { fixed })
        #expect(clock.nowMillis() == 1_786_147_200_000)
    }

    @Test("sub-millisecond time floors rather than truncating toward zero")
    func subMillisecondTimeFloors() {
        // Truncation toward zero would map both of these to 0, putting a
        // one-millisecond plateau across the epoch and making the clock
        // non-monotone there. Flooring keeps it strictly increasing.
        let before = SystemClock(instant: { Date(timeIntervalSince1970: -0.0005) })
        let after = SystemClock(instant: { Date(timeIntervalSince1970: 0.0005) })
        #expect(before.nowMillis() == -1)
        #expect(after.nowMillis() == 0)
    }

    @Test("the local date is the device's calendar, not UTC")
    func localYmdUsesTheGivenTimeZone() throws {
        // 2026-08-08T03:00:00Z is still 2026-08-07 in Los Angeles. This is the
        // whole reason `localYmd` is a host capability rather than arithmetic
        // in the core: it needs a timezone database.
        let instant: Int64 = 1_786_158_000_000
        let losAngeles = try #require(TimeZone(identifier: "America/Los_Angeles"))
        let tokyo = try #require(TimeZone(identifier: "Asia/Tokyo"))

        #expect(SystemClock(timeZone: .gmt).localYmd(millis: instant) == "2026-08-08")
        #expect(SystemClock(timeZone: losAngeles).localYmd(millis: instant) == "2026-08-07")
        #expect(SystemClock(timeZone: tokyo).localYmd(millis: instant) == "2026-08-08")
    }

    @Test("the local date is locale-independent")
    func localYmdIsLocaleIndependent() {
        // A `DateFormatter` without `en_US_POSIX` would render this as a
        // Buddhist- or Japanese-calendar year under some system locales. The
        // format style used here has no locale to get wrong.
        let clock = SystemClock(timeZone: .gmt)
        #expect(clock.localYmd(millis: 0) == "1970-01-01")
        #expect(clock.localYmd(millis: -86_400_000) == "1969-12-31")
    }
}

@Suite("Randomness")
struct RandomnessTests {
    @Test("every draw is inside the documented range")
    func drawsStayInRange() {
        let randomness = SystemRandomness()
        for _ in 0..<10_000 {
            let drawn = randomness.nextUnitPpm()
            #expect(drawn < UnitPpm.unit)
        }
    }

    @Test("a fixed source yields exactly what it was given")
    func fixedRandomnessIsExact() throws {
        let half = try #require(FixedRandomness(ppm: UnitPpm.half))
        #expect(half.nextUnitPpm() == 500_000)
        #expect(half.nextUnitPpm() == 500_000)

        let zero = try #require(FixedRandomness(ppm: 0))
        #expect(zero.nextUnitPpm() == 0)
    }

    @Test("an out-of-range constant is rejected rather than clamped")
    func fixedRandomnessRejectsOutOfRange() {
        // The core clamps defensively at its own boundary. A host that was
        // *asked* for an impossible constant has been given a broken value, and
        // silently substituting a different one is the fallback the repository's
        // principles exist to prevent.
        #expect(FixedRandomness(ppm: UnitPpm.unit) == nil)
        #expect(FixedRandomness(ppm: UInt32.max) == nil)
    }
}

@Suite("Retry scheduler")
struct DispatchRetrySchedulerTests {
    /// Wait for a condition, polling. Returns whether it became true.
    ///
    /// Polling rather than a fixed sleep so a fast machine is not slowed to the
    /// worst case and a slow one is not flaky.
    private func eventually(
        within seconds: TimeInterval = 2,
        _ condition: @Sendable () -> Bool
    ) -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if condition() { return true }
            Thread.sleep(forTimeInterval: 0.01)
        }
        return condition()
    }

    @Test("an armed timer fires")
    func anArmedTimerFires() {
        let fired = Mutex<[TimerId]>([])
        let scheduler = DispatchRetryScheduler { timer in
            fired.withLock { seen in
                seen.append(timer)
            }
        }

        let timer = scheduler.arm(delayMillis: 10)
        #expect(eventually { fired.withLock { $0 } == [timer] })
        #expect(scheduler.armedCount == 0)
    }

    @Test("a cancelled timer never fires")
    func aCancelledTimerNeverFires() {
        let fired = Mutex<Int>(0)
        let scheduler = DispatchRetryScheduler { _ in
            fired.withLock { count in
                count += 1
            }
        }

        let timer = scheduler.arm(delayMillis: 200)
        scheduler.cancel(timer: timer)
        #expect(scheduler.armedCount == 0)

        // Well past the delay: the block did run, found its id gone, and
        // returned. That is the design — cancellation is a membership test at
        // fire time, not a cancellation that has to propagate.
        Thread.sleep(forTimeInterval: 0.4)
        #expect(fired.withLock { $0 } == 0)
    }

    @Test("cancelling an already-fired timer is a no-op")
    func cancellingAFiredTimerIsANoOp() {
        // The engine cancels the timer it believes is armed at the top of every
        // drain — including the timer that just fired and caused that drain. If
        // this were an error, every successful retry would report one.
        let fired = Mutex<Int>(0)
        let scheduler = DispatchRetryScheduler { _ in
            fired.withLock { count in
                count += 1
            }
        }

        let timer = scheduler.arm(delayMillis: 1)
        #expect(eventually { fired.withLock { $0 } == 1 })

        scheduler.cancel(timer: timer)
        scheduler.cancel(timer: timer)
        scheduler.cancel(timer: 9_999)
        #expect(fired.withLock { $0 } == 1)
        #expect(scheduler.armedCount == 0)
    }

    @Test("timer ids are never reused")
    func timerIdsAreUnique() {
        let scheduler = DispatchRetryScheduler { _ in }
        // Long delays so nothing fires during the test; the ids are what matter.
        let issued = (0..<100).map { _ in scheduler.arm(delayMillis: 60_000) }
        #expect(Set(issued).count == issued.count)
        #expect(!issued.contains(0))
        #expect(scheduler.armedCount == issued.count)

        scheduler.cancelAll()
        #expect(scheduler.armedCount == 0)
    }

    @Test("a negative delay is treated as immediate rather than trapping")
    func aNegativeDelayFiresImmediately() {
        let fired = Mutex<Int>(0)
        let scheduler = DispatchRetryScheduler { _ in
            fired.withLock { count in
                count += 1
            }
        }
        _ = scheduler.arm(delayMillis: -5_000)
        #expect(eventually { fired.withLock { $0 } == 1 })
    }
}
