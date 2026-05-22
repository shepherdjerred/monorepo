import Foundation
@testable import GlanceApp
import Testing

struct ArgoCDProviderTests {
    @Test
    func `all healthy synced returns ok`() throws {
        let json = Data("""
        {"items": [{"metadata": {"name": "a", "namespace": "argocd"}, \
        "status": {"sync": {"status": "Synced"}, "health": {"status": "Healthy"}}}]}
        """.utf8)
        let snapshot = try ArgoCDProvider.parse(json)
        #expect(snapshot.status == .ok)
    }

    @Test
    func `degraded app returns error`() throws {
        let json = Data("""
        {"items": [{"metadata": {"name": "a", "namespace": "argocd"}, \
        "status": {"sync": {"status": "Synced"}, "health": {"status": "Degraded"}}}]}
        """.utf8)
        let snapshot = try ArgoCDProvider.parse(json)
        #expect(snapshot.status == .error)
    }

    @Test
    func `out of sync returns warning`() throws {
        let json = Data("""
        {"items": [{"metadata": {"name": "a", "namespace": "argocd"}, \
        "status": {"sync": {"status": "OutOfSync"}, "health": {"status": "Healthy"}}}]}
        """.utf8)
        let snapshot = try ArgoCDProvider.parse(json)
        #expect(snapshot.status == .warning)
    }

    @Test
    func `empty apps returns ok`() throws {
        let snapshot = try ArgoCDProvider.parse(Data("{\"items\": []}".utf8))
        #expect(snapshot.status == .ok)
    }

    @Test
    func `malformed JSON throws`() {
        #expect(throws: (any Error).self) { try ArgoCDProvider.parse(Data("{bad".utf8)) }
    }
}
