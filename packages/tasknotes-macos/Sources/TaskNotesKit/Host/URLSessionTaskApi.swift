internal import Dispatch
internal import Synchronization
public import TaskNotesUniFFI

public import struct Foundation.CharacterSet
public import struct Foundation.Data
public import class Foundation.HTTPURLResponse
public import class Foundation.Thread
public import struct Foundation.TimeInterval
public import struct Foundation.URL
public import struct Foundation.URLError
public import struct Foundation.URLRequest
public import class Foundation.URLResponse
public import class Foundation.URLSession

/// The core's `TaskApi` over `URLSession`.
///
/// Keeping the platform's own HTTP stack — its proxy configuration, ATS policy,
/// cookie and credential storage, HTTP/2 and background-transfer behaviour — is
/// a stated reason the core is sans-I/O. The core describes *what* to request;
/// this decides *how*, and every Apple-specific answer to "how" stays on this
/// side of the boundary.
///
/// ## Why it blocks, and why that is safe
///
/// The core's `TaskApi` is synchronous, because UniFFI 0.31 has no cancellation
/// support for async calls at all. `URLSession` is not. So each call here parks
/// its own thread on a semaphore while the session's delegate queue — a
/// different, private queue — completes the request. There is no deadlock in
/// that: the two are never the same thread.
///
/// What it does mean is that **the engine must never be driven from the main
/// thread**, or the UI freezes for the length of a network round trip. That is
/// enforced rather than documented: a call from the main thread throws
/// `CoreError.Invariant` immediately, which is a loud, typed, testable failure
/// rather than a beachball nobody attributes to this file.
public final class URLSessionTaskApi: TaskApi {
    /// How long a single request may take before it is abandoned.
    ///
    /// Fifteen seconds, matching the reference TypeScript client, so the
    /// engine's retry classifier sees the same timing on both clients.
    public static let defaultTimeout: TimeInterval = 15

    /// The idempotency key header the server's middleware reads.
    public static let mutationIdHeader = "X-Mutation-Id"

    private let baseURL: URL
    private let authToken: String?
    private let session: URLSession
    private let timeout: TimeInterval

    /// A client against `baseURL`, using `session` for transport.
    ///
    /// `session` is injectable so a caller can supply an ephemeral or
    /// specially configured one. It is not a seam for a fake: the contract this
    /// class implements is only meaningful against a real server, and a fake
    /// would only assert that Swift calls Swift in a particular order.
    public init(
        baseURL: URL,
        authToken: String? = nil,
        session: URLSession = .shared,
        timeout: TimeInterval = URLSessionTaskApi.defaultTimeout
    ) {
        self.baseURL = baseURL
        self.authToken = authToken
        self.session = session
        self.timeout = timeout
    }

    // ── The trait ──────────────────────────────────────────────────────────

    /// Pull every task.
    ///
    /// The `/v2` list endpoint caps `limit` at 200, so this pages until
    /// `hasMore` is false. It advances by what it actually received rather than
    /// by the declared limit, so a short page cannot skip the gap items; a page
    /// that is empty while `hasMore` is true is a broken server contract and
    /// fails loudly instead of looping forever on a zero-length advance.
    public func listTasks() throws(CoreError) -> [CoreTask] {
        var tasks: [CoreTask] = []
        var offset = 0
        while true {
            let page = try send(
                method: "GET",
                path: "/api/tasks",
                query: "limit=200&offset=\(offset)"
            )
            guard
                let object = page as? [String: Any],
                let entries = object["tasks"] as? [Any],
                let pagination = object["pagination"] as? [String: Any],
                let hasMore = pagination["hasMore"] as? Bool
            else {
                throw CoreError.Validation(message: "the task list page did not match the schema")
            }

            tasks.append(contentsOf: try WireBridge.tasks(fromWire: entries))
            guard hasMore else { return tasks }
            guard !entries.isEmpty else {
                throw CoreError.Api(
                    message: "task list pagination returned an empty page while hasMore=true",
                    status: 0
                )
            }
            offset += entries.count
        }
    }

