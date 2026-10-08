import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@MainActor
internal final class Suspension {
    private var entered = false
    private var started: CheckedContinuation<Void, Never>?
    private var completion: CheckedContinuation<Void, Never>?

    func waitUntilEntered() async {
        if entered { return }
        await withCheckedContinuation { started = $0 }
    }
    func pause() async {
        entered = true
        started?.resume()
        started = nil
        await withCheckedContinuation { completion = $0 }
    }
    func resume() {
        completion?.resume()
        completion = nil
    }
}

@MainActor
internal struct StoreContext {
    let store = FacetStore()
    let first: FacetEngine
    let second: FacetEngine
    let directory: URL

    static func open() async throws -> Self {
        let testDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("facet-owner-component-\(UUID().uuidString)")
        let firstEngine = try await FacetEngine.open(
            directory: testDirectory.appendingPathComponent("first"), secrets: ComponentKeys())
        let secondEngine = try await FacetEngine.open(
            directory: testDirectory.appendingPathComponent("second"), secrets: ComponentKeys())
        let context = Self(first: firstEngine, second: secondEngine, directory: testDirectory)
        context.store.engine = firstEngine
        context.store.selectProfilePresentation("A")
        return context
    }

    func close() async throws {
        try await first.close()
        try await second.close()
        try FileManager.default.removeItem(at: directory)
    }

    func changeOwner(_ change: OwnerChange) async {
        switch change {
        case .selection:
            store.selectProfilePresentation("B")
            store.selectProfilePresentation("A")
        case .request: store.requestGeneration += 1
        case .engine: store.engine = second
        case .lifecycle: await store.pauseSync()
        case .removal:
            await store.removeProfileWithOperations(
                profileID: "A",
                operations: FacetProfileRemovalOperations(
                    stop: {}, removeDomain: { nil }, detach: {}, retire: {},
                    reload: { [] }, ownsEngine: { true }, reconcile: {}))
        }
    }
}

@Suite @MainActor struct FacetStoreOwnershipTests {
    @Test func retiringAnActionRequiresItsSelectedVault() async throws {
        let context = try await StoreContext.open()
        let vault = context.directory.appendingPathComponent("vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let profile = try await context.first.registerLocal(directory: vault, approveStandard: true)
        let directory = context.directory.appendingPathComponent("first/action-drafts")
        let id = UUID().uuidString
        _ = try FacetMutationDrafts(directory: directory).envelope(
            profileID: profile.id, id: id,
            command: .object(["kind": .string("stop_time"), "path": .string("Tasks/old.md")]),
            at: "2026-10-03T12:00:00Z")
        let file = directory.appendingPathComponent(id + ".json")
        let bytes = try Data(contentsOf: file)
        let action = try #require(await context.first.pendingMutations().first)
        context.store.pendingActions = [action]
        await context.store.retireSavedAction(action)
        #expect(try Data(contentsOf: file) == bytes)
        #expect(context.store.pendingActions.count == 1)
        #expect(context.store.error == nil)
        context.store.selectProfilePresentation(profile.id)
        await context.store.retireSavedAction(action)
        #expect(context.store.pendingActions.isEmpty)
        #expect(!FileManager.default.fileExists(atPath: file.path))
        try await context.close()
    }

    internal func receipt(applied: Bool = true) throws -> FacetMutationReceipt {
        let json = """
            {"schemaVersion":1,"mutationId":"action","applied":\(applied),"taskPath":null,
            "cleanupPending":false,"paths":[],"pendingCount":0,
            "diagnostics":\(applied ? #"[{"code":"template_missing"}]"# : "[]")}
            """
        return try FacetMutationReceipt.read(
            json: json, expectedMutationID: "action", schema: FacetSchema.bundled())
    }

    @Test func appliedReceiptKeepsSavedWhenCleanupFails() async throws {
        let context = try await StoreContext.open()
        var reloads = 0
        let saved = await context.store.runSavedAction(
            action: (mutationID: "action", profileID: "A"),
            ownsEngine: { context.store.engine === context.first },
            apply: { try receipt() }, cleanup: { throw CocoaError(.fileWriteOutOfSpace) },
            reload: { reloads += 1 })
        #expect(saved)
        #expect(
            context.store.savedNotice
                == [
                    "The task was saved without the configured template.",
                    "The task was saved, but cleanup could not finish. Check available storage.",
                ].joined(separator: "\n")
        )
        #expect(context.store.error == nil)
        #expect(reloads == 1)
        try await context.close()
    }

