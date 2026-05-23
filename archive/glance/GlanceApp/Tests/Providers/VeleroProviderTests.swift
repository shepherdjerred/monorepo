import Foundation
@testable import GlanceApp
import Testing

struct VeleroProviderTests {
    @Test
    func `completed returns ok`() throws {
        let json = Data("""
        {"items": [{"metadata": {"name": "d1"}, \
        "status": {"phase": "Completed", \
        "completionTimestamp": "2024-01-01T06:00:00Z", "errors": 0, "warnings": 0}}]}
        """.utf8)
        let snapshot = try VeleroProvider.parse(json)
        #expect(snapshot.status == .ok)
    }

    @Test
    func `failed returns warning`() throws {
        let json = Data("""
        {"items": [{"metadata": {"name": "d1"}, \
        "status": {"phase": "Failed", "completionTimestamp": null, \
        "errors": 3, "warnings": 1}}]}
        """.utf8)
        let snapshot = try VeleroProvider.parse(json)
        #expect(snapshot.status == .warning)
    }

    @Test
    func `no backups returns unknown`() throws {
        let snapshot = try VeleroProvider.parse(Data("{\"items\": []}".utf8))
        #expect(snapshot.status == .unknown)
    }

    @Test
    func `malformed JSON throws`() {
        #expect(throws: (any Error).self) { try VeleroProvider.parse(Data("x".utf8)) }
    }
}
