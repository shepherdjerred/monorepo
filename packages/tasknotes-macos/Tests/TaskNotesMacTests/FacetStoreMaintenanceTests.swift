import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

private enum UnknownCleanupFailure: Error { case invalidState }

extension FacetStoreOwnershipTests {
    @Test func contractAndUnknownCleanupRemainVisibleBesideSaved() async throws {
        let failures: [any Error] = [
            FacetContractError.unsupportedResponse, UnknownCleanupFailure.invalidState,
        ]
        for failure in failures {
            let context = try await StoreContext.open()
            let saved = await context.store.runSavedAction(
                action: (mutationID: "action", profileID: "A"),
                ownsEngine: { context.store.engine === context.first },
                apply: { try receipt() }, cleanup: { throw failure }, reload: {})
            #expect(saved)
            #expect(
                context.store.savedNotice?.hasPrefix(
                    "The task was saved without the configured template.") == true)
            #expect(context.store.savedNotice?.contains("Check available storage") == false)
            #expect(context.store.error == FacetFailureDiagnostic(failure).action)
            try await context.close()
        }
    }

    @Test func expectedStorageAndCorruptPendingActionsHaveDifferentPresentation() async throws {
        let failures: [any Error] = [
            CocoaError(.fileWriteOutOfSpace), FacetContractError.unsupportedResponse,
        ]
        for failure in failures {
            let context = try await StoreContext.open()
            context.store.savedNotice = "The task was saved without the configured template."
            let ownsPresentation = context.store.presentationOwner(
                profileID: "A", ownsEngine: { context.store.engine === context.first })
            await context.store.refreshSavedActions(
                ownsPresentation: ownsPresentation, load: { throw failure })
            let storage = FacetFailureDiagnostic(failure).classification == "storage"
            #expect(
                context.store.savedNotice?.hasPrefix(
                    "The task was saved without the configured template.") == true)
            #expect((context.store.error == nil) == storage)
            #expect(context.store.savedNotice?.contains("Check available storage.") == storage)
            if !storage { #expect(context.store.error == FacetFailureDiagnostic(failure).action) }
            try await context.close()
        }
    }

    @Test func latePendingActionsFailureDoesNotLeakToNewOwner() async throws {
        for change in OwnerChange.allCases {
            let context = try await StoreContext.open()
            let suspension = Suspension()
            let ownsPresentation = context.store.presentationOwner(
                profileID: "A", ownsEngine: { context.store.engine === context.first })
            let load = _Concurrency.Task {
                await context.store.refreshSavedActions(
                    ownsPresentation: ownsPresentation,
                    load: {
                        await suspension.pause()
                        throw FacetContractError.unsupportedResponse
                    })
            }
            await suspension.waitUntilEntered()
            await context.changeOwner(change)
            suspension.resume()
            await load.value
            #expect(context.store.savedNotice == nil)
            #expect(context.store.error == nil)
            try await context.close()
        }
    }

    @Test func ownershipChangeDuringCorruptCleanupSuppressesBothMessages() async throws {
        let context = try await StoreContext.open()
        let suspension = Suspension()
        let action = _Concurrency.Task {
            await context.store.runSavedAction(
                action: (mutationID: "action", profileID: "A"),
                ownsEngine: { context.store.engine === context.first },
                apply: { try receipt() },
                cleanup: {
                    await suspension.pause()
                    throw FacetContractError.unsupportedResponse
                }, reload: {})
        }
        await suspension.waitUntilEntered()
        await context.changeOwner(.selection)
        suspension.resume()
        #expect(await action.value)
        #expect(context.store.savedNotice == nil)
        #expect(context.store.error == nil)
        try await context.close()
    }
}
