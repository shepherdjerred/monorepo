import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@MainActor
struct FacetOccurrenceOwnershipTests {
    @Test func completedOwnershipChangeDuringDiscoveryCannotPublishOrGenerate() async throws {
        for change in Change.allCases {
            let context = try await open()
            let suspension = Suspension()
            var writes = 0
            let task = _Concurrency.Task {
                await context.store.maintainOccurrences(
                    profileID: "A", engine: context.first,
                    operations: FacetOccurrenceMaintenanceOperations(
                        ready: { true }, prepare: { owns, _ in owns() },
                        overview: {
                            await suspension.pause()
                            return overview()
                        },
                        apply: { _, _, _ in
                            writes += 1
                            return true
                        }))
            }
            await suspension.waitUntilEntered()
            try changeOwner(change, context: context, task: task)
            suspension.resume()
            await task.value
            #expect(writes == 0)
            #expect(context.store.occurrenceOverviews["A"] == nil)
            #expect(context.store.occurrenceIssues["A"] == nil)
            try await context.close()
        }
    }

    @Test func queuedAdmissionCannotReviveAfterCompletedAccountTransition() async throws {
        let context = try await open()
        let blocker = Suspension()
        let draining = _Concurrency.Task {
            await context.store.actionCoordinator.submit {
                await blocker.pause()
                return true
            }
        }
        await blocker.waitUntilEntered()
        let cancellation = FacetOccurrenceAdmission()
        let owns = context.store.occurrenceMaintenanceOwner(
            profileID: "A", engine: context.first, cancellation: cancellation)
        var lookups = 0
        var writes = 0
        let queued = _Concurrency.Task {
            await context.store.applyOccurrenceTarget(
                profileID: "A", owns: owns,
                operations: FacetOccurrenceTargetOperations(
                    savedID: {
                        lookups += 1
                        return nil
                    },
                    execute: { _ in writes += 1 }, cleanup: { _ in }))
        }
        context.store.accountTransition = true
        context.store.syncGeneration += 1
        context.store.accountTransition = false
        blocker.resume()
        #expect(await draining.value)
        #expect(await !queued.value)
        #expect(lookups == 0)
        #expect(writes == 0)
        try await context.close()
    }

    @Test func cancellationOrAccountChangeDuringSavedLookupPreventsNewWrite() async throws {
        for change in Change.allCases {
            let context = try await open()
            let lookup = Suspension()
            var writes = 0
            let task = _Concurrency.Task {
                await context.store.maintainOccurrences(
                    profileID: "A", engine: context.first,
                    operations: FacetOccurrenceMaintenanceOperations(
                        ready: { true }, prepare: { owns, _ in owns() }, overview: { overview() },
                        apply: { _, owns, _ in
                            await context.store.applyOccurrenceTarget(
                                profileID: "A", owns: owns,
                                operations: FacetOccurrenceTargetOperations(
                                    savedID: {
                                        await lookup.pause()
                                        return UUID().uuidString
                                    },
                                    execute: { _ in writes += 1 }, cleanup: { _ in }))
                        }))
            }
            await lookup.waitUntilEntered()
            try changeOwner(change, context: context, task: task)
            lookup.resume()
            await task.value
            #expect(writes == 0)
            #expect(context.store.occurrenceIssues["A"] == nil)
            try await context.close()
        }
    }

    @Test func admittedReceiptStillCleansUpAfterOwnershipChanges() async throws {
        let context = try await open()
        let admitted = Suspension()
        let cancellation = FacetOccurrenceAdmission()
        let owns = context.store.occurrenceMaintenanceOwner(
            profileID: "A", engine: context.first, cancellation: cancellation)
        var writes = 0
        var observations = 0
        let id = UUID().uuidString
        let task = _Concurrency.Task {
            await context.store.applyOccurrenceTarget(
                profileID: "A", owns: owns,
                operations: FacetOccurrenceTargetOperations(
                    savedID: { id },
                    execute: { actual in
                        #expect(actual == id)
                        writes += 1
                        await admitted.pause()
                    },
                    cleanup: { actual in
                        #expect(actual == id)
                        observations += 1
                    }))
        }
        await admitted.waitUntilEntered()
        context.store.syncGeneration += 1
        cancellation.cancel()
        admitted.resume()
        #expect(await task.value)
        #expect(writes == 1)
        #expect(observations == 1)
        #expect(context.store.occurrenceIssues["A"] == nil)
        try await context.close()
    }

    private enum Change: CaseIterable { case generation, account, cancellation }

    private func open() async throws -> StoreContext {
        let context = try await StoreContext.open()
        context.store.profiles = [
            FacetProfile(id: "A", name: "Synthetic", kind: "local_folder", approveStandard: true)
        ]
        return context
    }

    private func changeOwner(
        _ change: Change, context: StoreContext, task: _Concurrency.Task<Void, Never>
    ) throws {
        switch change {
        case .generation:
            context.store.accountTransition = true
            context.store.syncGeneration += 1
            context.store.accountTransition = false
        case .account:
            context.store.account = try FacetObsidianAccount(
                directory: context.directory.appendingPathComponent("replacement-account"),
                secrets: ComponentKeys())
        case .cancellation: task.cancel()
        }
    }

    private func overview() -> FacetOccurrenceOverview {
        FacetOccurrenceOverview(
            targets: [
                FacetOccurrenceTarget(
                    parentPath: "Tasks/series.md",
                    expectedParentRevision: String(repeating: "a", count: 64),
                    referenceDate: "2026-10-24", start: "2026-10-24", end: "2026-11-07")
            ], problems: [], failures: [])
    }
}