    public func createTask(
        request: CreateTaskRequest,
        mutationId: String?
    ) throws(CoreError) -> CoreTask {
        try task(
            from: try send(
                method: "POST",
                path: "/api/tasks",
                body: .json(try WireBridge.body(forCreate: request)),
                mutationId: mutationId
            )
        )
    }

    public func updateTask(
        id: TaskId,
        request: UpdateTaskRequest,
        mutationId: String?
    ) throws(CoreError) -> CoreTask {
        let component = try Self.escape(id)
        return try task(
            from: try send(
                method: "PUT",
                path: "/api/tasks/\(component)",
                body: .json(try WireBridge.body(forUpdate: request)),
                mutationId: mutationId
            )
        )
    }

    public func deleteTask(id: TaskId, mutationId: String?) throws(CoreError) {
        let component = try Self.escape(id)
        _ = try send(method: "DELETE", path: "/api/tasks/\(component)", mutationId: mutationId)
    }

    /// Set a task's status to an absolute value.
    ///
    /// Deliberately a `PUT`, not the `/toggle-status` endpoint. That endpoint
    /// takes no body and cycles server-side, which is useless for idempotent
    /// offline replay: replaying a cycle twice lands somewhere different from
    /// replaying it once. Absolute state is what makes a queued command safe to
    /// re-send, so the app's semantics ride on `PUT` — exactly as the reference
    /// TypeScript client does.
    public func toggleTaskStatus(
        id: TaskId,
        status: TaskStatus,
        mutationId: String?
    ) throws(CoreError) -> CoreTask {
        let component = try Self.escape(id)
        return try task(
            from: try send(
                method: "PUT",
                path: "/api/tasks/\(component)",
                body: .json(["status": taskStatusWireValue(status: status)]),
                mutationId: mutationId
            )
        )
    }

    public func completeRecurringInstance(
        id: TaskId,
        instance: InstanceCompletion?,
        mutationId: String?
    ) throws(CoreError) -> CoreTask {
        let component = try Self.escape(id)
        // `.absent` is not the same as an empty object here. Without a body
        // the server falls back to its legacy toggle-today behaviour; with
        // `{}` it would try to parse one. That distinction is why `RequestBody`
        // is an enum rather than an optional dictionary.
        let body: RequestBody =
            instance.map { instance in
                .json(["date": instance.date, "completed": instance.completed])
            } ?? .absent
        return try task(
            from: try send(
                method: "POST",
                path: "/api/tasks/\(component)/complete-instance",
                body: body,
                mutationId: mutationId
            )
        )
    }

    // ── Request plumbing ───────────────────────────────────────────────────

    private func task(from payload: Any) throws(CoreError) -> CoreTask {
        guard let object = payload as? [String: Any] else {
            throw CoreError.Validation(message: "the server did not answer with a task object")
        }
        return try WireBridge.task(fromWire: object)
    }

