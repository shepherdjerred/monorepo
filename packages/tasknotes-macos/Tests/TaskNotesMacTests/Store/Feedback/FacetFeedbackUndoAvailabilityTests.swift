import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite @MainActor struct FacetFeedbackUndoAvailabilityTests {
    @Test func queryRefreshRetainsUndoButOwnerChangesRejectIt() async throws {
        for change in OwnerChange.allCases {
            let context = try await StoreContext.open()
            let feedback = FacetAppliedFeedback(profileID: "A", mutationID: "repair")
            context.store.appliedFeedback = feedback
            let suspension = Suspension()
            let read = _Concurrency.Task {
                await context.store.feedbackUndoAvailable(
                    for: feedback, ownsEngine: { context.store.engine === context.first },
                    load: {
                        await suspension.pause()
                        return availability(receipt: "repair")
                    })
            }
            await suspension.waitUntilEntered()
            await context.changeOwner(change)
            suspension.resume()
            #expect(await read.value == (change == .request))
            #expect(context.store.error == nil)
            try await context.close()
        }
    }

    @Test func replacementAndClearedFeedbackRejectDelayedAvailability() async throws {
        for replacement in [true, false] {
            let context = try await StoreContext.open()
            let feedback = FacetAppliedFeedback(profileID: "A", mutationID: "repair")
            context.store.appliedFeedback = feedback
            let suspension = Suspension()
            let read = _Concurrency.Task {
                await context.store.feedbackUndoAvailable(
                    for: feedback, ownsEngine: { context.store.engine === context.first },
                    load: {
                        await suspension.pause()
                        return availability(receipt: "repair")
                    })
            }
            await suspension.waitUntilEntered()
            context.store.appliedFeedback =
                replacement ? FacetAppliedFeedback(profileID: "A", mutationID: "new") : nil
            suspension.resume()
            #expect(await read.value == false)
            #expect(context.store.error == nil)
            try await context.close()
        }
    }

    @Test func onlyTheCurrentEligibleReceiptOffersUndoAndCorruptionIsVisible() async throws {
        let context = try await StoreContext.open()
        let feedback = FacetAppliedFeedback(profileID: "A", mutationID: "repair")
        context.store.appliedFeedback = feedback
        for value in [
            availability(receipt: "other"), availability(receipt: "repair", canUndo: false),
        ] {
            #expect(
                await context.store.feedbackUndoAvailable(
                    for: feedback, ownsEngine: { context.store.engine === context.first },
                    load: { value }) == false)
        }
        #expect(context.store.error == nil)
        #expect(
            await context.store.feedbackUndoAvailable(
                for: feedback, ownsEngine: { context.store.engine === context.first },
                load: { .object([:]) }) == false)
        #expect(context.store.error != nil)
        try await context.close()
    }

    private func availability(receipt: String, canUndo: Bool = true) -> FacetValue {
        .object(["canUndo": .bool(canUndo), "receiptId": .string(receipt)])
    }
}
