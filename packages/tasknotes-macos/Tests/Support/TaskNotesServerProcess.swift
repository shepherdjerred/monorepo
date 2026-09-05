internal import Dispatch
public import Foundation
internal import Network
internal import Synchronization

/// A real `packages/tasknotes-server` process over a temporary vault.
///
/// The plan puts the wire contract in Rust "against a spawned server", and this
/// mirrors that *approach* rather than that code: the point of an end-to-end
/// test here is not to re-check the protocol — Rust already does — but to prove
/// that the **Swift** host implementations drive a real server correctly. A
/// fake would only assert that Swift calls Swift in a particular order.
///
/// Because the vault is a real directory on the same filesystem as the test,
/// "drive the client → assert on the vault's markdown bytes" is a plain
/// synchronous read. That is the tightest possible assertion: it goes past the
/// HTTP response, past the server's in-memory repository, and lands on the file
/// a user would open in Obsidian.
///
/// ## Why this is its own target rather than a file in a test target
///
/// A test target cannot import another test target. This harness is needed by
/// `TaskNotesKitTests` (the engine against a real server) *and* by
/// `TaskNotesMacTests` (``AppEnvironment`` at launch against a real server),
/// and the second of those is the whole point: the launch path is the one that
/// shipped broken. `TaskNotesTestSupport` is a plain library target so both can
/// depend on it, and it is deliberately absent from `products:` so nothing
/// outside this package can link a subprocess-spawning test harness.
///
/// ## Sandboxing
///
/// This spawns a subprocess, which the app's `app-sandbox` entitlement would
/// forbid. It works because `swift test` builds a **plain executable**, not the
/// `.app` — the entitlement is attached to the application bundle and nothing
/// else. An XCUITest driving the signed app could not do this; a `TaskNotesKit`
/// unit test can, which is one more reason the no-UI-imports rule earns its
/// keep.
public final class TaskNotesServerProcess {
    /// The vault the server is serving.
    public let vault: URL

    /// Where the server is listening.
    public let baseURL: URL

    /// The bearer token this server demands, or `""` when it demands none.
    ///
    /// Exposed so a test configures its client from the same value the server
    /// was started with. Two spellings of one secret is a test that fails for a
    /// reason it is not about.
    public let authToken: String

    private let process: Process
    // A Pipe can keep Process.waitUntilExit() blocked after the child exits if
    // nobody drains it. A file preserves startup diagnostics without coupling
    // server shutdown to a reader.
    private let output: FileHandle
    private let outputURL: URL