    private func send(
        method: String,
        path: String,
        query: String? = nil,
        body: RequestBody = .absent,
        mutationId: String? = nil
    ) throws(CoreError) -> Any {
        var urlRequest = URLRequest(url: try url(path: path, query: query))
        urlRequest.httpMethod = method
        urlRequest.timeoutInterval = timeout
        if case .json(let fields) = body {
            urlRequest.httpBody = try WireBridge.data(fromJSON: fields)
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let authToken {
            urlRequest.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        if let mutationId {
            urlRequest.setValue(mutationId, forHTTPHeaderField: Self.mutationIdHeader)
        }

        let outcome = try perform(urlRequest, describing: path)
        guard (200..<300).contains(outcome.status) else {
            throw Self.failure(status: outcome.status, path: path, body: outcome.body)
        }
        return try WireBridge.unwrapEnvelope(try WireBridge.value(fromJSON: outcome.body))
    }

    private func url(path: String, query: String?) throws(CoreError) -> URL {
        let relative = query.map { "\(path)?\($0)" } ?? path
        guard let resolved = URL(string: relative, relativeTo: baseURL) else {
            throw CoreError.Invariant(message: "could not build a URL for \(relative)")
        }
        return resolved.absoluteURL
    }

    /// One request, synchronously.
    private func perform(
        _ urlRequest: URLRequest,
        describing path: String
    ) throws(CoreError) -> HTTPOutcome {
        guard !Thread.isMainThread else {
            throw CoreError.Invariant(
                message: """
                    \(path) was requested on the main thread. The core's TaskApi is synchronous, \
                    so this call blocks; drive the engine from a background executor.
                    """
            )
        }

        let slot = Mutex<Result<HTTPOutcome, CoreError>?>(nil)
        let finished = DispatchSemaphore(value: 0)
        let dataTask = session.dataTask(with: urlRequest) { data, response, error in
            slot.withLock { value in
                value = Self.classify(data: data, response: response, error: error, path: path)
            }
            finished.signal()
        }
        dataTask.resume()
        finished.wait()

        guard let result = slot.withLock({ $0 }) else {
            throw CoreError.Invariant(
                message: "the URLSession completion handler for \(path) produced no outcome"
            )
        }
        switch result {
        case .success(let value): return value
        case .failure(let error): throw error
        }
    }

    private static func classify(
        data: Data?,
        response: URLResponse?,
        error: (any Error)?,
        path: String
    ) -> Result<HTTPOutcome, CoreError> {
        if let error {
            // Transport failures — refused, unreachable, DNS, and timeouts —
            // are all one class to the engine's classifier: transient, retried
            // with backoff. `URLError` is unwrapped only so the message names
            // which one it was.
            let described = (error as? URLError)?.localizedDescription
            return .failure(
                .Connection(message: "\(path) failed: \(described ?? error.localizedDescription)")
            )
        }
        guard let http = response as? HTTPURLResponse else {
            return .failure(.Invariant(message: "\(path) answered with a non-HTTP response"))
        }
        return .success(HTTPOutcome(status: http.statusCode, body: data ?? Data()))
    }

    private static func failure(status: Int, path: String, body: Data) -> CoreError {
        guard status != 404 else {
            return .NotFound(message: "resource not found: \(path)")
        }
        // The body is only ever a diagnostic string here, so a non-UTF-8 one
        // is described rather than thrown: replacing one failure with a
        // different one would lose the status code that actually matters.
        let detail = String(bytes: body, encoding: .utf8) ?? "<non-UTF-8 body>"
        return .Api(
            message: "HTTP \(status) for \(path)\(detail.isEmpty ? "" : ": \(detail)")",
            status: UInt16(clamping: status)
        )
    }

    /// Percent-encode a task id for use as a single path component.
    ///
    /// A task id is a vault path — `Tasks/Write the plan.md` — so it carries
    /// both slashes and spaces. `urlPathAllowed` deliberately permits `/`, which
    /// is wrong here: the id is one component, not several. The set is
    /// therefore narrowed by subtraction so the result matches
    /// `encodeURIComponent`, which is what the reference client uses.
    private static func escape(_ id: TaskId) throws(CoreError) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/;,=:@&+$?")
        guard let escaped = id.addingPercentEncoding(withAllowedCharacters: allowed) else {
            throw CoreError.Invariant(message: "a task id could not be percent-encoded: \(id)")
        }
        return escaped
    }

    private struct HTTPOutcome: Sendable {
        let status: Int
        let body: Data
    }

    /// Whether a request carries a body, and what it is.
    ///
    /// An enum rather than `[String: Any]?` because the two states are
    /// genuinely different requests, not a present-or-missing value:
    /// `/complete-instance` with no body means "toggle whatever the server
    /// thinks today is", and with `{}` means "parse this". An optional
    /// dictionary makes that distinction look accidental.
    private enum RequestBody {
        case absent
        case json([String: Any])
    }
}
