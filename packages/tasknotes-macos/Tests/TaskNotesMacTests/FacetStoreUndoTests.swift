import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

extension FacetStoreOwnershipTests {
    @Test func publicRejectedRecurringToggleInvalidatesPreviouslyAssignedSavedNotice() async throws
    {
        let context = try await StoreContext.open()
        #expect(
            await context.store.runSavedAction(
                action: (mutationID: "action", profileID: "A"),
                ownsEngine: { context.store.engine === context.first },
                apply: { try receipt() }, cleanup: {}, reload: {}))
        #expect(context.store.savedNotice != nil)
        let task = try FacetFeatureProjection.decode(
            FacetTask.self,
            from: FacetFeatureProjection.parseJSON(
                """
                {"id":"a.md","path":"a.md","title":"Recurring task",
                "revision":"\(String(repeating: "a", count: 64))",
                "status":"open","priority":"normal","completed":false,"isRecurring":true,
                "properties":{},"body":"","isBlocked":false,"isBlocking":false,
                "hasActiveTimeSession":false,"totalTrackedMinutes":0,"isPending":false}
                """))
        await context.store.toggle(task, profileID: "A")
        #expect(context.store.savedNotice == nil)
        #expect(
            context.store.error
                == "Open Agenda or another dated view to choose the recurring occurrence to complete."
        )
        try await context.close()
    }

    @Test func delayedUndoPreflightCannotPublishOrContinueAfterOwnerChange() async throws {
        for stage in ["pending", "available"] {
            for fails in [false, true] {
                for change in OwnerChange.allCases {
                    let context = try await StoreContext.open()
                    let suspension = Suspension()
                    var calls: [String] = []
                    let step: (String) async throws -> Void = { name in
                        calls.append(name)
                        if name == stage {
                            await suspension.pause()
                            if fails { throw FacetContractError.unsupportedResponse }
                        }
                    }
                    context.store.savedNotice = "Prior saved action"
                    let undo = _Concurrency.Task {
                        await context.store.undoWithOperations(
                            profileID: "A",
                            operations: FacetUndoOperations(
                                pending: {
                                    try await step("pending")
                                    return stage == "pending"
                                        ? FacetPendingMutation(
                                            profileID: "A", id: "existing", mutation: .object([:]))
                                        : nil
                                },
                                available: {
                                    try await step("available")
                                    return .object([
                                        "canUndo": .bool(true), "receiptId": .string("r"),
                                    ])
                                },
                                resume: { _ in calls.append("resume") },
                                perform: { _ in calls.append("perform") },
                                ownsEngine: { context.store.engine === context.first }))
                    }
                    await suspension.waitUntilEntered()
                    #expect(context.store.savedNotice == nil)
                    await context.changeOwner(change)
                    suspension.resume()
                    await undo.value
                    #expect(calls == (stage == "pending" ? ["pending"] : ["pending", "available"]))
                    #expect(context.store.error == nil, "\(stage) \(fails) \(change)")
                    try await context.close()
                }
            }
        }
    }

    @Test func ownedUndoPreflightResumesOrPerformsAndReportsCorruption() async throws {
        for branch in ["pending", "available", "corrupt"] {
            let context = try await StoreContext.open()
            var calls: [String] = []
            await context.store.undoWithOperations(
                profileID: "A",
                operations: FacetUndoOperations(
                    pending: {
                        calls.append("pending")
                        if branch == "pending" {
                            return FacetPendingMutation(
                                profileID: "A", id: "existing", mutation: .object([:]))
                        }
                        return nil
                    },
                    available: {
                        calls.append("available")
                        if branch == "corrupt" { throw FacetContractError.unsupportedResponse }
                        return .object(["canUndo": .bool(true), "receiptId": .string("r")])
                    },
                    resume: { pending in
                        #expect(pending.id == "existing")
                        calls.append("resume")
                    },
                    perform: { command in
                        #expect(command == ["kind": .string("undo"), "receiptId": .string("r")])
                        calls.append("perform")
                    }, ownsEngine: { context.store.engine === context.first }))
            #expect(
                calls
                    == (branch == "pending"
                        ? ["pending", "resume"]
                        : branch == "corrupt"
                            ? ["pending", "available"]
                            : ["pending", "available", "perform"]))
            #expect((context.store.error != nil) == (branch == "corrupt"))
            try await context.close()
        }
    }
}
