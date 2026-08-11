import Foundation
import Synchronization
import TaskNotesTestSupport
import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

/// The whole stack, against a real `tasknotes-server` over a real vault.
///
/// What this proves that nothing else does: the **Swift** host implementations
/// drive the **Rust** engine against the **real** server, and the result lands
/// in markdown on disk. The Rust suite proves the protocol; the FFI round-trip
/// check proves the boundary; only this proves the pieces in between —
/// `URLSession` request construction, percent-encoding, the envelope, the
/// `X-Mutation-Id` header, and the file-backed queue — actually work together.
///
/// Serialized because each case spawns a server process; running them in
/// parallel would multiply the startup cost without finding anything.
@Suite("Against a real server", .serialized)
struct ServerIntegrationTests {
    @Test("a dispatched create reaches the vault as markdown")
    func aDispatchedCreateReachesTheVaultAsMarkdown() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let directory = try TemporaryDirectory()
        let host = try HostFixture(directory: directory.url, baseURL: server.baseURL)
        let engine = host.engine()

        try engine.restore()
        #expect(try server.markdownFiles().isEmpty)

        // Dispatch answers optimistically and immediately. Nothing has been
        // sent yet — the enqueue is the only wait.
        let optimistic = try engine.dispatch(
            input: .create(payload: createRequest(title: "Write the Phase 7b report"))
        )
        let queued = try #require(optimistic)
        #expect(queued.title == "Write the Phase 7b report")
        #expect(try engine.snapshot().pendingCount == 1)
        #expect(try server.markdownFiles().isEmpty, "a dispatch must not touch the network")

        // The queue is durable at this point, before anything is sent. That is
        // what makes a crash here survivable.
        #expect(try host.storage.readQueue() != nil)

        try await offMainThread { try engine.syncNow() }

        // The assertion that matters: the user's vault, on disk, as Obsidian
        // would open it.
        let files = try server.markdownFiles()
        #expect(files == ["Write the Phase 7b report.md"])
        let markdown = try server.contents(of: "Write the Phase 7b report.md")
        #expect(markdown.contains("Write the Phase 7b report"))
        #expect(markdown.contains("status: open"))

        let snapshot = try engine.snapshot()
        #expect(snapshot.pendingCount == 0)
        #expect(snapshot.tasks.map(\.title) == ["Write the Phase 7b report"])
        #expect(snapshot.tasks.map(\.id) == ["Write the Phase 7b report.md"])
        #expect(snapshot.lastSyncTime != nil)
        #expect(try engine.status().state == .idle)

