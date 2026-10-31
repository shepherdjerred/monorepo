import Foundation
import TaskNotesUniFFI
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit
@testable import TaskNotesMac

@Suite("Application bootstrap without a workspace") @MainActor
struct FacetApplicationBootstrapTests {
    @Test func hiddenApplicationStartsBeforeAnyViewAndSurvivesCancelledViewWaiter() async throws {
        let scratch = try ScratchDirectory()
        let keys = ComponentKeys()
        let store = FacetStore()
        store.foreground = false
        let pause = Suspension()
        var opens = 0
        let environment = FacetMacEnvironment(store: store) {
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

        // No window, hosting view, or view task has been constructed.
        await pause.waitUntilEntered()
        #expect(environment.store === store)
        #expect(opens == 1)
        #expect(store.isLoading)
        #expect(store.engine == nil)

        var viewReturned = false
        var duplicateStarted = false
        let view = _Concurrency.Task {
            await store.awaitStartup { duplicateStarted = true }
            viewReturned = true
        }
        await _Concurrency.Task.yield()
        view.cancel()
        #expect(!viewReturned)
        #expect(!duplicateStarted)
        #expect(store.engine == nil)

        pause.resume()
        await environment.bootstrap.value
        await view.value
        let ready = try #require(store.engine)
        #expect(store.account != nil)
        #expect(store.importer != nil)
        #expect(!store.isLoading)
        #expect(store.startupTask == nil)
        #expect(viewReturned)
        #expect(!duplicateStarted)
        #expect(opens == 1)
        #expect(try await ready.profiles().isEmpty)
        try await ready.close()
        await #expect(throws: FacetEngineError.self) { try await ready.profiles() }
    }
}
