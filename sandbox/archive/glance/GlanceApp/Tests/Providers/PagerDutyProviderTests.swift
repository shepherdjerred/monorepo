import Foundation
@testable import GlanceApp
import Testing

struct PagerDutyProviderTests {
    @Test
    func `no incidents returns ok`() throws {
        let snapshot = try PagerDutyProvider.parse(
            incidentsData: Data("{\"incidents\": []}".utf8),
            onCallsData: Data("{\"oncalls\": []}".utf8),
        )
        #expect(snapshot.status == .ok)
        #expect(snapshot.summary == "No active incidents")
    }

    @Test
    func `triggered returns error`() throws {
        let json = Data("""
        {"incidents": [{"id": "P1", "title": "Down", \
        "status": "triggered", "urgency": "high", \
        "created_at": "2024-01-01T00:00:00Z"}]}
        """.utf8)
        let snapshot = try PagerDutyProvider.parse(
            incidentsData: json,
            onCallsData: Data("{\"oncalls\": []}".utf8),
        )
        #expect(snapshot.status == .error)
    }

    @Test
    func `acknowledged returns warning`() throws {
        let json = Data("""
        {"incidents": [{"id": "P2", "title": "Slow", \
        "status": "acknowledged", "urgency": "low", \
        "created_at": "2024-01-01T00:00:00Z"}]}
        """.utf8)
        let snapshot = try PagerDutyProvider.parse(
            incidentsData: json,
            onCallsData: Data("{\"oncalls\": []}".utf8),
        )
        #expect(snapshot.status == .warning)
    }

    @Test
    func `malformed JSON throws`() {
        #expect(throws: (any Error).self) {
            try PagerDutyProvider.parse(
                incidentsData: Data("x".utf8),
                onCallsData: Data("{\"oncalls\":[]}".utf8),
            )
        }
    }
}
