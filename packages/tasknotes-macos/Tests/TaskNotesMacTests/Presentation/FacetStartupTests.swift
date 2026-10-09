import Foundation
import TaskNotesUniFFI
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Atomic standalone startup") @MainActor
struct FacetStartupTests {
    @Test(arguments: ["account", "profiles"])
    func lateFailureClosesUnpublishedEngineAndNextStartRetries(stage: String) async throws {
        let scratch = try ScratchDirectory()
        let keys = ComponentKeys()
        let store = FacetStore()
        store.foreground = false
        var failedEngine: FacetEngine?
        var opens = 0
        await store.start {
            try await FacetStartupState.open(
                directory: scratch.url,
                openEngine: {
                    opens += 1
                    let engine = try await FacetEngine.open(directory: $0, secrets: keys)
                    failedEngine = engine
                    return engine
                },
                openAccount: {
                    if stage == "account" { throw StartupFixtureError.account }
                    return try FacetObsidianAccount(directory: $0, secrets: keys)
                },
                loadProfiles: {
                    if stage == "profiles" { throw StartupFixtureError.profiles }
                    return try await $0.profiles()
                })
        }
        #expect(store.engine == nil)
        #expect(store.account == nil)
        #expect(store.importer == nil)
        #expect(store.profiles.isEmpty)
        #expect(!store.isLoading)
        let closed = try #require(failedEngine)
        await #expect(throws: FacetEngineError.self) { try await closed.profiles() }
        await store.start {
            try await FacetStartupState.open(
                directory: scratch.url,
                openEngine: {
                    opens += 1
                    return try await FacetEngine.open(directory: $0, secrets: keys)
                },
                openAccount: { try FacetObsidianAccount(directory: $0, secrets: keys) })
        }
        let ready = try #require(store.engine)
        #expect(store.account != nil)
        #expect(store.importer != nil)
        #expect(store.error == nil)
        #expect(opens == 2)
        #expect(try await ready.profiles().isEmpty)
        try await ready.close()
    }

    @Test func inFlightStartupPublishesNothingAndRejectsDuplicateStart() async throws {
        let scratch = try ScratchDirectory()
        let keys = ComponentKeys()
        let store = FacetStore()
        store.foreground = false
        let pause = Suspension()
        let startup = _Concurrency.Task {
            await store.start {
                try await FacetStartupState.open(
                    directory: scratch.url,
                    openEngine: { try await FacetEngine.open(directory: $0, secrets: keys) },
                    openAccount: {
                        await pause.pause()
                        return try FacetObsidianAccount(directory: $0, secrets: keys)
                    })
            }
        }
        await pause.waitUntilEntered()
        #expect(store.isLoading)
        #expect(store.engine == nil)
        #expect(store.account == nil)
        #expect(store.importer == nil)
        var duplicatePrepared = false
        await store.start {
            duplicatePrepared = true
            throw StartupFixtureError.account
        }
        #expect(!duplicatePrepared)
        pause.resume()
        await startup.value
        let ready = try #require(store.engine)
        #expect(store.account != nil)
        #expect(!store.isLoading)
        try await ready.close()
    }

    @Test func startupCleanupFailurePreservesBothCauses() async throws {
        let scratch = try ScratchDirectory()
        let keys = ComponentKeys()
        do {
            _ = try await FacetStartupState.open(
                directory: scratch.url,
                openEngine: { try await FacetEngine.open(directory: $0, secrets: keys) },
                openAccount: { _ in throw StartupFixtureError.account },
                closeEngine: {
                    try await $0.close()
                    throw StartupFixtureError.cleanup
                })
            Issue.record("Startup unexpectedly succeeded")
        } catch let failure as FacetStartupFailure {
            #expect(failure.primary as? StartupFixtureError == .account)
            #expect(failure.cleanup as? StartupFixtureError == .cleanup)
            let native = failure as NSError
            #expect(native.userInfo[NSUnderlyingErrorKey] != nil)
            #expect((native.userInfo[NSMultipleUnderlyingErrorsKey] as? [any Error])?.count == 1)
        }
    }
}

private enum StartupFixtureError: Error { case account, profiles, cleanup }
