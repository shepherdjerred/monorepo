import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

extension FacetStoreOwnershipTests {
    @Test func emptyIntentPollCannotRetireInitialRefresh() async throws {
        for stage in ["cached", "discovery"] {
            let context = try await StoreContext.open()
            let queue = try FacetIntentQueue(
                directory: context.directory.appendingPathComponent("intent-queue"))
            let suspension = Suspension()
            var calls: [String] = []
            let step: (String) async -> Void = { name in
                calls.append(name)
                if name == stage { await suspension.pause() }
            }
            let refresh = _Concurrency.Task {
                await context.store.refreshWithOperations(
                    profileID: "A", logicalQuery: context.store.query(),
                    operations: FacetRefreshOperations(
                        cached: {
                            await step("cached")
                            return nil
                        },
                        discovery: {
                            await step("discovery")
                            return .object(["configurationAvailable": .bool(true)])
                        }, refresh: { await step("refresh") },
                        snapshot: {
                            await step("snapshot")
                            return try emptySnapshot(version: 9)
                        }, ownsEngine: { context.store.engine === context.first }))
            }
            await suspension.waitUntilEntered()
            let generation = context.store.requestGeneration
            context.store.savedNotice = "Keep this notice"
            await context.store.processIntentCaptures(queue)
            #expect(context.store.requestGeneration == generation)
            #expect(context.store.savedNotice == "Keep this notice")
            #expect(!context.store.isSaving)
            #expect(context.store.activeMutationID == nil)
            suspension.resume()
            await refresh.value
            #expect(calls == ["cached", "discovery", "refresh", "snapshot"])
            #expect(context.store.snapshot?.version == 9)
            #expect(context.store.error == nil)
            try await context.close()
        }
    }

    @Test func nonemptyIntentPollAppliesAcknowledgesAndScansExistingVault() async throws {
        let context = try await StoreContext.open()
        let vault = context.directory.appendingPathComponent("vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        try Data("title:\n  storage: frontmatter\n".utf8)
            .write(to: vault.appendingPathComponent("tasknotes.yaml"))
        let existing = Data(
            """
            ---
            title: Existing synthetic task
            tags: [task]
            status: open
            ---
            Keep this Markdown body unchanged.
            """.utf8)
        let note = vault.appendingPathComponent("Existing.md")
        try existing.write(to: note)
        let profile = try await context.first.registerLocal(directory: vault, approveStandard: true)
        context.store.selectProfilePresentation(profile.id)
        let queue = try FacetIntentQueue(
            directory: context.directory.appendingPathComponent("intent-queue"))
        try queue.selectProfile(profile.id)
        let capture = try queue.enqueue(title: "Synthetic queued task")
        let generation = context.store.requestGeneration
        await context.store.processIntentCaptures(queue)
        #expect(try queue.pending().isEmpty)
        #expect(context.store.requestGeneration > generation)
        #expect(
            Set(context.store.snapshot?.tasks.map(\.title) ?? [])
                == [capture.title, "Existing synthetic task"])
        #expect(try Data(contentsOf: note) == existing)
        #expect(context.store.pendingActions.isEmpty)
        #expect(!context.store.isSaving)
        #expect(context.store.activeMutationID == nil)
        #expect(context.store.error == nil)
        try await context.close()
    }

