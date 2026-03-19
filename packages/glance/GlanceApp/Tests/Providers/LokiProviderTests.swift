import Foundation
@testable import GlanceApp
import Testing

struct LokiProviderTests {
    @Test
    func `no errors returns ok`() throws {
        let json = Data("{\"data\": {\"result\": []}}".utf8)
        let snapshot = try LokiProvider.parse(json)
        #expect(snapshot.status == .ok)
        #expect(snapshot.summary == "No errors in last 30m")
    }

    @Test
    func `few errors returns warning`() throws {
        let json = Data("""
        {"data": {"result": [{"stream": {"app": "t"}, \
        "values": [["170", "e1"], ["171", "e2"]]}]}}
        """.utf8)
        let snapshot = try LokiProvider.parse(json)
        #expect(snapshot.status == .warning)
    }

    @Test
    func `single error singular`() throws {
        let json = Data("""
        {"data": {"result": [{"stream": {"app": "t"}, \
        "values": [["170", "one"]]}]}}
        """.utf8)
        let snapshot = try LokiProvider.parse(json)
        #expect(snapshot.summary == "1 error in last 30m")
    }

    @Test
    func `custom lookback`() throws {
        let json = Data("{\"data\": {\"result\": []}}".utf8)
        let snapshot = try LokiProvider.parse(
            json, lookbackMinutes: 60,
        )
        #expect(snapshot.summary == "No errors in last 60m")
    }

    @Test
    func `malformed JSON throws`() {
        #expect(throws: (any Error).self) {
            try LokiProvider.parse(Data("x".utf8))
        }
    }
}