        // The temp id the optimistic task carried still resolves, which is what
        // keeps an already-open inspector or a deep link valid across the ack.
        #expect(engineResolves(engine, queued.id, to: "Write the Phase 7b report.md"))
    }

    @Test("a status change reaches the vault's frontmatter")
    func aStatusChangeReachesTheVaultFrontmatter() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let directory = try TemporaryDirectory()
        let host = try HostFixture(directory: directory.url, baseURL: server.baseURL)
        let engine = host.engine()

        try engine.restore()
        _ = try engine.dispatch(input: .create(payload: createRequest(title: "Ship it")))
        try await offMainThread { try engine.syncNow() }
        #expect(try server.contents(of: "Ship it.md").contains("status: open"))

        _ = try engine.dispatch(input: .setStatus(taskId: "Ship it.md", status: .done))
        try await offMainThread { try engine.syncNow() }

        let markdown = try server.contents(of: "Ship it.md")
        #expect(markdown.contains("status: done"))
        #expect(!markdown.contains("status: open"))
        #expect(try engine.snapshot().tasks.map(\.status) == [.done])
    }

    @Test("a delete removes the vault file")
    func aDeleteRemovesTheVaultFile() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let directory = try TemporaryDirectory()
        let host = try HostFixture(directory: directory.url, baseURL: server.baseURL)
        let engine = host.engine()

        try engine.restore()
        _ = try engine.dispatch(input: .create(payload: createRequest(title: "Temporary")))
        try await offMainThread { try engine.syncNow() }
        #expect(try server.markdownFiles() == ["Temporary.md"])

        #expect(try engine.dispatch(input: .delete(taskId: "Temporary.md")) == nil)
        try await offMainThread { try engine.syncNow() }

        #expect(try server.markdownFiles().isEmpty)
        #expect(try engine.snapshot().tasks.isEmpty)
    }

    @Test("a task title needing percent-encoding round-trips")
    func aTaskWithASpaceAndPunctuationRoundTrips() async throws {
        // A task id *is* a vault path, so it carries spaces and can carry
        // slashes. `urlPathAllowed` permits `/`, which is wrong for a single
        // path component — this is the assertion that catches it.
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let directory = try TemporaryDirectory()
        let host = try HostFixture(directory: directory.url, baseURL: server.baseURL)
        let engine = host.engine()

        try engine.restore()
        _ = try engine.dispatch(
            input: .create(payload: createRequest(title: "Review Q3 & Q4 plans"))
        )
        try await offMainThread { try engine.syncNow() }

        let files = try server.markdownFiles()
        #expect(files == ["Review Q3 & Q4 plans.md"])

        _ = try engine.dispatch(
            input: .setStatus(taskId: "Review Q3 & Q4 plans.md", status: .done)
        )
        try await offMainThread { try engine.syncNow() }
        #expect(try server.contents(of: "Review Q3 & Q4 plans.md").contains("status: done"))
    }

    @Test("a replayed mutation id is answered from the server's idempotency store")
    func aReplayedMutationIdIsNotAppliedTwice() async throws {
        // The crash this models: the server acked a create, and the client died
        // before dequeuing it. On relaunch the queue still holds the command and
        // re-sends it with the same `X-Mutation-Id`. Without the header the
        // vault would end up with "Standup.md" *and* "Standup 1.md".
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        // Driven through the raw transport rather than a domain call, because
        // the subject here is the *server's* middleware and the header name the
        // core sends — and since Phase 4.5 the host owns no domain-level API at
        // all. What the core builds for a real create is asserted in the core's
        // own tests and in `cargo xtask verify-swift`.
        let transport = URLSessionTransport()
        let base = server.baseURL.absoluteString
        let key = "mutation-\(UUID().uuidString)"
        func create(withKey key: String) async throws -> HttpResponse {
            try await offMainThread {
                try transport.send(
                    request: HttpRequest(
                        method: .post,
                        url: "\(base)/api/tasks",
                        headers: [
                            HttpHeader(name: "Content-Type", value: "application/json"),
                            HttpHeader(name: "X-Mutation-Id", value: key),
                        ],
                        body: Data(#"{"title":"Standup"}"#.utf8),
                        timeoutMillis: apiDefaultTimeoutMillis()
                    )
                )
            }
        }

        let first = try await create(withKey: key)
        let replay = try await create(withKey: key)

        // 201, not 200 — which is exactly why the core treats the whole 2xx
        // range as success rather than pinning one code.
        #expect((200..<300).contains(first.status))
        #expect(first.status == replay.status)
        #expect(first.body == replay.body, "a replay must answer the stored response")
        #expect(try server.markdownFiles() == ["Standup.md"])

        // A *different* key is a different mutation, and the server dedupes the
        // filename rather than the request — proving the first assertion was
        // the header working, not the server refusing duplicate titles.
        _ = try await create(withKey: "mutation-\(UUID().uuidString)")
        #expect(try server.markdownFiles() == ["Standup 1.md", "Standup.md"])
    }

    @Test("a queued command survives a relaunch and drains afterwards")
    func aQueuedCommandSurvivesARelaunch() async throws {
        let server = try TaskNotesServerProcess()
        defer { server.stop() }
        let directory = try TemporaryDirectory()

        // First "launch": dispatch, then walk away without syncing.
        do {
            let host = try HostFixture(directory: directory.url, baseURL: server.baseURL)
            let engine = host.engine()
            try engine.restore()
            _ = try engine.dispatch(input: .create(payload: createRequest(title: "Survivor")))
            try engine.dispose()
        }
        #expect(try server.markdownFiles().isEmpty)

        // Second "launch": a brand-new engine over the same directory. The only
        // thing carrying the command across is the file-backed queue.
        let host = try HostFixture(directory: directory.url, baseURL: server.baseURL)
        let engine = host.engine()
        try engine.restore()
        #expect(try engine.snapshot().pendingCount == 1)

        try await offMainThread { try engine.syncNow() }
        #expect(try server.markdownFiles() == ["Survivor.md"])
    }

    @Test("a transport failure is classified as transient and arms the bare backoff")
    func aTransportFailureArmsTheDocumentedBackoff() async throws {
        // No server at all: `URLSession` reports connection refused, the Swift
        // transport raises `TransportError.Offline`, the *core* turns that into
        // a `CoreError.Connection`, the Rust classifier calls it transient, and
        // the Swift scheduler records the delay. Every hop in that sentence is a
        // different language — and the middle one used to be Swift's decision.
        //
        // The delay is asserted exactly, not as a range, because the randomness
        // is pinned to the parts-per-million spelling of 0.5 — which makes the
        // jitter factor exactly 1.0 and the schedule the bare
        // `[1000, 2000, … 60000]`.
        let directory = try TemporaryDirectory()
        let recorder = RecordingRetryScheduler()
        let storage = try FileHostStorage(directory: directory.url)
        let unreachable = try #require(URL(string: "http://127.0.0.1:9"))
        let randomness = try #require(FixedRandomness(ppm: UnitPpm.half))

        let engine = FfiSyncEngine(
            api: try TaskNotesApi(
                transport: URLSessionTransport(),
                baseUrl: unreachable.absoluteString,
                requestTimeoutMillis: 2_000
            ),
            queueStorage: storage,
            cacheStorage: storage,
            clock: SystemClock(),
            scheduler: recorder,
            random: randomness,
            autoSync: true
        )
        try engine.restore()
        _ = try engine.dispatch(input: .create(payload: createRequest(title: "Unsendable")))

        await #expect(throws: CoreError.self) {
            try await offMainThread { try engine.syncNow() }
        }

        #expect(recorder.armedDelays == [1_000])
        #expect(try engine.status().state == .backoff)
        #expect(try engine.snapshot().pendingCount == 1, "a transient failure must not drop work")

        await #expect(throws: CoreError.self) {
            try await offMainThread { try engine.syncNow() }
        }
        #expect(recorder.armedDelays == [1_000, 2_000])

        // Disposing cancels the armed timer and arms no new one, so a failure
        // already in flight cannot resurrect a replaced engine.
        try engine.dispose()
        #expect(try engine.isDisposed())
    }

    @Test("the main thread is refused rather than silently blocked")
    @MainActor
    func aMainThreadRequestIsRefused() async throws {
        // The core's `HttpClient` is synchronous, so this call blocks its
        // caller. On the main thread that is a frozen UI for the length of a
        // network round trip, which is invisible to the compiler and easy to
        // write by accident — especially with `NonisolatedNonsendingByDefault`,
        // where a plain `nonisolated async` helper inherits its caller's
        // isolation.
        let transport = URLSessionTransport()
        let request = HttpRequest(
            method: .get,
            url: "http://127.0.0.1:9/api/tasks",
            headers: [],
            body: nil,
            timeoutMillis: 1_000
        )

        let thrown = #expect(throws: TransportError.self) {
            _ = try transport.send(request: request)
        }
        guard case .Other(let message) = try #require(thrown) else {
            Issue.record("expected an Other, got \(String(describing: thrown))")
            return
        }
        #expect(message.contains("main thread"))
    }

    /// Whether the engine follows `id` to `expected`.
    private func engineResolves(
        _ engine: FfiSyncEngine,
        _ id: TaskId,
        to expected: TaskId
    ) -> Bool {
        switch Result(catching: { try engine.resolveTaskId(id: id) }) {
        case .success(let resolved): return resolved == expected
        case .failure: return false
        }
    }
}

/// A ``RetryScheduler`` that records what it was asked to arm.
///
/// Not a mock of the core: it is a real host implementation that happens to
/// keep a log, and the thing under test is the Rust backoff policy reaching a
/// Swift host with the numbers the plan documents.
final class RecordingRetryScheduler: RetryScheduler {
    private let state = Mutex(State())

    /// The delays passed to `arm`, in order.
    var armedDelays: [Int64] { state.withLock { $0.delays } }

    /// The timers cancelled, in order. Includes already-fired ones, which is
    /// the point: the engine cancels unconditionally at the top of every drain.
    var cancellations: [TimerId] { state.withLock { $0.cancellations } }

    func arm(delayMillis: Int64) -> TimerId {
        state.withLock { current in
            current.delays.append(delayMillis)
            current.nextTimerId += 1
            return current.nextTimerId
        }
    }

    func cancel(timer: TimerId) {
        state.withLock { current in
            current.cancellations.append(timer)
        }
    }

    private struct State {
        var nextTimerId: TimerId = 0
        var delays: [Int64] = []
        var cancellations: [TimerId] = []
    }
}
