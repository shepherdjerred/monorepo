import Foundation
import SwiftUI
import Testing

@testable import TaskNotesFacetUI

@Suite("Native delight component renders", .serialized) @MainActor
struct FacetDelightRenderTests {
    @Test(arguments: FacetDelightGalleryState.allCases, SnapshotAppearance.allCases)
    func desktop(state: FacetDelightGalleryState, appearance: SnapshotAppearance) async throws {
        let fixture = try await FacetDelightGalleryFixture.open(state)
        let result = try await OffscreenSnapshot.writeSettled(
            FacetDelightGalleryFrame(fixture: fixture),
            named: "facet-delight-macos-\(state.rawValue)", size: state.size, appearance: appearance
        )
        #expect(result.distinctColors > 8 && result.byteCount > 1000)
        try SnapshotLog.line(result.reportLine)
        try await fixture.close()
    }
    @Test(arguments: [
        FacetDelightGalleryState.captureParsed, .captureDetails, .settingsRecovery, .completed,
    ])
    func adaptive(state: FacetDelightGalleryState) async throws {
        let fixture = try await FacetDelightGalleryFixture.open(state)
        let result = try await OffscreenSnapshot.writeSettled(
            FacetDelightGalleryFrame(fixture: fixture).environment(
                \.dynamicTypeSize, .accessibility3),
            named: "facet-delight-macos-\(state.rawValue)-large-type", size: state.size,
            appearance: .light)
        #expect(result.distinctColors > 8 && result.byteCount > 1000)
        try SnapshotLog.line(result.reportLine)
        try await fixture.close()
    }
}
