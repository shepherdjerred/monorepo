import Foundation
@testable import GlanceApp
import Testing

struct BugsinkProviderTests {
    @Test
    func `no issues returns ok`() throws {
        let project = BugsinkProject(
            id: 1, name: "App", digestedEventCount: 0,
        )
        let snapshot = try BugsinkProvider.parse(
            issueDataByProject: [
                (project: project, issuesData: Data("{\"results\": []}".utf8)),
            ],
        )
        #expect(snapshot.status == .ok)
        #expect(snapshot.summary == "No unresolved issues")
    }

    @Test
    func `unresolved returns warning`() throws {
        let jsonString = """
        {"results": [{"id": "i1", "digest_order": 1, \
        "calculated_type": "Error", "calculated_value": "msg", \
        "digested_event_count": 5, "is_resolved": false, \
        "last_seen": "2024-01-01T00:00:00Z"}]}
        """
        let json = Data(jsonString.utf8)
        let project = BugsinkProject(
            id: 1, name: "App", digestedEventCount: 5,
        )
        let snapshot = try BugsinkProvider.parse(
            issueDataByProject: [(project: project, issuesData: json)],
        )
        #expect(snapshot.status == .warning)
    }

    @Test
    func `resolved filtered`() throws {
        let jsonString = """
        {"results": [{"id": "r1", "digest_order": 1, \
        "calculated_type": "E", "calculated_value": "fixed", \
        "digested_event_count": 10, "is_resolved": true, \
        "last_seen": "2024-01-01T00:00:00Z"}]}
        """
        let json = Data(jsonString.utf8)
        let project = BugsinkProject(
            id: 1, name: "App", digestedEventCount: 10,
        )
        let snapshot = try BugsinkProvider.parse(
            issueDataByProject: [(project: project, issuesData: json)],
        )
        #expect(snapshot.status == .ok)
    }

    @Test
    func `empty projects returns ok`() throws {
        let snapshot = try BugsinkProvider.parse(issueDataByProject: [])
        #expect(snapshot.status == .ok)
    }

    @Test
    func `malformed JSON throws`() {
        let project = BugsinkProject(
            id: 1, name: "A", digestedEventCount: 0,
        )
        #expect(throws: (any Error).self) {
            try BugsinkProvider.parse(
                issueDataByProject: [
                    (project: project, issuesData: Data("x".utf8)),
                ],
            )
        }
    }
}
