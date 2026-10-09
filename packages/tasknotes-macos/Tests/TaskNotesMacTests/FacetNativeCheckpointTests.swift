import Foundation
import SwiftUI
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Native composition checkpoint", .serialized) @MainActor
struct FacetNativeCheckpointTests {
    @Test func everyGalleryInputSatisfiesTheNativeSnapshotContract() throws {
        for state in FacetNativeGalleryState.allCases {
            let fixture = try FacetNativeGalleryFixture(state)
            if let snapshot = fixture.store.snapshot, !snapshot.tasks.isEmpty {
                #expect(snapshot.tasks.first?.occurrenceDate == "2026-10-09")
                #expect(snapshot.tasks.dropFirst().allSatisfy { $0.occurrenceDate == nil })
            }
        }
        let upcoming = try FacetNativeGalleryFixture(.upcoming)
        #expect(upcoming.store.snapshot?.groups.count == 2)
    }

    @Test func galleryIDsMatchCanonicalPresentationContract() throws {
        let packages = URL(filePath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let contract = try FacetJSON.parse(
            Data(
                contentsOf: packages.appending(
                    path: "tasknotes-fixtures/presentation/reference-matrix.json")))
        let states = try #require(contract.object?.fields["referenceStates"]?.array?.elements)
        let variants = try #require(contract.object?.fields["adaptiveVariants"]?.array?.elements)
        #expect(states.count == FacetNativeGalleryState.allCases.count)
        #expect(variants.count == FacetNativeGalleryVariant.allCases.count)
        #expect(
            Set(states.compactMap(\.text)) == Set(FacetNativeGalleryState.allCases.map(\.rawValue)))
        #expect(
            Set(variants.compactMap(\.text))
                == Set(FacetNativeGalleryVariant.allCases.map(\.rawValue)))
    }

    @Test(arguments: FacetNativeGalleryState.allCases, SnapshotAppearance.allCases)
    func desktopReference(state: FacetNativeGalleryState, appearance: SnapshotAppearance) throws {
        let fixture = try FacetNativeGalleryFixture(state)
        try nativeFrame(
            FacetNativeGalleryFrame(fixture: fixture), name: state.rawValue,
            size: state.desktopSize, appearance: appearance, coversReference: true)
    }

    @Test(arguments: FacetNativeGalleryVariant.allCases.filter { $0 != .reducedMotion })
    func desktopAdaptive(variant: FacetNativeGalleryVariant) throws {
        let fixture = try FacetNativeGalleryFixture(
            variant.state, longLabels: variant == .longLabels)
        try nativeFrame(
            FacetNativeGalleryFrame(fixture: fixture, variant: variant), name: variant.rawValue,
            size: variant.desktopSize, appearance: .light, coversReference: variant.coversReference,
            highContrast: variant == .highContrast)
    }

    private func nativeFrame(
        _ view: some View, name: String, size: CGSize, appearance: SnapshotAppearance,
        coversReference: Bool, highContrast: Bool = false
    ) throws {
        let result = try OffscreenSnapshot.write(
            view, named: "facet-native-macos-\(name)", size: size, appearance: appearance,
            highContrast: highContrast)
        #expect(result.distinctColors > 8)
        #expect(result.byteCount > 1000)
        #expect(result.pixelSize == CGSize(width: size.width * 2, height: size.height * 2))
        try SnapshotLog.line(result.reportLine)
        try SnapshotLog.line(
            "NATIVE_GALLERY_FIXTURE platform=macos reference=\(name) "
                + "appearance=\(appearance.rawValue) referenceCoverage=\(coversReference) "
                + "evidence=offscreen-native-view-with-synthetic-inputs")
    }

    @Test(arguments: SnapshotAppearance.allCases)
    func desktopList(appearance: SnapshotAppearance) throws {
        let store = try FacetSurfaceFixtures.store(.populated)
        let result = try OffscreenSnapshot.write(
            FacetNativeWorkspace(store: store, importsFolder: .constant(false)),
            named: "facet-native-desktop-checkpoint", size: CGSize(width: 1200, height: 700),
            appearance: appearance)
        #expect(result.distinctColors > 8)
        #expect(result.byteCount > 1000)
        try SnapshotLog.line(result.reportLine)
    }

    @Test(arguments: SnapshotAppearance.allCases)
    func desktopInspector(appearance: SnapshotAppearance) throws {
        let store = try FacetSurfaceFixtures.store(.relationships)
        let snapshot = try #require(store.snapshot)
        let task = try #require(snapshot.tasks.first)
        let result = try OffscreenSnapshot.write(
            FacetNativeInspector(
                store: store, window: FacetWindowState(store: store),
                draft: FacetInspectorDraft(task: task, profileID: snapshot.profileId),
                configuration: snapshot.configuration),
            named: "facet-native-inspector-checkpoint", size: CGSize(width: 380, height: 850),
            appearance: appearance)
        #expect(result.distinctColors > 8)
        #expect(result.byteCount > 1000)
        try SnapshotLog.line(result.reportLine)
    }
}
