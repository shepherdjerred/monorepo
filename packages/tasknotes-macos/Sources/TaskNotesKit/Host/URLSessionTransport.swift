internal import Dispatch
internal import Synchronization
public import TaskNotesUniFFI

public import struct Foundation.Data
public import class Foundation.HTTPURLResponse
public import class Foundation.Thread
public import struct Foundation.TimeInterval
public import struct Foundation.URL
public import struct Foundation.URLError
public import struct Foundation.URLRequest
public import class Foundation.URLResponse
public import class Foundation.URLSession
public import class Foundation.URLSessionTask

/// The core's `HttpClient`, over `URLSession`.
///
/// This file is the *whole* network surface of the app, and it is deliberately
/// tiny. It knows nothing about tasks: it takes a method, an absolute URL,
/// headers and bytes, and answers with a status, headers and bytes. The URL, the
/// percent-escaping of a vault path, the `/v2` field renames, the response
/// envelope and the HTTP-status → error mapping the retry classifier reads all
/// belong to `tasknotes-core` and are reached through `TaskNotesApi`.
///
/// It replaced a `TaskApi` implementation plus a 240-line `WireBridge`, and the
/// deletion was the point rather than a side effect:
///
///   * Every further shell (C# next) inherits the wire layer instead of
///     transcribing it.
///   * Retry classification stopped being a shell decision. `TransportError`
///     cannot carry a status, so "a 503 is transient" is not something this file
///     could get wrong even by trying.
///   * `customProperties` stopped being reordered. Foundation has no ordered
///     JSON type, so a task's unmodelled frontmatter keys were scrambled in both
///     directions here — and the server writes YAML frontmatter from them, so a
///     read-then-write rewrote the user's file. Bytes have no key order to lose.
///
/// ## Why it blocks, and why that is safe
///
/// `HttpClient.send` is synchronous, because UniFFI 0.31 has no cancellation
/// support for async calls at all. `URLSession` is not. So each call here parks
/// its own thread on a semaphore while the session's delegate queue — a
/// different, private queue — completes the request. There is no deadlock in
/// that: the two are never the same thread.
///
/// What it does mean is that **the engine must never be driven from the main
/// thread**, or the UI freezes for the length of a network round trip. That is
/// enforced rather than documented: a call from the main thread fails
/// immediately, which is a loud, testable failure rather than a beachball
/// nobody attributes to this file.
///
/// ## Cancellation
///
/// ``cancelAll()`` is the explicit hook the core asks for, and it exists
/// because a dropped future cannot be the mechanism. It is callable from another
/// thread *while* ``send(request:)`` is parked, which is the only moment it is
/// useful: quitting or reconfiguring the server mid-request used to block a
/// thread for the whole fifteen-second timeout.
///
/// ⚠️ **It closes the transport, rather than only cancelling what is running.**
/// A snapshot-and-cancel alone leaves a gap the length of the whole race: the
/// caller is `FfiSyncEngine.dispose()`, which abandons in-flight requests
/// *before* it takes the engine lock precisely so a reconfiguration cannot
/// block on a network timeout — but disposal overlaps a multi-request drain,
/// and a drain that finished request *n* just before the snapshot registers
/// request *n + 1* just after it. That request never appears in the snapshot,
/// so it is never cancelled, and the synchronous main-actor `dispose()` then
/// waits out its full timeout with every window frozen. The closed flag and the
/// task list are read and written under one lock, so a request either joins the
/// list in time to be cancelled or is refused outright — there is no third
/// outcome. Closing is permanent, which costs nothing: the app's rule is
/// already "reconfigure ⇒ replace", so a new server address or token means a
/// new transport, a new `TaskNotesApi` and a new engine.
public final class URLSessionTransport: HttpClient {
    /// The authorization header this transport adds to every request.
    ///
    /// Auth lives here rather than in the core on purpose: the token comes from
    /// the platform keychain, and the core has no use for a secret it would only
    /// copy into a header. It is also why this is a constructor argument —
    /// changing the token means a new transport, a new `TaskNotesApi` and a new
    /// engine, which is the same "reconfigure ⇒ replace" rule the core states
    /// for the server address.
    public static let authorizationHeader = "Authorization"

    /// What is running, and whether anything more is allowed to start.
    ///
    /// One value under one lock rather than two, because the invariant is a
    /// relationship between them: "closed implies nothing will be added after
    /// the last cancellation" is unstatable if a request can be registered
    /// between reading the flag and appending to the list.
    private struct Requests {
        var isClosed = false
        var running: [URLSessionTask] = []
    }

