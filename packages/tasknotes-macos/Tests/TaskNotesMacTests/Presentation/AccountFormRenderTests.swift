import Foundation
import TaskNotesUniFFI
import Testing

@testable import TaskNotesFacetUI

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

    @Test(arguments: [
        ("account_rejected", 320), ("account_rejected", 520),
        ("protocol", 320), ("protocol", 520),
    ])
    func desktopTypedAccountFailure(code: String, width: Int) async throws {
        let fixture = FacetAccountRenderFixture(.failure)
        fixture.store.accountPresentation.error = FacetAccountPresentation.failureMessage(
            ObsidianBoundaryError.Boundary(code: code, detail: "synthetic response"))
        let result = try await OffscreenSnapshot.writeSettled(
            fixture.view, named: "facet-account-macos-\(code)-\(width)",
            size: CGSize(width: CGFloat(width), height: 560), appearance: .light)
        #expect(result.distinctColors > 8 && result.byteCount > 1000)
        #expect(result.pixelSize == CGSize(width: CGFloat(width * 2), height: 1120))
        try SnapshotLog.line(result.reportLine)
    }
}
