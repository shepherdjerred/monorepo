import Foundation
import Network
import Synchronization
import Testing

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
/// ## Sandboxing
///
/// This spawns a subprocess, which the app's `app-sandbox` entitlement would
/// forbid. It works because `swift test` builds a **plain executable**, not the
/// `.app` — the entitlement is attached to the application bundle and nothing
/// else. An XCUITest driving the signed app could not do this; a `TaskNotesKit`
/// unit test can, which is one more reason the no-UI-imports rule earns its
/// keep.
final class TaskNotesServerProcess {
    /// The vault the server is serving.
    let vault: URL

    /// Where the server is listening.
    let baseURL: URL

    private let process: Process
    private let output: Pipe

    /// Start a server, or report why it could not be started.
    ///
    /// Failure is a thrown `ServerUnavailable` rather than a silent skip. A
    /// test that quietly downgrades to "nothing to check" when its dependency
    /// is missing is a test that reports success forever.
    init() throws {
        vault = FileManager.default.temporaryDirectory
            .appending(path: "tasknotes-e2e-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)

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
        environment["AUTH_TOKEN"] = ""
        // The server imports `./sentry.ts` at module scope; without a DSN it is
        // inert, but the variable is pinned empty so a developer's own DSN in
        // the ambient environment cannot make a test emit events.
        environment["SENTRY_DSN"] = ""
        process.environment = environment

        output = Pipe()
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
        // Best-effort, and explicitly so. `deinit` cannot propagate, `try?` is
        // banned repository-wide for hiding the error, and a leftover
        // directory under `/tmp` is not a test failure — `Result` makes the
        // discard visible instead of silent.
        _ = Result { try FileManager.default.removeItem(at: vault) }
    }

    /// Stop the server and drop its vault.
    func stop() {
        if process.isRunning {
            process.terminate()
            process.waitUntilExit()
        }
    }

    /// Everything the server has written to stdout and stderr so far.
    ///
    /// Read on failure, so a timeout reports what the server said rather than
    /// just that it never answered.
    func log() -> String {
        let data = output.fileHandleForReading.availableData
        return String(bytes: data, encoding: .utf8) ?? "<non-UTF-8 server output>"
    }

    // ── The vault, as a user would see it ──────────────────────────────────

    /// Every markdown file in the vault, vault-relative, sorted.
    ///
    /// Sorted only for assertion stability — the vault has no inherent order,
    /// unlike the task list, whose order is the user's and is never re-sorted
    /// anywhere in this package.
    func markdownFiles() throws -> [String] {
        let root = vault.path(percentEncoded: false)
        guard let walk = FileManager.default.enumerator(atPath: root) else { return [] }
        var found: [String] = []
        for case let entry as String in walk where entry.hasSuffix(".md") {
            found.append(entry)
        }
        return found.sorted()
    }

    /// The bytes of one vault file, decoded as UTF-8.
    func contents(of relativePath: String) throws -> String {
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
            if health() == 200 { return }
            Thread.sleep(forTimeInterval: 0.1)
        }
        stop()
        throw ServerUnavailable(
            reason:
                "the server did not answer /api/health within \(Self.startupTimeout)s:\n\(log())"
        )
    }

    private func health() -> Int {
        guard let url = URL(string: "/api/health", relativeTo: baseURL) else { return -1 }
        var request = URLRequest(url: url.absoluteURL)
        request.timeoutInterval = 1

        let status = Mutex<Int>(-1)
        let finished = DispatchSemaphore(value: 0)
        let task = URLSession.shared.dataTask(with: request) { _, response, _ in
            status.withLock { value in
                value = (response as? HTTPURLResponse)?.statusCode ?? -1
            }
            finished.signal()
        }
        task.resume()
        _ = finished.wait(timeout: .now() + 2)
        return status.withLock { $0 }
    }

    // ── Locating things ────────────────────────────────────────────────────

    private static let startupTimeout: TimeInterval = 45

    /// `packages/tasknotes-server`, derived from this file's own location.
    ///
    /// `#filePath` rather than a working-directory guess: a test bundle's
    /// working directory depends on how it was launched, and a relative path
    /// that resolves under `swift test` but not under `xcodebuild` is a failure
    /// that only appears in the other build system.
    private static let serverPackage: URL = {
        URL(fileURLWithPath: #filePath)  // .../Tests/TaskNotesKitTests/Support/<this>
            .deletingLastPathComponent()  // Support
            .deletingLastPathComponent()  // TaskNotesKitTests
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
    private static func reserveEphemeralPort() throws -> Int {
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
struct ServerUnavailable: Error, CustomStringConvertible {
    let reason: String

    var description: String { "tasknotes-server unavailable: \(reason)" }
}