    private let authToken: String?
    private let session: URLSession
    private let requests = Mutex(Requests())

    /// A transport that adds `authToken` as a bearer credential, if given.
    ///
    /// `session` is injectable so a caller can supply an ephemeral or specially
    /// configured one.
    public init(authToken: String? = nil, session: URLSession = .shared) {
        self.authToken = authToken
        self.session = session
    }

    // ── The trait ──────────────────────────────────────────────────────────

    /// Perform one request, synchronously.
    ///
    /// - Throws: `TransportError`, and only that. A response the server sent is
    ///   returned whatever its status: deciding what a 404 or a 503 *means* is
    ///   the core's job, and a transport that pre-judged it would be reinventing
    ///   the coupling this boundary exists to remove.
    public func send(request: HttpRequest) throws(TransportError) -> HttpResponse {
        guard !Thread.isMainThread else {
            throw TransportError.Other(
                message: """
                    \(request.url) was requested on the main thread. HttpClient.send is \
                    synchronous, so this call blocks; drive the engine from a background \
                    executor.
                    """
            )
        }

        // The core builds an absolute, fully escaped URL, so a string that will
        // not parse is a bug in the core rather than bad user input. It is
        // reported as a transport failure naming the offending string, because
        // the alternative — a force unwrap — would trap inside the user's app.
        guard let url = URL(string: request.url) else {
            throw TransportError.Other(message: "the core built an unparseable URL: \(request.url)")
        }

        let slot = Mutex<Result<HttpResponse, TransportError>?>(nil)
        let finished = DispatchSemaphore(value: 0)
        let task = session.dataTask(
            with: Self.urlRequest(for: request, url: url, authToken: authToken)
        ) {
            data, response, error in
            slot.withLock { value in
                value = Self.outcome(data: data, response: response, error: error, url: request.url)
            }
            finished.signal()
        }
        // Registering is what makes this request cancellable, so a transport
        // that has already been closed must refuse here rather than resume a
        // request nothing is holding. `.Other` deliberately, because that is
        // also what an actually-cancelled request classifies as: the core's
        // retry policy should not be able to tell the two apart.
        let started = requests.withLock { requests in
            guard !requests.isClosed else { return false }
            requests.running.append(task)
            return true
        }
        guard started else {
            throw TransportError.Other(
                message: "\(request.url) was not sent: the transport has been closed"
            )
        }
        task.resume()
        finished.wait()
        requests.withLock { requests in
            requests.running.removeAll { $0 === task }
        }

        guard let result = slot.withLock({ $0 }) else {
            throw TransportError.Other(
                message: "the URLSession completion handler for \(request.url) produced no outcome"
            )
        }
        switch result {
        case .success(let response): return response
        case .failure(let error): throw error
        }
    }

    /// Close the transport and abandon every request currently in flight.
    ///
    /// Each abandoned request wakes its parked thread with `URLError.cancelled`,
    /// which reaches the core as an ordinary `TransportError`. Every *later*
    /// request is refused before it starts, which is what bounds
    /// `FfiSyncEngine.dispose()` to the requests it can see rather than to
    /// whatever a concurrent drain registers next — see the type's note.
    ///
    /// Idempotent, and a no-op on a transport that never sent anything.
    public func cancelAll() {
        let running = requests.withLock { requests in
            requests.isClosed = true
            let snapshot = requests.running
            requests.running.removeAll()
            return snapshot
        }
        for task in running {
            task.cancel()
        }
    }

    // ── Translation, and nothing else ──────────────────────────────────────

    /// The one place a `HttpRequest` becomes a `URLRequest`.
    ///
    /// `internal` rather than `private` so a test can read the header this
    /// builds without a socket. That is the only assertion in this package that
    /// can distinguish "no header" from "a header with an empty credential",
    /// because a server cannot: both are rejected identically.
    static func urlRequest(
        for request: HttpRequest,
        url: URL,
        authToken: String?
    ) -> URLRequest {
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = wireMethod(request.method)
        urlRequest.httpBody = request.body
        urlRequest.timeoutInterval = TimeInterval(request.timeoutMillis) / 1000
        for header in request.headers {
            urlRequest.setValue(header.value, forHTTPHeaderField: header.name)
        }
        // ⚠️ The emptiness check is load-bearing, and `if let` alone was not
        // enough. An empty token used to send `Authorization: Bearer ` — a
        // header with a trailing space and no credential — which every server
        // answers with a 401 that reads as "your token is wrong" rather than
        // "you have no token". Those need opposite things from the user.
        //
        // It was masked rather than absent: both `ServerTokenStore`
        // implementations normalise empty to `nil`, so nothing in the app
        // reached here with `""`. But that made the guarantee live in a
        // different file from the assumption, and
        // `TaskNotesStore.configure(serverURL:authToken:)` is `public` and
        // carries no such rule. Two independent facts coinciding is not an
        // invariant; this line is.
        let credential = authToken?.trimmingWhitespace()
        if let credential, !credential.isEmpty {
            urlRequest.setValue("Bearer \(credential)", forHTTPHeaderField: authorizationHeader)
        }
        return urlRequest
    }

