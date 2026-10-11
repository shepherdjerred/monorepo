import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Application-owned startup waiters") @MainActor
struct FacetStartupWaiterTests {
    @Test func concurrentWindowWaiterAndCancelledPanelWaitForOnePublishedEngine() async throws {
        let scratch = try ScratchDirectory()
        let keys = ComponentKeys()
        let store = FacetStore()
        store.foreground = false
        let pause = Suspension()
        var opens = 0
        let owner = _Concurrency.Task {
            await store.awaitStartup {
                await store.start {
                    opens += 1
                    return try await FacetStartupState.open(
                        directory: scratch.url,
                        openEngine: { try await FacetEngine.open(directory: $0, secrets: keys) },
                        openAccount: {
                            await pause.pause()
                            return try FacetObsidianAccount(directory: $0, secrets: keys)
                        })
                }
            }
        }
        await pause.waitUntilEntered()
        var panelReturned = false
        var duplicateStarted = false
        let panel = _Concurrency.Task {
            await store.awaitStartup { duplicateStarted = true }
            panelReturned = true
        }
        await _Concurrency.Task.yield()
        panel.cancel()
        #expect(store.engine == nil)
        #expect(!panelReturned)
        #expect(!duplicateStarted)
        pause.resume()
        await owner.value
        await panel.value
        #expect(panelReturned)
        #expect(!duplicateStarted)
        #expect(opens == 1)
        #expect(store.startupTask == nil)
        let ready = try #require(store.engine)
        #expect(store.account != nil)
        try await ready.close()
    }

    @Test func failedOwnedStartupClearsWaiterAndAllowsFreshRetry() async throws {
        let scratch = try ScratchDirectory()
        let keys = ComponentKeys()
        let store = FacetStore()
        store.foreground = false
        await store.awaitStartup {
            await store.start { throw WaiterFixtureError.unavailable }
        }
        #expect(store.startupTask == nil)
        #expect(store.engine == nil)
        await store.awaitStartup {
            await store.start {
                try await FacetStartupState.open(
                    directory: scratch.url,
                    openEngine: { try await FacetEngine.open(directory: $0, secrets: keys) },
                    openAccount: { try FacetObsidianAccount(directory: $0, secrets: keys) })
            }
        }
        let ready = try #require(store.engine)
        #expect(store.startupTask == nil)
        #expect(store.error == nil)
        try await ready.close()
    }
}

private enum WaiterFixtureError: Error { case unavailable }
