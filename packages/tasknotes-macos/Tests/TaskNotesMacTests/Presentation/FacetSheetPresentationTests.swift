import Foundation
import SwiftUI
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Workspace account and conflict ownership", .serialized) @MainActor
struct FacetSheetPresentationTests {
    @Test func accountCannotTransferBeforeOriginalFormFinishesTeardown() async {
        let store = FacetStore()
        let first = FacetSheetPresentation()
        let second = FacetSheetPresentation()
        first.account(store: store).wrappedValue = true
        first.accountDidAppear(store: store)
        #expect(first.account(store: store).wrappedValue)
        #expect(!second.account(store: store).wrappedValue)
        let originalOwner = store.accountWindowOwnerID
        let requestID = UUID()
        store.accountPresentation.requestID = requestID
        store.accountPresentation.operation = .connecting
        second.account(store: store).wrappedValue = true
        second.account(store: store).wrappedValue = false
        second.accountDidDisappear(store: store)
        #expect(store.accountWindowOwnerID == originalOwner)
        #expect(first.account(store: store).wrappedValue)
        #expect(store.accountPresentation.requestID == requestID)
        await store.completeAccountConnection(
            requestID: requestID, select: {}, resume: {}, ownsAccount: { true })
        #expect(!first.account(store: store).wrappedValue)
        #expect(store.accountWindowOwnerID == originalOwner)
        second.account(store: store).wrappedValue = true
        #expect(!second.account(store: store).wrappedValue)
        first.accountDidDisappear(store: store)
        second.account(store: store).wrappedValue = true
        #expect(second.account(store: store).wrappedValue)
        first.accountDidDisappear(store: store)
        #expect(second.account(store: store).wrappedValue)
    }

    @Test func closingPendingAccountReleasesOnlyUnmountedClaim() {
        let store = FacetStore()
        let first = FacetSheetPresentation()
        let second = FacetSheetPresentation()
        first.account(store: store).wrappedValue = true
        first.rootDidDisappear(store: store)
        #expect(store.accountWindowOwnerID == nil && !store.showsAccount)
        second.account(store: store).wrappedValue = true
        second.accountDidAppear(store: store)
        second.rootDidDisappear(store: store)
        #expect(second.ownsAccount(store: store))
        first.rootDidAppear()
        first.account(store: store).wrappedValue = true
        #expect(!first.ownsAccount(store: store))
        second.accountDidDisappear(store: store)
        first.account(store: store).wrappedValue = true
        #expect(first.ownsAccount(store: store))
    }

    @Test func closedRequesterCannotPublishDelayedConflictsOrReleaseNewOwner() async throws {
        let context = try await StoreContext.open()
        let vault = context.directory.appendingPathComponent("delayed-conflict-vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let profile = try await context.first.registerLocal(directory: vault, approveStandard: true)
        context.store.selectedProfileID = profile.id
        let first = FacetSheetPresentation()
        let second = FacetSheetPresentation()
        var published = false
        await first.withConflictPresentation(store: context.store) { owns, present in
            _ = await context.store.loadConflictPresentation(
                profileID: profile.id, ownsEngine: owns,
                load: {
                    await _Concurrency.Task.yield()
                    first.rootDidDisappear(store: context.store)
                    await second.openConflicts(store: context.store)
                    #expect(second.conflicts(store: context.store).wrappedValue)
                    return "Delayed conflict page"
                },
                present: { _ in
                    published = true
                    present()
                })
        }
        #expect(!published)
        #expect(second.conflicts(store: context.store).wrappedValue)
        #expect(!first.conflicts(store: context.store).wrappedValue)
        first.conflictsDidDisappear(store: context.store)
        #expect(second.conflicts(store: context.store).wrappedValue)
        try await context.close()
    }

    @Test func conflictRowsPresentOnlyInRequesterAndFailedLoadsReleaseReservation() async throws {
        let context = try await StoreContext.open()
        let vault = context.directory.appendingPathComponent("conflict-sheet-vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let profile = try await context.first.registerLocal(directory: vault, approveStandard: true)
        context.store.selectedProfileID = profile.id
        let first = FacetSheetPresentation()
        let second = FacetSheetPresentation()
        await first.openConflicts(store: context.store)
        #expect(first.conflicts(store: context.store).wrappedValue)
        #expect(!second.conflicts(store: context.store).wrappedValue)
        await second.openConflicts(store: context.store)
        second.conflicts(store: context.store).wrappedValue = false
        second.conflictsDidDisappear(store: context.store)
        #expect(first.conflicts(store: context.store).wrappedValue)
        first.conflicts(store: context.store).wrappedValue = false
        first.conflictsDidDisappear(store: context.store)
        context.store.selectedProfileID = "nonexistent-profile"
        await second.openConflicts(store: context.store)
        #expect(context.store.conflictWindowOwnerID == nil)
        #expect(!second.conflicts(store: context.store).wrappedValue)
        context.store.selectedProfileID = profile.id
        await second.openConflicts(store: context.store)
        #expect(second.conflicts(store: context.store).wrappedValue)
        first.conflictsDidDisappear(store: context.store)
        #expect(second.conflicts(store: context.store).wrappedValue)
        try await context.close()
    }

    @Test func cancelledConflictOpenNeverClaimsOrPresentsAnotherWindow() async {
        let store = FacetStore()
        let sheets = FacetSheetPresentation()
        let operation = _Concurrency.Task { @MainActor in
            await sheets.openConflicts(store: store)
        }
        operation.cancel()
        await operation.value
        #expect(store.conflictWindowOwnerID == nil)
        #expect(!sheets.conflicts(store: store).wrappedValue)
    }
}