    @Test func everyDelayedRefreshStageStopsBeforeAnotherReadOrPresentation() async throws {
        let stages = ["cached", "discovery", "refresh", "snapshot"]
        for stage in stages {
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
                    let refresh = _Concurrency.Task {
                        await context.store.refreshWithOperations(
                            profileID: "A", logicalQuery: context.store.query(),
                            operations: FacetRefreshOperations(
                                cached: {
                                    try await step("cached")
                                    return try emptySnapshot()
                                },
                                discovery: {
                                    try await step("discovery")
                                    return .object(["configurationAvailable": .bool(true)])
                                }, refresh: { try await step("refresh") },
                                snapshot: {
                                    try await step("snapshot")
                                    return try emptySnapshot(version: 9)
                                },
                                ownsEngine: { context.store.engine === context.first }))
                    }
                    await suspension.waitUntilEntered()
                    await context.changeOwner(change)
                    suspension.resume()
                    await refresh.value
                    let stageIndex = try #require(stages.firstIndex(of: stage))
                    #expect(calls == Array(stages.prefix(stageIndex + 1)), "\(stage) \(change)")
                    #expect(context.store.snapshot?.version != 9)
                    #expect(context.store.error == nil, "\(stage) \(fails) \(change)")
                    try await context.close()
                }
            }
        }
    }

    @Test func delayedPageCannotPublishOrStartReloadForAnotherOwner() async throws {
        for fails in [false, true] {
            for change in OwnerChange.allCases {
                let context = try await StoreContext.open()
                context.store.snapshot = try emptySnapshot(totalCount: 2)
                context.store.displayedQuery = context.store.query()
                let suspension = Suspension()
                var reloads = 0
                let more = _Concurrency.Task {
                    await context.store.loadMoreWithOperations(
                        profileID: "A", ownsEngine: { context.store.engine === context.first },
                        load: { _ in
                            await suspension.pause()
                            if fails { throw FacetContractError.unsupportedResponse }
                            return try emptySnapshot(version: 9)
                        }, reload: { reloads += 1 })
                }
                await suspension.waitUntilEntered()
                await context.changeOwner(change)
                suspension.resume()
                await more.value
                #expect(reloads == 0, "\(fails) \(change)")
                #expect(context.store.snapshot?.version != 9)
                #expect(context.store.error == nil, "\(fails) \(change)")
                #expect(!context.store.isLoading)
                try await context.close()
            }
        }
    }

    @Test func assignedSavedNoticeExpiresWithOwnerOrNewFailedAction() async throws {
        for change in OwnerChange.allCases {
            let context = try await StoreContext.open()
            #expect(
                await context.store.runSavedAction(
                    action: (mutationID: "action", profileID: "A"),
                    ownsEngine: { context.store.engine === context.first },
                    apply: { try receipt() }, cleanup: {}, reload: {}))
            #expect(context.store.savedNotice != nil)
            await context.changeOwner(change)
            #expect(context.store.savedNotice == nil, "\(change)")
            try await context.close()
        }
        let context = try await StoreContext.open()
        #expect(
            await context.store.runSavedAction(
                action: (mutationID: "action", profileID: "A"),
                ownsEngine: { context.store.engine === context.first },
                apply: { try receipt() }, cleanup: {}, reload: {}))
        #expect(context.store.savedNotice != nil)
        #expect(
            await !context.store.runSavedAction(
                action: (mutationID: "new-failed-action", profileID: "A"),
                ownsEngine: { context.store.engine === context.first },
                apply: { throw FacetContractError.unsupportedResponse }, cleanup: {}, reload: {}))
        #expect(context.store.savedNotice == nil)
        #expect(context.store.error != nil)
        try await context.close()
    }

    @Test func ownReloadPreservesSavedOnlyUntilAnotherRequestAdvances() async throws {
        let context = try await StoreContext.open()
        #expect(
            await context.store.runSavedAction(
                action: (mutationID: "action", profileID: "A"),
                ownsEngine: { context.store.engine === context.first },
                apply: { try receipt() }, cleanup: {},
                reload: {
                    await context.store.loadQuerySnapshot(
                        profileID: "A", logicalQuery: context.store.query(),
                        preservingSavedNotice: true,
                        ownsEngine: { context.store.engine === context.first },
                        load: { try emptySnapshot() })
                }))
        #expect(context.store.savedNotice != nil)
        context.store.requestGeneration += 1
        #expect(context.store.savedNotice == nil)
        try await context.close()
    }
}
