import Foundation
@testable import GlanceApp
import Testing

struct CloudflareProviderTests {
    @Test
    func `all active returns ok`() throws {
        let json = Data("""
        {"success": true, "result": \
        [{"id": "z1", "name": "example.com", "status": "active"}], \
        "errors": []}
        """.utf8)
        let snapshot = try CloudflareProvider.parse(json)
        #expect(snapshot.status == .ok)
        #expect(snapshot.summary == "1 zone active")
    }

    @Test
    func `inactive returns warning`() throws {
        let json = Data("""
        {"success": true, "result": \
        [{"id": "z1", "name": "a.com", "status": "active"}, \
        {"id": "z2", "name": "b.com", "status": "paused"}], \
        "errors": []}
        """.utf8)
        let snapshot = try CloudflareProvider.parse(json)
        #expect(snapshot.status == .warning)
    }

    @Test
    func `api error returns unknown`() throws {
        let json = Data("""
        {"success": false, "result": [], \
        "errors": [{"message": "Auth error"}]}
        """.utf8)
        let snapshot = try CloudflareProvider.parse(json)
        #expect(snapshot.status == .unknown)
        #expect(snapshot.error == "Auth error")
    }

    @Test
    func `malformed JSON throws`() {
        #expect(throws: (any Error).self) {
            try CloudflareProvider.parse(Data("x".utf8))
        }
    }
}
