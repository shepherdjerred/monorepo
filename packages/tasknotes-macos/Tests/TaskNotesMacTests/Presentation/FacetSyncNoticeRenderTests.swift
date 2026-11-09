import Foundation
import SwiftUI
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Synthetic Sync status renders", .serialized) @MainActor
struct FacetSyncNoticeRenderTests {
    @Test(arguments: [false, true], [SnapshotAppearance.light, .dark])
    func configurationSetup(initialComplete: Bool, appearance: SnapshotAppearance) throws {
        let store = try FacetSurfaceFixtures.store(.empty)
        let profileID = try #require(store.selectedProfileID)
        let original = try #require(store.snapshot)
        guard case .object(var fields) = try FacetJSON.parse(JSONEncoder().encode(original)) else {
            throw FacetContractError.unsupportedResponse
        }
        fields["configuration"] = .null
        fields["problems"] = .array([
            .object([
                "path": .string("tasknotes.yaml"),
                "message": .string(
                    "Waiting for TaskNotes configuration; editing requires configuration "
                        + "or explicit approval of standard settings"
                ),
            ])
        ])
        store.snapshot = try FacetFeatureProjection.decode(
            FacetSnapshot.self, from: .object(fields))
        store.profiles = [
            FacetProfile(
                id: profileID, name: "Synthetic vault", kind: "obsidian_sync",
                approveStandard: false)
        ]
        store.needsStandardConsent = initialComplete
        store.syncStatuses[profileID] = FacetSyncStatus(
            transport: .connected,
            durable: FacetDurableSyncStatus(
                schemaVersion: 1, profileId: profileID, profileKind: "obsidian_sync", version: 1,
                initialSyncComplete: initialComplete, pendingRemoteCount: initialComplete ? 0 : 42,
                pendingUploadCount: 0, conflictCount: 0, pendingMutationCount: 0))
        try record(
            FacetNativeWorkspace(
                store: store, importsFolder: .constant(false), capturePresented: .constant(false),
                sheets: FacetSheetPresentation()),
            named: initialComplete
                ? "facet-vault-configuration-consent" : "facet-vault-downloading",
            size: CGSize(width: 1000, height: 700), appearance: appearance)
    }

    @Test(arguments: [
        FacetSyncPhase.offline, .reconnectRequired, .conflict, .syncing, .synced,
    ])
    func workspace(phase: FacetSyncPhase) throws {
        let store = try FacetSurfaceFixtures.store(.populated)
        let profileID = try #require(store.selectedProfileID)
        let durable = FacetDurableSyncStatus(
            schemaVersion: 1, profileId: profileID, profileKind: "obsidian_sync", version: 1,
            initialSyncComplete: phase != .syncing, pendingRemoteCount: 0, pendingUploadCount: 0,
            conflictCount: phase == .conflict ? 1 : 0, pendingMutationCount: 0)
        let transport: FacetSyncTransportPhase
        switch phase {
        case .offline: transport = .offline
        case .reconnectRequired: transport = .reconnectRequired
        case .conflict, .syncing, .synced: transport = .connected
        case .connecting, .failed, .stopped: throw FacetContractError.unsupportedResponse
        }
        store.syncStatuses[profileID] = FacetSyncStatus(transport: transport, durable: durable)
        let result = try OffscreenSnapshot.write(
            FacetNativeWorkspace(
                store: store, importsFolder: .constant(false), capturePresented: .constant(false),
                sheets: FacetSheetPresentation()),
            named: "facet-sync-synthetic-\(phase.rawValue)", size: CGSize(width: 1200, height: 700),
            appearance: .light)
        #expect(result.distinctColors > 8 && result.byteCount > 1000)
        try SnapshotLog.line(result.reportLine)
        try SnapshotLog.line(
            "SYNC_STATUS_FIXTURE phase=\(phase.rawValue) evidence=synthetic-offscreen-not-live")
    }
}