    private static func wireMethod(_ method: HttpMethod) -> String {
        switch method {
        case .get: "GET"
        case .post: "POST"
        case .put: "PUT"
        case .delete: "DELETE"
        }
    }

    private static func outcome(
        data: Data?,
        response: URLResponse?,
        error: (any Error)?,
        url: String
    ) -> Result<HttpResponse, TransportError> {
        if let error {
            return .failure(classify(error, url: url))
        }
        guard let http = response as? HTTPURLResponse else {
            return .failure(.Other(message: "\(url) answered with a non-HTTP response"))
        }
        return .success(
            HttpResponse(
                status: UInt16(clamping: http.statusCode),
                headers: headers(of: http),
                body: data ?? Data()
            )
        )
    }

    /// Read the response headers.
    ///
    /// ⚠️ Foundation exposes them as an unordered dictionary, so the order the
    /// server sent is lost here and cannot be recovered. The core does not
    /// depend on response-header order — it looks values up by name — but a
    /// future shell that can preserve order should, because duplicates are
    /// legal and the `Vec<HttpHeader>` shape carries them.
    private static func headers(of response: HTTPURLResponse) -> [HttpHeader] {
        response.allHeaderFields.compactMap { field in
            guard let name = field.key as? String, let value = field.value as? String else {
                return nil
            }
            return HttpHeader(name: name, value: value)
        }
    }

    /// Map a `URLError` onto the core's four transport classes.
    ///
    /// The classes are transport facts, not policy: what a timeout or a refused
    /// connection *costs* a queued command is decided in Rust, identically for
    /// every shell. The job here is only to report accurately.
    private static func classify(_ error: any Error, url: String) -> TransportError {
        guard let urlError = error as? URLError else {
            return .Other(message: "\(url) failed: \(error.localizedDescription)")
        }
        let described = "\(url) failed: \(urlError.localizedDescription)"
        // Set membership rather than a `switch`, and that is forced rather than
        // stylistic: `URLError.Code` has around ninety cases, so an exhaustive
        // switch is unwritable and a `default:` is banned for the good reason
        // that it absorbs cases added later. A lookup says the same thing
        // without pretending the remainder was considered.
        if urlError.code == .timedOut {
            return .Timeout(message: described)
        }
        if offlineCodes.contains(urlError.code) {
            return .Offline(message: described)
        }
        if tlsCodes.contains(urlError.code) {
            return .Tls(message: described)
        }
        return .Other(message: described)
    }

    /// The codes that mean "there is no route to the server right now".
    private static let offlineCodes: Set<URLError.Code> = [
        .notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost,
        .cannotFindHost, .dnsLookupFailed, .internationalRoamingOff, .dataNotAllowed,
    ]

    /// The codes that mean "the connection was refused on cryptographic grounds".
    private static let tlsCodes: Set<URLError.Code> = [
        .secureConnectionFailed, .serverCertificateHasBadDate, .serverCertificateUntrusted,
        .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid,
        .clientCertificateRejected, .clientCertificateRequired,
        .appTransportSecurityRequiresSecureConnection,
    ]
}

extension TaskNotesApi {
    /// The core's `/v2` client, over `URLSession`.
    ///
    /// The one place the app turns a configured server address plus a keychain
    /// token into the core's client. Everything above the socket is the core's
    /// from here on.
    ///
    /// - Throws: `CoreError.Validation` when the address carries no scheme.
    public static func urlSession(serverURL: URL, authToken: String?) throws -> TaskNotesApi {
        try TaskNotesApi(
            transport: URLSessionTransport(authToken: authToken),
            baseUrl: serverURL.absoluteString,
            requestTimeoutMillis: apiDefaultTimeoutMillis()
        )
    }
}
