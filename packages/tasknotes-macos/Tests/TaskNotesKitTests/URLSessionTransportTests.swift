import Foundation
import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

/// What the transport puts on the wire, one request at a time.
///
/// This is the only place in the package that can tell "no `Authorization`
/// header" apart from "an `Authorization` header carrying nothing". A server
/// cannot: it rejects both, identically, with a 401 that reads as a wrong
/// password. So the distinction has to be asserted here, and the fact that the
/// header reaches a socket at all has to be asserted somewhere else — see
/// `ServerAuthIntegrationTests`, where the negative control is what proves it.
@Suite("The transport's request")
struct URLSessionTransportTests {
    @Test("no token sends no Authorization header")
    func noTokenSendsNoHeader() {
        #expect(authorizationHeader(forToken: nil) == nil)
    }

    @Test("a token is sent as a bearer credential")
    func aTokenIsSentAsABearerCredential() {
        #expect(authorizationHeader(forToken: "t") == "Bearer t")
    }

    /// ⚠️ The row this file was written for.
    ///
    /// `if let authToken` alone is true for `""`, which sends
    /// `Authorization: Bearer ` — a header with a trailing space and no
    /// credential. Every server answers that with a 401, which presents as
    /// "your token is wrong" rather than "you have no token", and the two need
    /// completely different things from the user.
    ///
    /// It was masked, not absent: both ``ServerTokenStore`` implementations
    /// normalise empty to `nil` on the way in, so the empty string never
    /// reached here through the app's own path. But
    /// `TaskNotesStore.configure(serverURL:authToken:)` is `public` and takes a
    /// `String?` with no such rule, so the guarantee lived in a different file
    /// from the assumption — two independent facts that happened to agree.
    @Test("an empty token sends no Authorization header")
    func anEmptyTokenSendsNoHeader() {
        #expect(authorizationHeader(forToken: "") == nil)
    }

    /// Whitespace is not a credential either, for the same reason.
    @Test("a whitespace-only token sends no Authorization header")
    func aWhitespaceTokenSendsNoHeader() {
        #expect(authorizationHeader(forToken: "   ") == nil)
    }

    @Test("the core's own headers are preserved alongside the credential")
    func theCoresHeadersArePreserved() {
        let request = URLSessionTransport.urlRequest(
            for: probe(headers: [HttpHeader(name: "X-Mutation-Id", value: "abc")]),
            url: Self.url,
            authToken: "t"
        )
        #expect(request.value(forHTTPHeaderField: "X-Mutation-Id") == "abc")
        #expect(
            request.value(forHTTPHeaderField: URLSessionTransport.authorizationHeader)
                == "Bearer t"
        )
    }

    @Test("method, body and timeout come straight from the core's request")
    func theRequestIsTranslatedFaithfully() {
        let body = Data("{}".utf8)
        let request = URLSessionTransport.urlRequest(
            for: HttpRequest(
                method: .put,
                url: Self.url.absoluteString,
                headers: [],
                body: body,
                timeoutMillis: 2500
            ),
            url: Self.url,
            authToken: nil
        )
        #expect(request.httpMethod == "PUT")
        #expect(request.httpBody == body)
        #expect(request.timeoutInterval == 2.5)
    }

    /// ⚠️ **The disposal race, as its one observable consequence.**
    ///
    /// `FfiSyncEngine.dispose()` abandons in-flight requests *before* it takes
    /// the engine lock, and that ordering is the only thing bounding a
    /// synchronous main-actor disposal. A snapshot-and-cancel alone does not
    /// bound it: a drain that finished one request just before the snapshot
    /// registers its next one just after, and that request is never cancelled —
    /// so `dispose()` waits out a full network timeout with every window
    /// frozen. Closing is what removes the gap, and this is the property that
    /// says so: once closed, a request is refused rather than resumed, whatever
    /// its timeout says.
    @Test("a request registered after disposal is refused, not left to time out")
    func aRequestAfterCancellationIsRefused() async throws {
        let transport = URLSessionTransport()
        transport.cancelAll()
        // Idempotent: disposal and a shutdown can both reach this.
        transport.cancelAll()

        let patient = HttpRequest(
            method: .get,
            url: "http://127.0.0.1:9/api/tasks",
            headers: [],
            body: nil,
            timeoutMillis: 30_000
        )
        let started = ContinuousClock.now
        let thrown = try await offMainThread {
            #expect(throws: TransportError.self) {
                _ = try transport.send(request: patient)
            }
        }
        let elapsed = ContinuousClock.now - started

        guard case .Other(let message) = try #require(thrown) else {
            Issue.record("expected an Other, got \(String(describing: thrown))")
            return
        }
        #expect(message.contains("closed"))
        // The freeze this closes is a caller waiting out the request's own
        // timeout, so "refused" is only the fix if it is also immediate.
        #expect(elapsed < .seconds(1), "the refusal took \(elapsed)")
    }

    // ── Plumbing ───────────────────────────────────────────────────────────

    private static let url = URL(string: "http://127.0.0.1:8080/api/v2/tasks")!

    private func authorizationHeader(forToken token: String?) -> String? {
        URLSessionTransport.urlRequest(for: probe(), url: Self.url, authToken: token)
            .value(forHTTPHeaderField: URLSessionTransport.authorizationHeader)
    }

    private func probe(headers: [HttpHeader] = []) -> HttpRequest {
        HttpRequest(
            method: .get,
            url: Self.url.absoluteString,
            headers: headers,
            body: nil,
            timeoutMillis: 1000
        )
    }
}