    @Test func lateAppliedReceiptDoesNotPresentForAnotherOwner() async throws {
        for change in OwnerChange.allCases {
            let context = try await StoreContext.open()
            let suspension = Suspension()
            var reloads = 0
            let action = _Concurrency.Task {
                await context.store.runSavedAction(
                    action: (mutationID: "action", profileID: "A"),
                    ownsEngine: { context.store.engine === context.first },
                    apply: {
                        await suspension.pause()
                        return try receipt()
                    },
                    cleanup: { throw FacetContractError.unsupportedResponse },
                    reload: { reloads += 1 })
            }
            await suspension.waitUntilEntered()
            await context.changeOwner(change)
            suspension.resume()
            #expect(await action.value, "\(change)")
            #expect(context.store.savedNotice == nil, "\(change)")
            #expect(context.store.error == nil, "\(change)")
            #expect(reloads == 0, "\(change)")
            try await context.close()
        }
    }

    @Test func lateFailureDoesNotPresentForAnotherOwner() async throws {
        for change in OwnerChange.allCases {
            let context = try await StoreContext.open()
            let suspension = Suspension()
            let action = _Concurrency.Task {
                await context.store.runSavedAction(
                    action: (mutationID: "action", profileID: "A"),
                    ownsEngine: { context.store.engine === context.first },
                    apply: {
                        await suspension.pause()
                        throw FacetContractError.unsupportedResponse
                    }, cleanup: {}, reload: {})
            }
            await suspension.waitUntilEntered()
            await context.changeOwner(change)
            suspension.resume()
            #expect(await !action.value, "\(change)")
            #expect(context.store.savedNotice == nil, "\(change)")
            #expect(context.store.error == nil, "\(change)")
            try await context.close()
        }
    }

    @Test func reservedActionRejectsOverlapBeforeApplyingIt() async throws {
        let context = try await StoreContext.open()
        let suspension = Suspension()
        let first = _Concurrency.Task {
            await context.store.runSavedAction(
                action: (mutationID: "action", profileID: "A"),
                ownsEngine: { context.store.engine === context.first },
                apply: {
                    await suspension.pause()
                    return try receipt()
                }, cleanup: {}, reload: {})
        }
        await suspension.waitUntilEntered()
        var secondApplied = false
        let second = await context.store.runSavedAction(
            action: (mutationID: "other", profileID: "A"), ownsEngine: { true },
            apply: {
                secondApplied = true
                return try receipt()
            }, cleanup: {}, reload: {})
        #expect(!second)
        #expect(!secondApplied)
        #expect(context.store.activeMutationID == "action")
        suspension.resume()
        #expect(await first.value)
        #expect(context.store.activeMutationID == nil)
        #expect(!context.store.isSaving)
        try await context.close()
    }
}

extension FacetStoreOwnershipTests {
    @Test func unappliedReceiptNeverCleansUpOrPublishesSaved() async throws {
        let context = try await StoreContext.open()
        var cleaned = false
        let saved = await context.store.runSavedAction(
            action: (mutationID: "action", profileID: "A"),
            ownsEngine: { context.store.engine === context.first },
            apply: { try receipt(applied: false) }, cleanup: { cleaned = true }, reload: {})
        #expect(!saved)
        #expect(!cleaned)
        #expect(context.store.savedNotice == nil)
        #expect(context.store.error != nil)
        try await context.close()
    }
}

internal enum OwnerChange: CaseIterable {
    case selection, request, removal, engine, lifecycle
}
