import Foundation
@testable import GlanceApp
import Testing

struct AlertmanagerProviderTests {
    @Test
    func `no alerts returns ok`() throws {
        let json = Data("[]".utf8)
        let snapshot = try AlertmanagerProvider.parse(json)
        #expect(snapshot.status == .ok)
        #expect(snapshot.summary == "No active alerts")
    }

    @Test
    func `active warning alert returns warning`() throws {
        let json = Data("""
        [
            {
                "fingerprint": "abc123",
                "labels": {"alertname": "HighMemory", "severity": "warning"},
                "annotations": {"summary": "Memory is high"},
                "status": {"state": "active"},
                "startsAt": "2024-01-01T00:00:00Z"
            }
        ]
        """.utf8)
        let snapshot = try AlertmanagerProvider.parse(json)
        #expect(snapshot.status == .warning)
        #expect(snapshot.summary == "1 active alert")
    }

    @Test
    func `critical alert returns error`() throws {
        let json = Data("""
        [
            {
                "fingerprint": "crit1",
                "labels": {"alertname": "NodeDown", "severity": "critical"},
                "annotations": {"summary": "Node is down"},
                "status": {"state": "active"},
                "startsAt": "2024-01-01T00:00:00Z"
            }
        ]
        """.utf8)
        let snapshot = try AlertmanagerProvider.parse(json)
        #expect(snapshot.status == .error)
    }

    @Test
    func `suppressed alerts not counted`() throws {
        let json = Data("""
        [
            {
                "fingerprint": "sup1",
                "labels": {"alertname": "Suppressed", "severity": "critical"},
                "annotations": {},
                "status": {"state": "suppressed"},
                "startsAt": "2024-01-01T00:00:00Z"
            }
        ]
        """.utf8)
        let snapshot = try AlertmanagerProvider.parse(json)
        #expect(snapshot.status == .ok)
        #expect(snapshot.summary == "No active alerts")
    }

    @Test
    func `malformed JSON throws`() {
        let badData = Data("{bad}".utf8)
        #expect(throws: (any Error).self) {
            try AlertmanagerProvider.parse(badData)
        }
    }
}
