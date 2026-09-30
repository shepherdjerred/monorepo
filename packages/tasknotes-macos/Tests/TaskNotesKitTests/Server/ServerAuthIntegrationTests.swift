import Foundation
import TaskNotesTestSupport
import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

/// The credential, against a server that actually demands one.
///
/// ## Why a real gated server, and not an assertion on a `URLRequest`
///
/// `URLSessionTransportTests` already reads the header off a request this
/// package built. That proves the *shape* of the header and nothing about
/// whether it survives the trip: `URLSession` could drop it, the core could
/// build a URL these headers never reach, the transport could be bypassed
/// entirely. Asserting on a request you constructed yourself only ever proves
/// that you constructed it.
///
/// ⚠️ **The negative control is the proof.** "The right token works" is a
/// claim about the socket only because *the identical call without the token
/// 401s in the case above it* — same server, same client, same request, one
/// difference. Delete the first test and the second one stops meaning anything,
/// because an open server would pass it too.
///
/// That is also why ``TaskNotesServerProcess`` refuses to hand back a server
/// whose gate does not match what was asked for: the whole file rests on the
/// server being genuinely closed, and a typo in an environment-variable name
/// would silently make it open and every assertion here vacuous.
///
/// Every pre-existing integration test runs with `AUTH_TOKEN=""`, so before
/// this file nothing in the package had ever sent a credential to a server that
/// would look at it.
@Suite("Against a gated server", .serialized)
struct ServerAuthIntegrationTests {
    private static let token = "a-token-the-server-will-check"

    /// The control. No credential, and the vault is untouched.
    @Test("without a token the engine reaches authError and the vault stays empty")
    func withoutATokenTheEngineReachesAuthError() async throws {
        let server = try TaskNotesServerProcess(authToken: Self.token)
        defer { server.stop() }
        let directory = try TemporaryDirectory()
        let host = try HostFixture(directory: directory.url, baseURL: server.baseURL)
        let engine = host.engine()

        try engine.restore()
        _ = try engine.dispatch(input: .create(payload: createRequest(title: "Never arrives")))

        await #expect(throws: CoreError.self) {
            try await offMainThread { try engine.syncNow() }
        }

        // `authError` and not `backoff`: the core arms no retry for a rejected
        // credential, because retrying a wrong password on a schedule is how an
        // account gets locked out rather than how it gets fixed.
        #expect(try engine.status().state == .authError)
        #expect(try server.markdownFiles().isEmpty, "an unauthenticated write must not land")
        // Still queued, still durable. A 401 loses nothing the user typed.
        #expect(try engine.snapshot().pendingCount == 1)
    }

    /// The same request, one header different.
    @Test("with the right token the task reaches the vault as markdown")
    func withTheRightTokenTheTaskReachesTheVault() async throws {
        let server = try TaskNotesServerProcess(authToken: Self.token)
        defer { server.stop() }
        let directory = try TemporaryDirectory()
        let host = try HostFixture(
            directory: directory.url,
            baseURL: server.baseURL,
            authToken: server.authToken
        )
        let engine = host.engine()

        try engine.restore()
        _ = try engine.dispatch(input: .create(payload: createRequest(title: "Arrives")))
        try await offMainThread { try engine.syncNow() }

        #expect(try server.markdownFiles() == ["Arrives.md"])
        #expect(try server.contents(of: "Arrives.md").contains("Arrives"))
        #expect(try engine.status().state == .idle)
        #expect(try engine.snapshot().pendingCount == 0)
    }

    /// A wrong credential is rejected exactly like a missing one, which is the
    /// reason ``URLSessionTransportTests`` has to exist: from out here the two
    /// are indistinguishable, so "we sent an empty token" cannot be diagnosed
    /// at this level at all.
    @Test("a wrong token is rejected")
    func aWrongTokenIsRejected() async throws {
        let server = try TaskNotesServerProcess(authToken: Self.token)
        defer { server.stop() }
        let directory = try TemporaryDirectory()
        let host = try HostFixture(
            directory: directory.url,
            baseURL: server.baseURL,
            authToken: "not-the-token"
        )
        let engine = host.engine()

        try engine.restore()
        _ = try engine.dispatch(input: .create(payload: createRequest(title: "Rejected")))

        await #expect(throws: CoreError.self) {
            try await offMainThread { try engine.syncNow() }
        }
        #expect(try engine.status().state == .authError)
        #expect(try server.markdownFiles().isEmpty)
    }

    /// The harness's own guard, exercised rather than assumed.
    ///
    /// A gated server must report an unauthenticated `/api/health` as
    /// unauthenticated. If it does not, the environment variable never reached
    /// the process and every other test in this file is passing against an open
    /// server — which is precisely the failure mode this whole suite would
    /// otherwise be blind to.
    @Test("a gated server reports itself gated on the unauthenticated health route")
    func aGatedServerReportsItselfGated() throws {
        // Reaching this line at all is the assertion: the initializer throws
        // `ServerUnavailable` when the observed gate is not the requested one.
        let gated = try TaskNotesServerProcess(authToken: Self.token)
        defer { gated.stop() }
        #expect(gated.authToken == Self.token)

        let open = try TaskNotesServerProcess()
        defer { open.stop() }
        #expect(open.authToken.isEmpty)
    }
}
