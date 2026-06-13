@testable import GlanceApp
import Testing

struct ServiceStatusTests {
    @Test
    func `ok is less severe than warning`() {
        #expect(ServiceStatus.ok < .warning)
    }

    @Test
    func `warning is less severe than error`() {
        #expect(ServiceStatus.warning < .error)
    }

    @Test
    func `error is less severe than unknown`() {
        #expect(ServiceStatus.error < .unknown)
    }

    @Test
    func `severity ordering is complete`() {
        #expect(ServiceStatus.ok < .warning)
        #expect(ServiceStatus.warning < .error)
        #expect(ServiceStatus.error < .unknown)
    }

    @Test
    func `max of mixed statuses returns worst`() {
        let statuses: [ServiceStatus] = [.ok, .ok, .warning, .ok]
        #expect(statuses.max() == .warning)
    }

    @Test
    func `max of all-ok returns ok`() {
        let statuses: [ServiceStatus] = [.ok, .ok, .ok]
        #expect(statuses.max() == .ok)
    }

    @Test
    func `max of empty returns nil`() {
        let statuses: [ServiceStatus] = []
        #expect(statuses.max() == nil)
    }

    @Test
    func `max with error and unknown returns unknown`() {
        let statuses: [ServiceStatus] = [.ok, .error, .unknown]
        #expect(statuses.max() == .unknown)
    }
}
