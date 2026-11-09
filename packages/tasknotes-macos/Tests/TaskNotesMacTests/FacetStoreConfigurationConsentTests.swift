import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite @MainActor struct FacetStoreConfigurationConsentTests {
    @Test func syncProjectionOffersDefaultsOnlyAfterTheDurableInitialBarrier() async throws {
        let context = try await StoreContext.open()
        let profile = try await context.first.registerReplica(
            id: UUID().uuidString, name: "Unconfigured Sync replica")
        context.store.profiles = [profile]
        context.store.selectProfilePresentation(profile.id)
        await context.store.refresh(schedulingOccurrences: false, source: .syncProjection)
        #expect(!context.store.needsStandardConsent)
        #expect(context.store.error == nil)
        try await context.first.saveCheckpoint(
            profileID: profile.id,
            json: #"{"schema_version":1,"cursor":0,"initial":false,"pending":{}}"#)
        await context.store.refresh(schedulingOccurrences: false, source: .syncProjection)
        #expect(context.store.needsStandardConsent)
        #expect(context.store.snapshot?.configuration == .null)
        #expect(context.store.error == nil)
        #expect(try await context.first.profiles().first?.approveStandard == false)
        try await context.close()
    }

    @Test(arguments: [FacetRefreshSource.provider, .syncProjection])
    func syncUpdatesDoNotRescanOwnedVaultFiles(source: FacetRefreshSource) async throws {
        let context = try await StoreContext.open()
        let profile = try await context.first.registerReplica(
            id: UUID().uuidString, name: "Synthetic Sync replica")
        try await context.first.approveStandard(profile: profile)
        let cached = try await context.first.refresh(profileID: profile.id)
        let discovery = try await context.first.features(
            profileID: profile.id, request: .object(["kind": .string("discovery")]))
        context.store.profiles = try await context.first.profiles()
        context.store.selectProfilePresentation(profile.id)
        var providerScans = 0
        var snapshotReads = 0
        await context.store.refreshWithOperations(
            profileID: profile.id, logicalQuery: context.store.query(), source: source,
            operations: FacetRefreshOperations(
                cached: { cached }, discovery: { discovery },
                refresh: {
                    providerScans += 1
                    _ = try await context.first.refresh(profileID: profile.id)
                },
                snapshot: {
                    snapshotReads += 1
                    return try await context.first.snapshot(
                        profileID: profile.id, query: context.store.query())
                }, ownsEngine: { context.store.engine === context.first }))
        #expect(providerScans == (source == .provider ? 1 : 0))
        #expect(snapshotReads == 1)
        #expect(context.store.snapshot?.profileId == profile.id)
        #expect(!context.store.needsStandardConsent)
        #expect(context.store.error == nil)
        try await context.close()
    }

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
