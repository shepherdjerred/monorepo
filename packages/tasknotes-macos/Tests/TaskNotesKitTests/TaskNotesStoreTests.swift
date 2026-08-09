import Foundation
import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

/// The observable store, driven the way a view would drive it.
///
/// `@MainActor` on purpose, because that is where a SwiftUI view lives — and
/// because it is the only way to prove the store's other half works. Every
/// blocking call inside the store has to reach the global executor on its own;
/// if `@concurrent` were dropped from `TaskNotesStore.drain`, the request would
/// run on the main thread, `URLSessionTaskApi` would refuse it, and these tests
/// would fail. That is deliberate: the isolation split is load-bearing, so it
/// gets an assertion rather than a comment.
@Suite("Task store", .serialized)
@MainActor
struct TaskNotesStoreTests {
    @Test("an unconfigured store reports no server rather than failing")
    func anUnconfiguredStoreIsAState() async throws {
        let directory = try TemporaryDirectory()
        let store = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))

        // No engine at all yet: the store is empty and says so.
        #expect(store.status.state == .unconfigured)
        #expect(store.tasks.isEmpty)
        #expect(store.lastStoreError == nil)

        // An engine with no API is still an engine — the core treats "no server
        // yet" as a state, deliberately not an error and deliberately not
        // something a retry timer can fix.
        store.migrate()
        store.configure(serverURL: nil)
        #expect(store.lastStoreError == nil)

        // Measured, not assumed: a freshly constructed engine reports `.idle`
        // even with no API, because `SyncStatus::default()` is `Idle` and
        // `Unconfigured` is only reached by *running* a pass that finds no
        // client. So "unconfigured" is observable after the first pass, not
        // before it. Worth knowing before a connection banner is built on it.
        #expect(store.status.state == .idle)
        await store.sync()
        #expect(store.status.state == .unconfigured)
        #expect(store.lastStoreError == nil)
    }

    @Test("a dispatch is queued offline and drains once a server appears")
    func aDispatchIsQueuedOfflineAndDrainsLater() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let directory = try TemporaryDirectory()
        let store = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))

        store.migrate()
        store.configure(serverURL: nil)

        // Offline: the command is accepted and answered optimistically.
        let optimistic = store.dispatch(.create(payload: createRequest(title: "Offline first")))
        #expect(optimistic?.title == "Offline first")
        #expect(store.pendingCount == 1)
        #expect(store.tasks.map(\.title) == ["Offline first"])
        #expect(try server.markdownFiles().isEmpty)

        // Reconfiguring builds a *new* engine over the same storage, which is
        // how the app applies a server URL change. The queue survives because
        // it is on disk, not in the engine.
        store.configure(serverURL: server.baseURL)
        #expect(store.pendingCount == 1)

        await store.sync()

        #expect(store.status.state == .idle)
        #expect(store.pendingCount == 0)
        #expect(store.lastStoreError == nil)
        #expect(store.tasks.map(\.id) == ["Offline first.md"])
        #expect(store.lastSyncTime != nil)
        #expect(try server.markdownFiles() == ["Offline first.md"])
    }

    @Test("the store publishes the core's list order untouched")
    func theStorePublishesCoreOrder() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let directory = try TemporaryDirectory()
        let store = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))

        store.migrate()
        store.configure(serverURL: server.baseURL)

        // Deliberately not alphabetical. `TaskStoreSnapshot` carries an
        // `IndexMap` projected to an ordered `Vec`, and that order is the
        // user's list order — a store that sorted for tidiness would silently
        // override it everywhere.
        for title in ["zulu", "alpha", "mike"] {
            store.dispatch(.create(payload: createRequest(title: title)))
        }
        await store.sync()

        #expect(store.tasks.map(\.title) == ["zulu", "alpha", "mike"])
        #expect(store.tasks.map(\.title) != store.tasks.map(\.title).sorted())
    }

    @Test("a status change round-trips to the vault and back into the store")
    func aStatusChangeRoundTrips() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let directory = try TemporaryDirectory()
        let store = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))

        store.migrate()
        store.configure(serverURL: server.baseURL)
        store.dispatch(.create(payload: createRequest(title: "Round trip")))
        await store.sync()
        #expect(store.tasks.map(\.status) == [.open])

        store.dispatch(.setStatus(taskId: "Round trip.md", status: .done))
        // Optimistic, before the network: the UI shows the new state at once.
        #expect(store.tasks.map(\.status) == [.done])
        #expect(store.pendingCount == 1)

        await store.sync()
        #expect(store.pendingCount == 0)
        #expect(store.tasks.map(\.status) == [.done])
        #expect(try server.contents(of: "Round trip.md").contains("status: done"))
    }

    @Test("a failed sync surfaces the engine's state instead of throwing")
    func aFailedSyncSurfacesState() async throws {
        let directory = try TemporaryDirectory()
        let store = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))
        let unreachable = try #require(URL(string: "http://127.0.0.1:9"))

        store.migrate()
        store.configure(serverURL: unreachable)
        store.dispatch(.create(payload: createRequest(title: "Doomed")))

        await store.sync()

        // A banner, not an exception: the engine records the failure and the
        // store publishes it. The work is still queued.
        #expect(store.status.state == .backoff)
        #expect(store.status.lastError != nil)
        #expect(store.pendingCount == 1)
        #expect(store.tasks.map(\.title) == ["Doomed"])

        store.shutdown()
        #expect(store.status.state == .unconfigured)
        #expect(store.tasks.isEmpty)
    }

    @Test("a restart reloads the cache from disk")
    func aRestartReloadsTheCache() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let directory = try TemporaryDirectory()

        do {
            let store = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))
            store.migrate()
            store.configure(serverURL: server.baseURL)
            store.dispatch(.create(payload: createRequest(title: "Persisted")))
            await store.sync()
            #expect(store.tasks.count == 1)
            store.shutdown()
        }

        // A second store over the same directory, with the server unreachable:
        // everything it shows came off disk.
        let unreachable = try #require(URL(string: "http://127.0.0.1:9"))
        let reopened = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))
        reopened.migrate()
        reopened.configure(serverURL: unreachable)

        #expect(reopened.tasks.map(\.id) == ["Persisted.md"])
        #expect(reopened.lastSyncTime != nil)
    }

    @Test("a temp id keeps resolving after its create is acknowledged")
    func aTempIdKeepsResolving() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let directory = try TemporaryDirectory()
        let store = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))

        store.migrate()
        store.configure(serverURL: server.baseURL)

        let optimistic = try #require(
            store.dispatch(.create(payload: createRequest(title: "Aliased"))))
        let tempId = optimistic.id
        await store.sync()

        // An inspector, deep link, or restored window holding the pre-ack id
        // stays valid because the alias map outlives the command.
        #expect(store.resolve(tempId) == "Aliased.md")
        #expect(store.resolve("Aliased.md") == "Aliased.md")
    }
}
