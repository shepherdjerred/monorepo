@testable import GlanceApp
import Testing

// MARK: - CallCounter

/// Thread-safe counter for testing async callbacks.
private actor CallCounter {
    var count = 0

    func increment() {
        self.count += 1
    }
}

// MARK: - PollingSchedulerTests

struct PollingSchedulerTests {
    @Test
    func `tickNow fires the callback`() async {
        let counter = CallCounter()
        let scheduler = PollingScheduler(interval: .seconds(999)) {
            await counter.increment()
        }

        await scheduler.tickNow()

        let count = await counter.count
        #expect(count == 1)
    }

    @Test
    func `multiple tickNow calls accumulate`() async {
        let counter = CallCounter()
        let scheduler = PollingScheduler(interval: .seconds(999)) {
            await counter.increment()
        }

        await scheduler.tickNow()
        await scheduler.tickNow()
        await scheduler.tickNow()

        let count = await counter.count
        #expect(count == 3)
    }

    @Test
    func `stop cancels the polling loop`() async {
        let scheduler = PollingScheduler(interval: .seconds(999)) {}

        await scheduler.start()
        await scheduler.stop()
    }
}
