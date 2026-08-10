import Foundation
import TaskNotesKit
import TaskNotesTestSupport
import Testing

@testable import TaskNotesMac
@testable import TaskNotesUniFFI

/// Launch, as the app performs it.
///
/// ## Why this file exists
///
/// ``AppEnvironment`` is the whole shell: it is what turns a persisted address
/// and a Keychain token into a running engine, and it is the only thing that
/// decides whether the app fetches anything when it starts. It had no test at
/// all, and the bug that shipped was exactly that — `configure` builds an
/// engine, `restore()` reads the local cache, `refresh()` re-reads an in-memory
/// snapshot, and **nothing touched the network**. A fresh install sat on an
/// empty list forever while Settings said "Connected".
///
/// ⚠️ **No test body here dispatches.** That is stated rather than left to be
/// noticed, because it is precisely how the bug survived 291 Swift tests: every
/// one of them either seeded the cache or dispatched a mutation first, and a
/// dispatch *arms a sync pass*. A test that dispatched would supply the very
/// thing whose absence is the defect. Where a server needs contents, a
/// **different** client puts them there in ``seedVault(of:title:)`` — which is
/// also what makes "this client pulled a vault it did not write" true in the
/// literal sense.
///
/// Serialized because most cases spawn a server process.
@Suite("The app at launch", .serialized)
@MainActor
struct AppEnvironmentTests {
    private static let token = "a-token-the-server-will-check"

    // ── Does launch reach for the network at all ───────────────────────────

    /// ⚠️ The shipped bug, in one assertion.
    ///
    /// `.idle` is what an engine that has never made a request reports, and
    /// `.idle` is what this used to be after launch: not "the fetch failed" but
    /// "no fetch was attempted". Pointing at an address with nothing behind it
    /// makes the difference observable — a client that tries gets a refused
    /// connection, and a client that does not try stays pristine.
    ///
    /// ``SyncState/backoff`` is *measured*, not assumed: an empty queue plus a
    /// failed pull is a transient failure, so the engine arms a retry. Both
    /// halves are pinned — the exact state, and the weaker invariant underneath
    /// it that survives any reclassification in the core: launch left the engine
    /// somewhere other than untouched, carrying an error.
    @Test("launch attempts a fetch, and a failure is a failure rather than silence")
    func launchAttemptsAFetch() async throws {
        let unreachable = try TaskNotesServerProcess.unreachableBaseURL()
        let fixture = try Fixture(address: unreachable.absoluteString)
        defer { fixture.tearDown() }

        await fixture.environment.start().value

        let store = try #require(fixture.store)
        #expect(store.status.state == .backoff)
        #expect(store.status.state != .idle)
        #expect(store.status.lastError != nil)
        #expect(store.tasks.isEmpty)
    }

    /// The positive half: a server that answers, and a vault this client has
    /// never written to.
    ///
    /// Note what is absent from this body — no `dispatch`, no seeded cache, no
    /// manual `sync()`. `start()` is the only thing that runs, and the task
    /// arrives.
    @Test("launch pulls a vault this client did not write")
    func launchPullsAVaultThisClientDidNotWrite() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        try await seedVault(of: server, title: "Written by somebody else")

        let fixture = try Fixture(address: server.baseURL.absoluteString)
        defer { fixture.tearDown() }

        await fixture.environment.start().value

