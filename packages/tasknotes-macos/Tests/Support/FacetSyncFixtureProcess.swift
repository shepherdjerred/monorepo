public import Foundation

/// A test-owned loopback server. Its public synthetic account never consults
/// a password manager, Keychain, real account API or a production vault.
public final class FacetSyncFixtureProcess {
    public struct Ready: Decodable, Sendable {
        public let schemaVersion: Int
        public let kind: String
        public let runID: String
        public let httpOrigin: URL
        public let webSocketURL: URL
        public let vaultID: String
        public let host: String
    }

    public let ready: Ready
    private let process: Process
    private let termination: FacetFixtureChildTermination
    private let output: FileHandle
    private let errors: FileHandle
    private let outputURL: URL
    private let errorsURL: URL
    private var stopped = false

    public init(directory: URL, runID: UUID) throws {
        let invocation = UUID().uuidString
        outputURL = directory.appendingPathComponent("stdout-\(invocation).log")
        errorsURL = directory.appendingPathComponent("stderr-\(invocation).log")
        for url in [outputURL, errorsURL] {
            try Data().write(to: url, options: .withoutOverwriting)
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o600], ofItemAtPath: url.path)
        }
        output = try FileHandle(forWritingTo: outputURL)
        errors = try FileHandle(forWritingTo: errorsURL)
        process = Process()
        termination = FacetFixtureChildTermination(process: process)
        process.executableURL = try Self.bun()
        process.arguments = [
            "--no-env-file", "run", Self.script.path, "--directory", directory.path,
            "--run-id", runID.uuidString.lowercased(),
        ]
        var environment: [String: String] = [:]
        for key in ["PATH", "HOME", "TMPDIR", "LANG", "USER", "LOGNAME", "DEVELOPER_DIR"] {
            environment[key] = ProcessInfo.processInfo.environment[key]
        }
        process.environment = environment
        process.currentDirectoryURL = Self.script.deletingLastPathComponent()
        process.standardOutput = output
        process.standardError = errors
        process.standardInput = FileHandle.nullDevice
        var launched = false
        do {
            try process.run()
            launched = true
            try termination.bindStartedChild()
            ready = try Self.waitForReady(
                process: process, output: outputURL, errors: errorsURL, runID: runID)
        } catch {
            if launched { try termination.stop() }
            try output.close()
            try errors.close()
            throw error
        }
    }

    deinit {
        if process.isRunning { process.terminate() }
        _ = Result { try output.close() }
        _ = Result { try errors.close() }
    }

    public func stop() throws {
        guard !stopped else { return }
        try termination.stop()
        stopped = true
        try output.close()
        try errors.close()
        guard process.terminationStatus == 0,
            try Self.boundedData(errorsURL).isEmpty,
            try Self.boundedData(outputURL).split(separator: 0x0A).count == 1
        else { throw ServerUnavailable(reason: "Sync fixture did not close cleanly") }
    }

    private static func waitForReady(
        process: Process, output: URL, errors: URL, runID: UUID
    ) throws -> Ready {
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            guard process.isRunning, try boundedData(errors).isEmpty else {
                throw ServerUnavailable(
                    reason: "Sync fixture failed during startup; diagnostics: \(errors.path)")
            }
            let bytes = try boundedData(output)
            if bytes.last == 0x0A {
                guard bytes.split(separator: 0x0A).count == 1,
                    let fields = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                    Set(fields.keys) == [
                        "schemaVersion", "kind", "runID", "httpOrigin", "webSocketURL", "vaultID",
                        "host",
                    ]
                else { throw ServerUnavailable(reason: "Sync fixture readiness is malformed") }
                let published = try JSONDecoder().decode(Ready.self, from: bytes)
                guard published.schemaVersion == 1, published.kind == "facet-sync-fixture",
                    published.runID == runID.uuidString.lowercased(),
                    published.vaultID == "fixture-vault-" + published.runID,
                    published.host == "sync-fixture.obsidian.md",
                    published.httpOrigin.scheme == "http", published.httpOrigin.host == "127.0.0.1",
                    let port = published.httpOrigin.port, (1...65_535).contains(port),
                    published.httpOrigin.user == nil, published.httpOrigin.password == nil,
                    published.httpOrigin.path.isEmpty || published.httpOrigin.path == "/",
                    published.httpOrigin.query == nil, published.httpOrigin.fragment == nil,
                    published.webSocketURL.absoluteString == "ws://127.0.0.1:\(port)/sync"
                else { throw ServerUnavailable(reason: "Sync fixture readiness is not bound") }
                return published
            }
            Thread.sleep(forTimeInterval: 0.02)
        }
        throw ServerUnavailable(reason: "Sync fixture readiness exceeded its deadline")
    }

    private static func boundedData(_ url: URL) throws -> Data {
        let values = try url.resourceValues(forKeys: [
            .fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey,
        ])
        guard values.isRegularFile == true, values.isSymbolicLink == false,
            let size = values.fileSize, size <= 65_536
        else { throw ServerUnavailable(reason: "Sync fixture diagnostics exceed their bound") }
        return try Data(contentsOf: url)
    }

    private static func bun() throws -> URL {
        for directory in (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":") {
            let candidate = URL(fileURLWithPath: String(directory)).appendingPathComponent("bun")
            if FileManager.default.isExecutableFile(atPath: candidate.path) { return candidate }
        }
        throw ServerUnavailable(reason: "Sync fixture requires the installed Bun runtime")
    }

    private static var script: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("tasks-for-obsidian/scripts/sync-fixture/run.ts")
    }
}
