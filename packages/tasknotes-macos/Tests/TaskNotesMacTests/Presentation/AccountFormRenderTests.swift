import Foundation
import Testing

@Suite("Account form presentation proof", .serialized) @MainActor
struct AccountFormRenderTests {
    @Test func desktopInlineFailure() async throws {
        let fixture = FacetAccountRenderFixture(.failure)
        let result = try await OffscreenSnapshot.writeSettled(
            fixture.view, named: "facet-account-macos-failure",
            size: CGSize(width: 520, height: 560), appearance: .light)
        #expect(result.distinctColors > 8 && result.byteCount > 1000)
        #expect(result.pixelSize == CGSize(width: 1040, height: 1120))
        try SnapshotLog.line(result.reportLine)
    }
}