    /// Start a server, or report why it could not be started.
    ///
    /// Failure is a thrown `ServerUnavailable` rather than a silent skip. A
    /// test that quietly downgrades to "nothing to check" when its dependency
    /// is missing is a test that reports success forever.
    ///
    /// - Parameter authToken: the bearer token the server will require. The
    ///   default of `""` is the server's own spelling of "no gate", and it is
    ///   what every pre-existing test runs against.
    /// - Throws: ``ServerUnavailable`` when the server cannot be started, does
    ///   not answer in time, or comes up with a different auth gate than the one
    ///   asked for.
    public init(authToken: String = "") throws {
        self.authToken = authToken
        vault = FileManager.default.temporaryDirectory
            .appending(path: "tasknotes-e2e-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        outputURL = vault.appending(path: "server.log")
        guard
            FileManager.default.createFile(
                atPath: outputURL.path(percentEncoded: false),
                contents: nil
            )
        else {
            throw ServerUnavailable(reason: "could not create the server log")
        }
        do {
            output = try FileHandle(forWritingTo: outputURL)
        } catch {
            throw ServerUnavailable(reason: "could not open the server log: \(error)")
        }

        let port = try Self.reserveEphemeralPort()
        guard let url = URL(string: "http://127.0.0.1:\(port)") else {
            throw ServerUnavailable(reason: "could not build a base URL for port \(port)")
        }
        baseURL = url

        let bun = try Self.locateBun()
        process = Process()
        process.executableURL = bun
        process.arguments = ["run", "src/index.ts"]
        process.currentDirectoryURL = Self.serverPackage
        var environment = ProcessInfo.processInfo.environment
        environment["VAULT_PATH"] = vault.path(percentEncoded: false)
        environment["PORT"] = String(port)
        environment["AUTH_TOKEN"] = authToken
        // The server imports `./sentry.ts` at module scope; without a DSN it is
        // inert, but the variable is pinned empty so a developer's own DSN in
        // the ambient environment cannot make a test emit events.
        environment["SENTRY_DSN"] = ""
        process.environment = environment

        process.standardOutput = output
        process.standardError = output

        do {
            try process.run()
        } catch {
            throw ServerUnavailable(reason: "could not run \(bun.path): \(error)")
        }

        try waitUntilHealthy()
    }

    deinit {
        if process.isRunning {
            process.terminate()
        }
        _ = Result { try output.close() }
        // Best-effort, and explicitly so. `deinit` cannot propagate, `try?` is
        // banned repository-wide for hiding the error, and a leftover
        // directory under `/tmp` is not a test failure — `Result` makes the
        // discard visible instead of silent.
        _ = Result { try FileManager.default.removeItem(at: vault) }
    }

    /// Stop the server and drop its vault.
    public func stop() {
        if process.isRunning {
            process.terminate()
            process.waitUntilExit()
        }
        _ = Result { try output.close() }
    }

    /// Everything the server has written to stdout and stderr so far.
    ///
    /// Read on failure, so a timeout reports what the server said rather than
    /// just that it never answered.
    public func log() -> String {
        _ = Result { try output.synchronize() }
        switch Result(catching: { try Data(contentsOf: outputURL) }) {
        case .success(let data):
            return String(bytes: data, encoding: .utf8) ?? "<non-UTF-8 server output>"
        case .failure(let error):
            return "<unreadable server output: \(error)>"
        }
    }

    // ── The vault, as a user would see it ──────────────────────────────────

    /// Every markdown file in the vault, vault-relative, sorted.
    ///
    /// Sorted only for assertion stability — the vault has no inherent order,
    /// unlike the task list, whose order is the user's and is never re-sorted
    /// anywhere in this package.
    public func markdownFiles() throws -> [String] {
        let root = vault.path(percentEncoded: false)
        guard let walk = FileManager.default.enumerator(atPath: root) else { return [] }
        var found: [String] = []
        for case let entry as String in walk where entry.hasSuffix(".md") {
            found.append(entry)
        }
        return found.sorted()
    }

    /// The bytes of one vault file, decoded as UTF-8.
    public func contents(of relativePath: String) throws -> String {
        let url = vault.appending(path: relativePath)
        let data = try Data(contentsOf: url)
        // Force-unwrapped deliberately: `Tests/.swiftlint.yml` relaxes
        // `force_unwrapping` because in a test a trap *is* the assertion. A
        // vault file the server wrote and that is not UTF-8 is a real failure
        // and should stop the suite here, not decode to replacement characters
        // and fail an unrelated `contains` check three lines later.
        return String(bytes: data, encoding: .utf8)!
    }

    // ── Startup ────────────────────────────────────────────────────────────

    private func waitUntilHealthy() throws {
        let deadline = Date().addingTimeInterval(Self.startupTimeout)
        while Date() < deadline {
            if !process.isRunning {
                throw ServerUnavailable(reason: "the server exited during startup:\n\(log())")
            }
            if let report = health() {
                try verifyGate(report)
                return
            }
            Thread.sleep(forTimeInterval: 0.1)
        }
        stop()
        throw ServerUnavailable(
            reason:
                "the server did not answer /api/health within \(Self.startupTimeout)s:\n\(log())"
        )
    }

    /// Assert that the gate the caller asked for is the gate the server put up.
    ///
    /// ⚠️ **Without this, an auth test can pass for the wrong reason.** The gate
    /// is switched on by an environment variable, and a typo in its name starts
    /// an *open* server — against which "the right token works" is true, "the
    /// wrong token is rejected" is false, and only the second one fails. Worse,
    /// the positive test would then be proving nothing at all.
    ///
    /// `/api/health` is the one route the middleware lets through unauthenticated,
    /// and it reports whether *this* request was authenticated. This probe sends
    /// no `Authorization` header, so `authenticated` is true exactly when the
    /// server is running open — which must be true exactly when no token was
    /// configured.
    private func verifyGate(_ report: HealthReport) throws {
        let openServer = report.authenticated
        let wantedOpen = authToken.isEmpty
        guard openServer == wantedOpen else {
            stop()
            throw ServerUnavailable(
                reason: """
                    the server's auth gate is not what was asked for: started with \
                    AUTH_TOKEN=\(wantedOpen ? "\"\"" : "<a token>") but an unauthenticated \
                    /api/health reported authenticated=\(report.authenticated), which means \
                    the server is running \(openServer ? "open" : "gated").
                    """
            )
        }
    }

    /// One `/api/health` probe, sent with no credentials.
    ///
    /// `nil` means "no usable answer yet" — the server is still starting, or it
    /// answered something that is not the health envelope. Both are retried
    /// until the deadline, at which point the server's own output is reported.
    private func health() -> HealthReport? {
        guard let url = URL(string: "/api/health", relativeTo: baseURL) else { return nil }
        var request = URLRequest(url: url.absoluteURL)
        request.timeoutInterval = 1

        let slot = Mutex<HealthReport?>(nil)
        let finished = DispatchSemaphore(value: 0)
        let task = URLSession.shared.dataTask(with: request) { data, response, _ in
            slot.withLock { value in
                value = Self.report(data: data, response: response)
            }
            finished.signal()
        }
        task.resume()
        _ = finished.wait(timeout: .now() + 2)
        return slot.withLock { $0 }
    }

    private static func report(data: Data?, response: URLResponse?) -> HealthReport? {
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, let data else {
            return nil
        }
        let decoded = Result {
            try JSONDecoder().decode(HealthEnvelope.self, from: data)
        }
        guard case .success(let envelope) = decoded else { return nil }
        return HealthReport(authenticated: envelope.data.authenticated)
    }

    /// What an unauthenticated `/api/health` said.
    private struct HealthReport {
        /// Whether the server considered *that* request authenticated.
        let authenticated: Bool
    }

    /// The server's response envelope. Every JSON body without a `success`
    /// field is wrapped by `middleware/envelope.ts`, and the health body is one.
    private struct HealthEnvelope: Decodable {
        let data: Health
    }

    private struct Health: Decodable {
        let status: String
        let authenticated: Bool
    }

    // ── Locating things ────────────────────────────────────────────────────

    private static let startupTimeout: TimeInterval = 45

    /// `packages/tasknotes-server`, derived from this file's own location.
    ///
    /// `#filePath` rather than a working-directory guess: a test bundle's
    /// working directory depends on how it was launched, and a relative path
    /// that resolves under `swift test` but not under `xcodebuild` is a failure
    /// that only appears in the other build system.
    ///
    /// ⚠️ The component count is tied to where this file sits. It moved from
    /// `Tests/TaskNotesKitTests/Support/` to `Tests/Support/` when this target
    /// was split out, which is one level shallower.
    private static let serverPackage: URL = {
        URL(fileURLWithPath: #filePath)  // .../Tests/Support/<this>
            .deletingLastPathComponent()  // Support
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // tasknotes-macos
            .deletingLastPathComponent()  // packages
            .appending(path: "tasknotes-server")
    }()

    /// Where `bun` is, resolved through `PATH`.
    ///
    /// `mise` puts a shim on `PATH` rather than a fixed prefix, so hard-coding
    /// `/opt/homebrew/bin/bun` would work on one machine and not the next.
    private static func locateBun() throws -> URL {
        let path = ProcessInfo.processInfo.environment["PATH"] ?? ""
        for directory in path.split(separator: ":") {
            let candidate = URL(fileURLWithPath: String(directory)).appending(path: "bun")
            if FileManager.default.isExecutableFile(atPath: candidate.path(percentEncoded: false)) {
                return candidate
            }
        }
        throw ServerUnavailable(reason: "bun is not on PATH")
    }

    /// An address with nothing behind it.
    ///
    /// The kernel hands out a port and it is released immediately, so a
    /// connection to it is refused rather than timing out. That is what a test
    /// about *reaching* for the network wants: the failure arrives in
    /// milliseconds and is unambiguous, where an unroutable address would spend
    /// the request timeout getting there.
    public static func unreachableBaseURL() throws -> URL {
        let port = try reserveEphemeralPort()
        guard let url = URL(string: "http://127.0.0.1:\(port)") else {
            throw ServerUnavailable(reason: "could not build a base URL for port \(port)")
        }
        return url
    }

    /// Ask the kernel for a free TCP port, then release it.
    ///
    /// `NWListener` rather than `socket`/`bind`/`getsockname`, and the reason is
    /// the repository's posture rather than taste: the BSD-socket spelling needs
    /// `withUnsafePointer` and `withMemoryRebound` on a `sockaddr_in`, which
    /// `SWIFT_STRICT_MEMORY_SAFETY` reports as four "expression uses unsafe
    /// constructs" errors. Marking them `unsafe` would compile; using an API
    /// that is not unsafe in the first place is better.
    ///
    /// There is an unavoidable race between releasing the port and the server
    /// binding it, but it is far smaller than the race in picking a random
    /// number and hoping — and unlike a fixed port it cannot collide with a
    /// second copy of the suite running at the same time.
    public static func reserveEphemeralPort() throws -> Int {
        let listener = try NWListener(using: .tcp, on: .any)
        let assigned = Mutex<UInt16?>(nil)
        let settled = DispatchSemaphore(value: 0)

        // Required, not optional: an `NWListener` with no connection handler
        // fails on start rather than becoming ready. Nothing will connect in
        // the moment this listener is alive, but the handler must exist.
        listener.newConnectionHandler = { connection in
            connection.cancel()
        }

        listener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                assigned.withLock { port in
                    port = listener.port?.rawValue
                }
                settled.signal()
            case .failed, .cancelled:
                settled.signal()
            case .setup, .waiting:
                break
            @unknown default:
                break
            }
        }
        listener.start(queue: .global())
        _ = settled.wait(timeout: .now() + 5)
        listener.cancel()

        guard let port = assigned.withLock({ $0 }), port != 0 else {
            throw ServerUnavailable(reason: "could not reserve an ephemeral port")
        }
        return Int(port)
    }
}

/// Why a real server could not be started.
///
/// A thrown error rather than a `withKnownIssue` or an early `return`: a test
/// whose dependency is missing has to fail, not pass quietly.
public struct ServerUnavailable: Error, CustomStringConvertible {
    public let reason: String

    public init(reason: String) {
        self.reason = reason
    }

    public var description: String { "tasknotes-server unavailable: \(reason)" }
}
