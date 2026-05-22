import Foundation
@testable import GlanceApp
import Testing

struct GitHubProviderTests {
    @Test
    func `open P rs returns ok`() throws {
        let json = Data("""
        {"items": [{"id": 1, "number": 42, "title": "PR", \
        "state": "open", "draft": false, \
        "html_url": "https://x", "user": {"login": "d"}, \
        "created_at": "2024-01-01T00:00:00Z"}]}
        """.utf8)
        let snapshot = try GitHubProvider.parse(json)
        #expect(snapshot.status == .ok)
        #expect(snapshot.summary == "1 open PR")
    }

    @Test
    func `no P rs`() throws {
        let snapshot = try GitHubProvider.parse(
            Data("{\"items\": []}".utf8),
        )
        #expect(snapshot.summary == "No open PRs")
    }

    @Test
    func `malformed JSON throws`() {
        #expect(throws: (any Error).self) {
            try GitHubProvider.parse(Data("{}".utf8))
        }
    }
}