        let store = try #require(fixture.store)
        #expect(store.tasks.map(\.title) == ["Written by somebody else"])
        #expect(store.status.state == .idle)
        #expect(store.lastSyncTime != nil)
        #expect(store.lastStoreError == nil)
    }

    // ── Does the stored credential reach the socket ────────────────────────

    /// ⚠️ **The negative control is the proof, and it is the case below.**
    ///
    /// This passes only if the token sitting in the token store ended up on the
    /// wire, *because the identical launch without it 401s in
    /// ``launchWithoutAStoredTokenIsRejected()``* — same server, same address,
    /// same code path, one difference. An assertion on a `URLRequest` this
    /// package built could never say that.
    @Test("a token from the store reaches the server")
    func aTokenFromTheStoreReachesTheServer() async throws {
        let server = try TaskNotesServerProcess(authToken: Self.token)
        defer { server.stop() }
        try await seedVault(of: server, title: "Behind the gate")

        let fixture = try Fixture(
            address: server.baseURL.absoluteString,
            tokenStore: InMemoryTokenStore(token: server.authToken)
        )
        defer { fixture.tearDown() }

        await fixture.environment.start().value

        let store = try #require(fixture.store)
        #expect(store.tasks.map(\.title) == ["Behind the gate"])
        #expect(store.status.state == .idle)
    }

    @Test("without a stored token the same launch is rejected")
    func launchWithoutAStoredTokenIsRejected() async throws {
        let server = try TaskNotesServerProcess(authToken: Self.token)
        defer { server.stop() }
        try await seedVault(of: server, title: "Behind the gate")

        let fixture = try Fixture(
            address: server.baseURL.absoluteString,
            tokenStore: InMemoryTokenStore()
        )
        defer { fixture.tearDown() }

        await fixture.environment.start().value

        let store = try #require(fixture.store)
        #expect(store.status.state == .authError)
        #expect(store.tasks.isEmpty)
    }

    // ── The states that are not failures ───────────────────────────────────

    /// An app that has never been configured is *unconfigured*, which the core
    /// models deliberately and which is not a failure anybody caused. It is also
    /// usable: the queue accepts work in that state.
    ///
    /// ⚠️ Measured, and both halves are surprising.
    ///
    /// **`.unconfigured` is a post-pull state.** A freshly configured engine
    /// with no API reports `.idle` until something asks it to sync — verified by
    /// deleting the fetch from `start()`, which turns this case's `state` into
    /// `.idle` and silences the banner entirely. So the missing fetch did not
    /// merely leave the list empty: it also meant an app with no server address
    /// never said so, because "No server configured" is only reachable through
    /// the request that was not being made.
    ///
    /// **`status.lastError` is set here, and that is fine.** It reads "API URL
    /// not configured" — the engine saying why the pass did nothing, not a fault
    /// to report. `lastStoreError` stays empty and the banner asks for an
    /// address rather than announcing a problem. A change that promoted it to a
    /// visible error should turn this red.
    @Test("an empty address is unconfigured, not an error")
    func anEmptyAddressIsUnconfigured() async throws {
        let fixture = try Fixture(address: "")
        defer { fixture.tearDown() }

        await fixture.environment.start().value

        let store = try #require(fixture.store)
        #expect(store.status.state == .unconfigured)
        #expect(store.lastStoreError == nil)
        #expect(store.status.lastError?.userMessage == "API URL not configured")
        #expect(banner(for: store)?.title == "No server configured")
        #expect(banner(for: store)?.remedy == .openSettings)
    }

    /// A half-typed address is the same state, and specifically not a reported
    /// error: somebody is still typing.
    @Test("an address with no scheme is unconfigured, not an error")
    func anAddressWithNoSchemeIsUnconfigured() async throws {
        let fixture = try Fixture(address: "127.0.0.1:8080")
        defer { fixture.tearDown() }

        await fixture.environment.start().value

        let store = try #require(fixture.store)
        #expect(store.status.state == .unconfigured)
        #expect(store.lastStoreError == nil)
        #expect(banner(for: store)?.title == "No server configured")
    }

    // ── The other caller ───────────────────────────────────────────────────

    /// `applyServerAddress()` is what the Settings pane calls on commit, and
    /// nothing had ever exercised it. It has to do both halves: replace the
    /// engine, *and* fetch — a rebuilt engine that never asks the server
    /// anything is the same bug as a launch that never asks.
    @Test("applyServerAddress rebuilds the engine and pulls")
    func applyServerAddressRebuildsAndPulls() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        try await seedVault(of: server, title: "Entered in Settings")

        let fixture = try Fixture(address: "")
        defer { fixture.tearDown() }

        await fixture.environment.start().value
        let store = try #require(fixture.store)
        #expect(store.status.state == .unconfigured)
        #expect(store.tasks.isEmpty)

        // Exactly what the Settings address field does on submit.
        fixture.environment.serverAddress = server.baseURL.absoluteString
        await fixture.environment.applyServerAddress().value

        #expect(store.tasks.map(\.title) == ["Entered in Settings"])
        #expect(store.status.state == .idle)
    }

    // ── Persistence ────────────────────────────────────────────────────────

    /// The address is a preference, so it has to outlive the process. Two
    /// `AppEnvironment`s over one `UserDefaults` suite is the closest a headless
    /// test gets to quitting the app and reopening it.
    @Test("serverAddress survives a relaunch")
    func serverAddressSurvivesARelaunch() throws {
        let suite = try DefaultsSuite()

        let first = try Fixture(address: "", suite: suite)
        defer { first.tearDown() }
        first.environment.serverAddress = "http://example.invalid:1234"

        let second = try Fixture(address: nil, suite: suite)
        defer { second.tearDown() }
        #expect(second.environment.serverAddress == "http://example.invalid:1234")
    }

    @Test("an unset address reads back as empty rather than absent")
    func anUnsetAddressReadsBackAsEmpty() throws {
        let fixture = try Fixture(address: nil)
        defer { fixture.tearDown() }
        #expect(fixture.environment.serverAddress.isEmpty)
    }

    // ── Plumbing ───────────────────────────────────────────────────────────

    /// Put a task in a server's vault using a **different** client.
    ///
    /// Deliberately not the environment under test, and deliberately not a
    /// direct file write: the claim being tested is that the client being
    /// launched pulls state it has no local knowledge of, and the only way to be
    /// sure of that is for a separate store, over a separate directory, to have
    /// been what wrote it. This one's queue and cache go away with its temporary
    /// directory.
    private func seedVault(of server: TaskNotesServerProcess, title: String) async throws {
        let directory = try TemporaryDirectory()
        let storage = try FileHostStorage(directory: directory.url)
        let seeder = TaskNotesStore(storage: storage)
        defer { seeder.shutdown() }
        seeder.configure(
            serverURL: server.baseURL,
            authToken: server.authToken.isEmpty ? nil : server.authToken
        )
        seeder.dispatch(.create(payload: createRequest(title: title)))
        await seeder.sync()
        #expect(try server.markdownFiles() == ["\(title).md"], "the seed itself must land")
    }

    /// What the connection banner would say about a store right now.
    private func banner(for store: TaskNotesStore) -> SyncMessage? {
        SyncMessage.of(
            status: store.status,
            pendingCount: store.pendingCount,
            storeError: store.lastStoreError
        )
    }

    /// A create request carrying nothing but a title.
    ///
    /// The generated memberwise initializer takes all thirteen fields, because
    /// UniFFI emits no defaults.
    private func createRequest(title: String) -> CreateTaskRequest {
        CreateTaskRequest(
            title: title,
            details: nil,
            status: nil,
            priority: nil,
            due: nil,
            scheduled: nil,
            contexts: nil,
            projects: nil,
            tags: nil,
            recurrence: nil,
            recurrenceAnchor: nil,
            timeEstimate: nil,
            extraFields: nil
        )
    }
}

