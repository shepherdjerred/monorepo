import Foundation
import TaskNotesKit
import TaskNotesTestSupport
import Testing

@testable import TaskNotesUniFFI

/// What `configure` publishes, and what it refuses to.
///
/// Both cases here are about the *slot*: which engine the rest of the app is
/// dispatching through afterwards, and what the banner says about it. Neither
/// needs a server, because neither is about the network — a bad address is
/// rejected while it is being built, and a failed restore never gets that far.
@Suite("Pointing the store at a server")
@MainActor
struct StoreConfigurationTests {
    /// ⚠️ A replacement that could not restore must not become the live engine.
    ///
    /// `restore()` is what loads the durable queue and the id counters. An
    /// unreadable `id-counters.json` — the core says so in as many words, "the
    /// ids this install has already spent are unknown" — leaves the engine's
    /// counters at zero. Publishing it anyway means the next dispatch mints an
    /// id the queue has already spent and overwrites the counter file with it,
    /// so an acknowledged mutation can replay or an edit can land on a
    /// different server task. No engine is the correct answer, and the shell
    /// already knows how to render one: `dispatch` returns nil.
    @Test("a replacement that fails to restore never becomes the live engine")
    func aFailedRestoreIsNotPublished() async throws {
        let directory = try TemporaryDirectory()
        try "{ this is not the counter file".write(
            to: directory.url.appending(path: "id-counters.json"),
            atomically: true,
            encoding: .utf8
        )
        let store = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))
        defer { store.shutdown() }

        store.configure(serverURL: nil)

        #expect(store.lastStoreError != nil, "the refusal has to reach the banner")
        let refused = await store.dispatch(
            .create(payload: createRequest(title: "Fix the boiler")))
        #expect(refused == nil, "and no write may go through a half-restored engine")
    }

    /// A corrected address takes its own banner down.
    ///
    /// `localhost:3000` is the case worth naming: Foundation reads `localhost`
    /// as the *scheme*, so it reaches `urlSession` and is rejected there. That
    /// failure is stored by `configure` rather than through `report(_:)`, so
    /// `dispatch`'s retirement never applied to it — and because a store error
    /// outranks every engine state in the banner, the complaint used to sit on
    /// top of a genuinely connected engine until some unrelated mutation
    /// happened to clear it.
    @Test("a corrected address retires the refusal the bad one raised")
    func aRebuiltApiClearsTheConfigurationError() throws {
        let directory = try TemporaryDirectory()
        let store = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))
        defer { store.shutdown() }

        store.configure(serverURL: URL(string: "localhost:3000"))
        #expect(store.lastStoreError != nil, "the address was refused")

        store.configure(serverURL: URL(string: "http://127.0.0.1:8080/"))
        #expect(
            store.lastStoreError == nil,
            "and the correction is what makes the refusal untrue"
        )
    }
}
