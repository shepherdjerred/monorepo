import Foundation
@testable import GlanceApp
import Testing

struct PrometheusProviderTests {
    @Test
    func `all targets up returns ok`() throws {
        let json = Data("""
        {"data": {"activeTargets": \
        [{"labels": {"job": "p", "instance": "l:9090"}, \
        "health": "up"}]}}
        """.utf8)
        let snapshot = try PrometheusProvider.parse(json)
        #expect(snapshot.status == .ok)
        #expect(snapshot.summary == "1 targets, 0 down")
    }

    @Test
    func `many targets down returns error`() throws {
        let json = Data("""
        {"data": {"activeTargets": [\
        {"labels": {"job": "a", "instance": "a:1"}, "health": "up"}, \
        {"labels": {"job": "b", "instance": "b:1"}, "health": "down"}, \
        {"labels": {"job": "c", "instance": "c:1"}, "health": "down"}, \
        {"labels": {"job": "d", "instance": "d:1"}, "health": "down"}\
        ]}}
        """.utf8)
        let snapshot = try PrometheusProvider.parse(json)
        #expect(snapshot.status == .error)
    }

    @Test
    func `empty targets returns ok`() throws {
        let json = Data("""
        {"data": {"activeTargets": []}}
        """.utf8)
        let snapshot = try PrometheusProvider.parse(json)
        #expect(snapshot.status == .ok)
    }

    @Test
    func `malformed JSON throws`() {
        #expect(throws: (any Error).self) {
            try PrometheusProvider.parse(Data("x".utf8))
        }
    }
}
