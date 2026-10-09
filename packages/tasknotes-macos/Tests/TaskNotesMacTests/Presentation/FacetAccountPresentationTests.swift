import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite @MainActor struct FacetAccountPresentationTests {
    private func attempt(
        _ store: FacetStore, requestID: UUID = UUID(),
        result: () async throws -> FacetAccountSignIn
    ) async {
        await store.signInWithOperations(
            prepare: {}, signIn: result, connections: { [] }, ownsAccount: { true },
            requestID: requestID)
    }

    @Test func unavailableAccountHasAnInlineErrorInsteadOfSilentReturn() async {
        let store = FacetStore()
        await store.signIn(email: "synthetic@example.invalid", password: "synthetic", code: "")
        #expect(store.accountPresentation.error?.contains("unavailable") == true)
        #expect(store.error == nil)
    }

    @Test func verificationChallengeIsVisibleAndCredentialEditInvalidatesIt() async {
        let store = FacetStore()
        await attempt(store, result: { .needsCode })
        #expect(store.accountNeedsCode)
        #expect(store.accountPresentation.stage == .verification)
        #expect(store.accountPresentation.notice?.contains("verification code") == true)
        await attempt(store, result: { .rejectedCode })
        #expect(store.accountPresentation.error?.contains("rejected") == true)
        store.accountCredentialsChanged()
        #expect(!store.accountNeedsCode)
        #expect(store.accountPresentation.stage == .credentials)
        #expect(store.accountPresentation.error == nil)
    }

    @Test func emptyVaultSuccessSurvivesProgrammaticCredentialClear() async {
        let store = FacetStore()
        await attempt(store, result: { .vaults([]) })
        #expect(store.accountPresentation.stage == .vaults)
        #expect(store.accountPresentation.notice?.contains("Signed in") == true)
        store.accountCredentialsChanged()
        #expect(store.accountPresentation.stage == .vaults)
        #expect(store.accountPresentation.notice?.contains("no Obsidian Sync vaults") == true)
        store.resetAccountChallenge()
        #expect(store.accountPresentation.stage == .credentials)
    }

    @Test func loadingAndCancelledBeforeStartNeverDrainOrAuthenticate() async {
        let store = FacetStore()
        var prepared = 0
        var authenticated = 0
        store.isLoading = true
        await store.signInWithOperations(
            prepare: { prepared += 1 },
            signIn: {
                authenticated += 1
                return .vaults([])
            },
            connections: { [] }, ownsAccount: { true })
        #expect(prepared == 0 && authenticated == 0 && store.isLoading)
        store.isLoading = false
        let gate = Suspension()
        let cancelled = _Concurrency.Task {
            await gate.pause()
            await store.signInWithOperations(
                prepare: { prepared += 1 },
                signIn: {
                    authenticated += 1
                    return .vaults([])
                },
                connections: { [] }, ownsAccount: { true })
        }
        await gate.waitUntilEntered()
        cancelled.cancel()
        gate.resume()
        await cancelled.value
        #expect(prepared == 0 && authenticated == 0 && !store.accountTransition)
    }

    @Test func onlyOwningSheetCancelsAndForegroundReturnAllowsFreshRetry() async {
        let store = FacetStore()
        let gate = Suspension()
        let identity = UUID()
        let pending = _Concurrency.Task {
            await attempt(store, requestID: identity) {
                await gate.pause()
                return .vaults([])
            }
        }
        await gate.waitUntilEntered()
        #expect(store.accountPresentation.operation == .signingIn)
        store.cancelAccountRequest(id: UUID())
        #expect(!store.accountPresentation.cancelled)
        store.cancelAccountRequest(id: identity)
        await store.pauseSync()
        await store.resumeSync()
        #expect(store.foreground && store.accountTransition)
        gate.resume()
        await pending.value
        #expect(store.accountPresentation.stage != .vaults)
        #expect(!store.accountTransition && !store.isLoading)
        await attempt(store, result: { .vaults([]) })
        #expect(store.accountPresentation.stage == .vaults)
    }

    @Test func contractFailureIsRedactedAndDoesNotBlameCredentials() async {
        let store = FacetStore()
        await attempt(store, result: { throw FacetContractError.unsupportedResponse })
        #expect(store.accountPresentation.error?.contains("account response") == true)
        #expect(store.accountPresentation.error?.contains("credentials") == false)
        #expect(store.error == nil && !store.isLoading)
    }

    @Test func successfulConnectRetiresOwnershipBeforeAutomaticDismissal() async {
        let store = FacetStore()
        let identity = UUID()
        store.accountPresentation.requestID = identity
        store.accountPresentation.operation = .connecting
        store.accountTransition = true
        store.isLoading = true
        store.showsAccount = true
        var selected = false
        var resumed = false
        await store.completeAccountConnection(
            requestID: identity, select: { selected = true }, resume: { resumed = true },
            ownsAccount: { true })
        #expect(selected && resumed && !store.showsAccount)
        #expect(store.accountPresentation.requestID == nil && !store.isLoading)
        #expect(store.accountPresentation.stage == .credentials)
        store.cancelAccountRequest(id: identity)
        #expect(!store.accountPresentation.cancelled)
    }

    @Test func cancelledConnectKeepsItsDurablyRegisteredProfileVisible() async throws {
        let store = FacetStore()
        let registered = try FacetSurfaceFixtures.store(.populated).profiles
        let identity = UUID()
        store.accountPresentation.requestID = identity
        store.accountPresentation.operation = .connecting
        store.cancelAccountRequest(id: identity)
        await store.settleAccountConnectionFailure(
            FacetSyncError.cancelled, requestID: identity, reload: { registered },
            ownsEngine: { true }, ownsAccount: { true })
        #expect(store.profiles.map(\.id) == registered.map(\.id))
        #expect(store.accountPresentation.cancelled && store.accountPresentation.error == nil)
    }

    @Test func signOutClearsAuthenticatedEmptyVaultPresentation() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
            UUID().uuidString)
        let store = FacetStore()
        store.account = try FacetObsidianAccount(directory: directory, secrets: ComponentKeys())
        await attempt(store, result: { .vaults([]) })
        var remindersCancelled = false
        await store.signOutAfterDrafts { remindersCancelled = true }
        #expect(remindersCancelled)
        #expect(store.accountPresentation.stage == .credentials)
        #expect(store.accountPresentation.notice == nil && store.accountPresentation.error == nil)
        try FileManager.default.removeItem(at: directory)
    }
}
