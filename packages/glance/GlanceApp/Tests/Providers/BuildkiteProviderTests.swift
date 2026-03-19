import Foundation
@testable import GlanceApp
import Testing

struct BuildkiteProviderTests {
    @Test
    func `all passing returns ok`() throws {
        let jsonString = """
        [{"id": "p1", "name": "P", "slug": "p", \
        "builds_url": null, "latestBuild": {"id": "b1", \
        "number": 1, "state": "passed", "message": "ok", \
        "created_at": "2024-01-01T00:00:00Z"}}]
        """
        let snapshot = try BuildkiteProvider.parse(
            Data(jsonString.utf8),
        )
        #expect(snapshot.status == .ok)
        #expect(snapshot.summary == "1 pipeline")
    }

    @Test
    func `failed pipeline returns error`() throws {
        let jsonString = """
        [{"id": "p1", "name": "B", "slug": "b", \
        "builds_url": null, "latestBuild": {"id": "b1", \
        "number": 1, "state": "failed", "message": "bad", \
        "created_at": "2024-01-01T00:00:00Z"}}]
        """
        let snapshot = try BuildkiteProvider.parse(
            Data(jsonString.utf8),
        )
        #expect(snapshot.status == .error)
    }

    @Test
    func `empty pipelines`() throws {
        let snapshot = try BuildkiteProvider.parse(Data("[]".utf8))
        #expect(snapshot.status == .ok)
        #expect(snapshot.summary == "0 pipelines")
    }

    @Test
    func `malformed JSON throws`() {
        #expect(throws: (any Error).self) {
            try BuildkiteProvider.parse(Data("x".utf8))
        }
    }
}
