import Foundation
import SwiftUI
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Synthetic Sync status renders", .serialized) @MainActor
struct FacetSyncNoticeRenderTests {
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
            FacetNativeWorkspace(store: store, importsFolder: .constant(false)),
            named: "facet-sync-synthetic-\(phase.rawValue)", size: CGSize(width: 1200, height: 700),
            appearance: .light)
        #expect(result.distinctColors > 8 && result.byteCount > 1000)
        try SnapshotLog.line(result.reportLine)
        try SnapshotLog.line(
            "SYNC_STATUS_FIXTURE phase=\(phase.rawValue) evidence=synthetic-offscreen-not-live")
    }
}