/// A throwaway `UserDefaults` domain.
///
/// Never `.standard`: these tests write a persisted preference, and the suite
/// runs on a developer's own Mac where `.standard` for this bundle is the
/// **installed app's** domain. A test that scribbled there would change the
/// server the real app points at.
private final class DefaultsSuite {
    let name: String
    let defaults: UserDefaults

    /// - Throws: ``FixtureFailure`` when the domain cannot be opened.
    init() throws {
        let suiteName = "red.sjer.tasknotes.tests.\(UUID().uuidString)"
        guard let suite = UserDefaults(suiteName: suiteName) else {
            throw FixtureFailure(reason: "could not open the defaults suite \(suiteName)")
        }
        name = suiteName
        defaults = suite
    }

    deinit {
        UserDefaults.standard.removeSuite(named: name)
    }
}

/// An ``AppEnvironment`` over throwaway state.
///
/// Uses the second, `public` initializer, which injects the store, the defaults
/// and the token store — and, deliberately, does **not** install the global
/// hotkey. A test process that claimed one would take a key combination away
/// from whoever is using the Mac for as long as the suite runs. That seam has
/// existed all along; nothing had ever used it.
@MainActor
private struct Fixture {
    let environment: AppEnvironment

    private let directory: TemporaryDirectory
    private let suite: DefaultsSuite

    /// - Parameters:
    ///   - address: what to put in the address field, or `nil` to leave whatever
    ///     the defaults already hold — which is how the relaunch case reads back
    ///     what the previous instance wrote.
    ///   - tokenStore: the credential the environment will find at launch.
    ///   - suite: an existing defaults domain to share, or `nil` for a fresh one.
    /// - Throws: ``FixtureFailure`` when a defaults domain cannot be opened, or
    ///   `CoreError` when the scratch storage directory cannot be created.
    init(
        address: String?,
        tokenStore: any ServerTokenStore = InMemoryTokenStore(),
        suite: DefaultsSuite? = nil
    ) throws {
        directory = try TemporaryDirectory()
        self.suite = try suite ?? DefaultsSuite()
        let storage = try FileHostStorage(directory: directory.url)
        environment = AppEnvironment(
            store: .success(TaskNotesStore(storage: storage)),
            defaults: self.suite.defaults,
            tokenStore: tokenStore
        )
        if let address {
            environment.serverAddress = address
        }
    }

    /// The store, or `nil` when it could not be built — which cannot happen
    /// here, because the fixture hands one in.
    var store: TaskNotesStore? {
        guard case .success(let store) = environment.store else { return nil }
        return store
    }

    /// Stop the engine and release its armed timers.
    ///
    /// Not cosmetic: a failed pull arms a retry, and a scheduler still armed
    /// after the case ends fires against a server the next case has stopped.
    func tearDown() {
        store?.shutdown()
    }
}

/// Why a fixture could not be built.
private struct FixtureFailure: Error, CustomStringConvertible {
    let reason: String

    var description: String { reason }
}
