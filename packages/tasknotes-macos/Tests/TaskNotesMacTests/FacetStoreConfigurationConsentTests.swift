import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite @MainActor struct FacetStoreConfigurationConsentTests {
    @Test(arguments: [false, true])
    func missingInvalidAndValidConfigurationRetainDistinctConsent(pluginSettings: Bool) async throws
    {
        let context = try await StoreContext.open()
        let vault = context.directory.appendingPathComponent("configuration-vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let profile = try await context.first.registerLocal(
            directory: vault, approveStandard: false)
        context.store.profiles = try await context.first.profiles()
        context.store.selectProfilePresentation(profile.id)
        await context.store.refresh()
        #expect(context.store.needsStandardConsent)
        #expect(context.store.error == nil)

        let portable = vault.appendingPathComponent("tasknotes.yaml")
        let settings =
            pluginSettings
            ? vault.appendingPathComponent(".obsidian/plugins/tasknotes/data.json") : portable
        try FileManager.default.createDirectory(
            at: settings.deletingLastPathComponent(), withIntermediateDirectories: true)
        let invalid = Data(
            (pluginSettings
                ? #"{"customStatuses":[{"value":"open","label":"Open"}]}"# : "title: [invalid YAML")
                .utf8)
        try invalid.write(to: settings)
        await context.store.refresh()
        #expect(!context.store.needsStandardConsent)
        #expect(context.store.error != nil)
        #expect(try Data(contentsOf: settings) == invalid)
        #expect(try await context.first.profiles().first?.approveStandard == false)

        try FileManager.default.removeItem(at: settings)
        await context.store.refresh()
        #expect(context.store.needsStandardConsent)

        try Data("title:\n  storage: frontmatter\n".utf8).write(to: portable)
        try Data(
            "---\ntitle: Recovered configured task\ntags: [task]\nstatus: open\n---\nPreserved body.\n"
                .utf8
        ).write(to: vault.appendingPathComponent("Existing.md"))
        await context.store.refresh()
        #expect(!context.store.needsStandardConsent)
        #expect(context.store.snapshot?.tasks.map(\.title) == ["Recovered configured task"])
        #expect(try await context.first.profiles().first?.approveStandard == false)
        try await context.close()
    }

    @Test func delayedFailureCannotRemoveNewOwnersConsent() async throws {
        for stage in ["cached", "discovery"] {
            for change in [OwnerChange.selection, .lifecycle] {
                let context = try await StoreContext.open()
                let suspension = Suspension()
                context.store.needsStandardConsent = true
                let refresh = _Concurrency.Task {
                    await context.store.refreshWithOperations(
                        profileID: "A", logicalQuery: context.store.query(),
                        operations: FacetRefreshOperations(
                            cached: {
                                if stage == "cached" {
                                    await suspension.pause()
                                    throw CocoaError(.fileReadNoPermission)
                                }
                                return nil
                            },
                            discovery: {
                                await suspension.pause()
                                throw FacetContractError.unsupportedResponse
                            }, refresh: {},
                            snapshot: { throw FacetContractError.unsupportedResponse },
                            ownsEngine: { context.store.engine === context.first }))
                }
                await suspension.waitUntilEntered()
                #expect(!context.store.needsStandardConsent)
                await context.changeOwner(change)
                context.store.needsStandardConsent = true
                suspension.resume()
                await refresh.value
                #expect(context.store.needsStandardConsent)
                #expect(context.store.error == nil)
                try await context.close()
            }
        }
    }

    @Test func cancelledDiscoveryDoesNotOfferUnprovenDefaults() async throws {
        let context = try await StoreContext.open()
        let suspension = Suspension()
        context.store.needsStandardConsent = true
        var advanced = false
        let refresh = _Concurrency.Task {
            await context.store.refreshWithOperations(
                profileID: "A", logicalQuery: context.store.query(),
                operations: FacetRefreshOperations(
                    cached: { nil },
                    discovery: {
                        await suspension.pause()
                        try _Concurrency.Task.checkCancellation()
                        return .object(["configurationAvailable": .bool(false)])
                    }, refresh: { advanced = true },
                    snapshot: { throw FacetContractError.unsupportedResponse },
                    ownsEngine: { context.store.engine === context.first }))
        }
        await suspension.waitUntilEntered()
        refresh.cancel()
        suspension.resume()
        await refresh.value
        #expect(!context.store.needsStandardConsent)
        #expect(!advanced)
        try await context.close()
    }
}
