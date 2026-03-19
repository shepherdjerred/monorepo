import Foundation
@testable import GlanceApp
import Testing

struct CodexProviderTests {
    @Test
    func `low util returns ok`() throws {
        let json = Data("""
        {"rate_limit": {"primary_window": \
        {"used_percent": 20, "reset_at": 1718460000}, \
        "secondary_window": \
        {"used_percent": 35, "reset_at": 1718900000}}}
        """.utf8)
        let snapshot = try CodexProvider.parse(json)
        #expect(snapshot.status == .ok)
    }

    @Test
    func `high util returns warning`() throws {
        let json = Data("""
        {"rate_limit": {"primary_window": \
        {"used_percent": 85, "reset_at": null}, \
        "secondary_window": \
        {"used_percent": 50, "reset_at": null}}}
        """.utf8)
        let snapshot = try CodexProvider.parse(json)
        #expect(snapshot.status == .warning)
    }

    @Test
    func `critical util returns error`() throws {
        let json = Data("""
        {"rate_limit": {"primary_window": \
        {"used_percent": 97, "reset_at": null}, \
        "secondary_window": \
        {"used_percent": 60, "reset_at": null}}}
        """.utf8)
        let snapshot = try CodexProvider.parse(json)
        #expect(snapshot.status == .error)
    }

    @Test
    func `null rate limit handled`() throws {
        let json = Data("{\"rate_limit\": null}".utf8)
        let snapshot = try CodexProvider.parse(json)
        #expect(snapshot.status == .ok)
    }

    @Test
    func `malformed JSON throws`() {
        #expect(throws: (any Error).self) {
            try CodexProvider.parse(Data("x".utf8))
        }
    }
}
