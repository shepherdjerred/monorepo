import Foundation
@testable import GlanceApp
import Testing

struct GrafanaProviderTests {
    @Test
    func `rules returns ok`() throws {
        let json = Data("""
        [{"id": 1, "title": "CPU", "ruleGroup": "infra"}, \
        {"id": 2, "title": "Disk", "ruleGroup": "infra"}]
        """.utf8)
        let snapshot = try GrafanaProvider.parse(json)
        #expect(snapshot.status == .ok)
        #expect(snapshot.summary == "2 alert rules configured")
    }

    @Test
    func `single rule singular`() throws {
        let json = Data("""
        [{"id": 1, "title": "Solo", "ruleGroup": null}]
        """.utf8)
        let snapshot = try GrafanaProvider.parse(json)
        #expect(snapshot.summary == "1 alert rule configured")
    }

    @Test
    func `empty rules`() throws {
        let snapshot = try GrafanaProvider.parse(Data("[]".utf8))
        #expect(snapshot.summary == "0 alert rules configured")
    }

    @Test
    func `malformed JSON throws`() {
        #expect(throws: (any Error).self) {
            try GrafanaProvider.parse(Data("x".utf8))
        }
    }
}
