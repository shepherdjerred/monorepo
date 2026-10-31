import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite @MainActor struct FacetStoreAccountRestoreTests {
    @Test func onlySuccessfulServiceResultPublishesVaults() async {
        let store = FacetStore()
        await store.restoreAccountSessionWithOperations(
            restore: {
                #expect(!store.accountTransition && store.isLoading)
                #expect(store.accountPresentation.operation == .restoring)
                return .vaults([])
            }, connections: { [] }, ownsAccount: { true })
        #expect(store.accountPresentation.stage == .vaults)
        #expect(store.accountPresentation.error == nil)
        #expect(!store.accountPresentation.restoreFailed)
        #expect(!store.accountTransition && !store.isLoading)
    }

    @Test func expiredAndMissingSessionsDoNotPretendVaultSelectionSucceeded() async {
        let store = FacetStore()
        await store.restoreAccountSessionWithOperations(
            restore: { .noSession }, connections: { [] }, ownsAccount: { true })
        #expect(store.accountPresentation.stage == .credentials)
        #expect(store.accountPresentation.error == nil)
        await store.restoreAccountSessionWithOperations(
            restore: { .expired }, connections: { [] }, ownsAccount: { true })
        #expect(store.accountPresentation.stage == .credentials)
        #expect(store.accountPresentation.error?.contains("expired") == true)
        #expect(!store.accountPresentation.restoreFailed)
        #expect(store.remoteVaults.isEmpty)
    }

    @Test func networkFailureIsVisibleRetryableAndLeavesTheEngineUntouched() async {
        let store = FacetStore()
        await store.restoreAccountSessionWithOperations(
            restore: { throw URLError(.notConnectedToInternet) }, connections: { [] },
            ownsAccount: { true })
        #expect(store.accountPresentation.stage == .credentials)
        #expect(store.accountPresentation.error?.contains("reach Obsidian") == true)
        #expect(store.accountPresentation.restoreFailed)
        #expect(store.engine == nil && store.profiles.isEmpty)
        await store.restoreAccountSessionWithOperations(
            restore: { .vaults([]) }, connections: { [] }, ownsAccount: { true })
        #expect(store.accountPresentation.stage == .vaults)
        #expect(!store.accountPresentation.restoreFailed)
    }

    @Test func startupRestorationPreservesOuterLoadingOwnership() async {
        let store = FacetStore()
        store.isLoading = true
        var calls = 0
        await store.restoreAccountSessionWithOperations(
            restore: {
                calls += 1
                return .noSession
            }, connections: { [] },
            ownsAccount: { true })
        #expect(calls == 0 && store.isLoading)
        await store.restoreAccountSessionWithOperations(
            restore: {
                calls += 1
                return .vaults([])
            }, connections: { [] },
            ownsAccount: { true }, startup: true)
        #expect(calls == 1 && store.isLoading)
        #expect(!store.accountTransition)
    }

    @Test func cancelledOrReplacedOwnerCannotPublishLateChoices() async {
        let store = FacetStore()
        await store.restoreAccountSessionWithOperations(
            restore: {
                store.foreground = false
                return .vaults([])
            }, connections: { [] }, ownsAccount: { true })
        #expect(store.accountPresentation.stage == .credentials)
        #expect(store.accountPresentation.notice == nil)
        #expect(!store.accountPresentation.restoreAttempted)
        store.foreground = true
        await store.restoreAccountSessionWithOperations(
            restore: { .vaults([]) }, connections: { [] }, ownsAccount: { true })
        #expect(store.accountPresentation.stage == .vaults)
        #expect(store.accountPresentation.restoreAttempted)
        let replacement = UUID()
        await store.restoreAccountSessionWithOperations(
            restore: {
                store.accountPresentation.requestID = replacement
                return .vaults([])
            }, connections: { [] }, ownsAccount: { true })
        #expect(store.accountPresentation.requestID == replacement)
        #expect(store.accountPresentation.stage == .credentials)
    }
}
