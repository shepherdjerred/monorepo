internal import Dispatch
public import Foundation
internal import Network
internal import Synchronization

/// Spawns an isolated `packages/tasknotes-server` HTTP instance (`DATABASE_URL=""` in-memory store)
/// on an ephemeral localhost port for end-to-end `/api/v1/sync` tests.
public final class TaskNotesServerProcess {
    /// Scratch directory holding server logs and working state.
    public let scratchDirectory: URL

    /// Where the server is listening.
    public let baseURL: URL

    /// The bearer token this server demands.
    ///
    /// Exposed so a test configures its client from the same value the server
    /// was started with. Two spellings of one secret is a test that fails for a
    /// reason it is not about.
    public let authToken: String

    private let process: Process
    private let termination: TaskNotesProcessTermination
    // A file preserves startup diagnostics without an output-reader lifetime.
    private let output: FileHandle
    private let outputURL: URL

    /// Start a server, or report why it could not be started.
    ///
    /// Failure is a thrown `ServerUnavailable` rather than a silent skip. A
    /// test that quietly downgrades to "nothing to check" when its dependency
    /// is missing is a test that reports success forever.
    ///
    /// - Parameter authToken: the bearer token the server will require. Each
    ///   server gets a unique token unless a test is explicitly exercising a
    ///   particular credential.
    /// - Throws: ``ServerUnavailable`` when the server cannot be started, does
    ///   not answer in time, or comes up with a different auth gate than the one
    ///   asked for.
    public init(authToken: String = UUID().uuidString) throws {
        self.authToken = authToken
        scratchDirectory = FileManager.default.temporaryDirectory
            .appending(path: "facet-server-e2e-\(UUID().uuidString)")
        try FileManager.default.createDirectory(
            at: scratchDirectory,
            withIntermediateDirectories: true
        )
        outputURL = scratchDirectory.appending(path: "server.log")
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
        termination = TaskNotesProcessTermination(process: process)
        process.executableURL = bun
        process.arguments = ["run", "src/index.ts"]
        process.currentDirectoryURL = Self.serverPackage
        let environment = Self.makeServerEnvironment(
            scratchPath: scratchDirectory.path(percentEncoded: false),
            port: port,
            authToken: authToken
        )
        process.environment = environment
        if let runID = environment["TASKNOTES_CI_RUN_ID"] {
            process.arguments?.append("--tasknotes-server-ci-run=\(runID)")
        }

        process.standardOutput = output
        process.standardError = output

        do {
            try process.run()
        } catch {
            throw ServerUnavailable(reason: "could not run \(bun.path): \(error)")
        }

        try waitUntilHealthy()
    }

    private static func makeServerEnvironment(
        scratchPath: String,
        port: Int,
        authToken: String
    ) -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        environment["VAULT_PATH"] = scratchPath
        environment["PORT"] = String(port)
        environment["AUTH_TOKEN"] = authToken
        environment["HOST"] = "127.0.0.1"
        environment["DATABASE_URL"] = ""
        environment["BUGSINK_DSN"] = ""
        return environment
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
        _ = Result { try FileManager.default.removeItem(at: scratchDirectory) }
    }

    /// Stop the server process cleanly.
    public func stop() {
        do {
            try termination.stop()
        } catch {
            preconditionFailure("tasknotes-server shutdown failed: \(error)")
        }
        _ = Result { try output.close() }
    }

    /// Everything the server has written to stdout and stderr so far.
    public func log() -> String {
        _ = Result { try output.synchronize() }
        switch Result(catching: { try Data(contentsOf: outputURL) }) {
        case .success(let data):
            return String(bytes: data, encoding: .utf8) ?? "<non-UTF-8 server output>"
        case .failure(let error):
            return "<unreadable server output: \(error)>"
        }
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
