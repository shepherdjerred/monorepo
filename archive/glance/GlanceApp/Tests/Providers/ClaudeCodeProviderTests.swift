import Foundation
@testable import GlanceApp
import Testing

struct ClaudeCodeProviderTests {
    @Test
    func `low util returns ok`() throws {
        let json = Data("""
        {"five_hour": {"utilization": 25.0, "resets_at": null}, \
        "seven_day": {"utilization": 40.0, "resets_at": null}}
        """.utf8)
        let snapshot = try ClaudeCodeProvider.parse(json)
        #expect(snapshot.status == .ok)
    }

    @Test
    func `high util returns warning`() throws {
        let json = Data("""
        {"five_hour": {"utilization": 85.0, "resets_at": null}, \
        "seven_day": {"utilization": 50.0, "resets_at": null}}
        """.utf8)
        let snapshot = try ClaudeCodeProvider.parse(json)
        #expect(snapshot.status == .warning)
    }

    @Test
    func `critical util returns error`() throws {
        let json = Data("""
        {"five_hour": {"utilization": 98.0, "resets_at": null}, \
        "seven_day": {"utilization": 70.0, "resets_at": null}}
        """.utf8)
        let snapshot = try ClaudeCodeProvider.parse(json)
        #expect(snapshot.status == .error)
    }

    @Test
    func `null windows handled`() throws {
        let json = Data("""
        {"five_hour": null, "seven_day": null}
        """.utf8)
        let snapshot = try ClaudeCodeProvider.parse(json)
        #expect(snapshot.status == .ok)
    }

    @Test
    func `malformed JSON throws`() {
        #expect(throws: (any Error).self) {
            try ClaudeCodeProvider.parse(Data("x".utf8))
        }
    }
}
