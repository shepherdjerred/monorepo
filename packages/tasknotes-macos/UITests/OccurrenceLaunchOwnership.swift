import AppKit
import Darwin
import Foundation
import TaskNotesKit
import XCTest

/// Every authority is captured after that exact isolated app launch, before UI work.
@MainActor
final class OccurrenceLaunchOwnership {
    let appURL: URL
    private let runID: String
    private let descriptor: String
    private let destination: URL
    private let executable: String
    private var launches: [Launch] = []

    init(runID: UUID, descriptor: String, state: URL) throws {
        self.runID = runID.uuidString.lowercased()
        self.descriptor = descriptor
        destination = state.appendingPathComponent("occurrence-launches.json")
        let package = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent()
        appURL = package.appendingPathComponent(
            ".build/occurrence-acceptance/\(self.runID)/macos/Build/Products/Debug/FacetAcceptance.app"
        )
        executable = appURL.appendingPathComponent("Contents/MacOS/FacetAcceptance").path
        guard appURL.resolvingSymlinksInPath() == appURL,
            !FileManager.default.fileExists(atPath: destination.path)
        else { throw OwnershipError.binding }
        try persist()
    }

    func launch(_ app: XCUIApplication) throws {
        guard launches.last?.state != "running",
            NSRunningApplication.runningApplications(
                withBundleIdentifier: "red.sjer.tasknotes.mac.acceptance"
            ).allSatisfy(\.isTerminated)
        else { throw OwnershipError.foreignProcess }
        app.launch()
        let pid = try MacAcceptanceCapture.ownedProcessID(app: app)
        let identity = try inspect(pid)
        guard let identity else { throw OwnershipError.missingProcess }
        launches.append(Launch(pid: pid, identity: identity, state: "running"))
        try persist()
    }

    func terminate() throws {
        guard var captured = launches.last, captured.state == "running" else { return }
        if let current = try inspect(captured.pid) {
            guard current == captured.identity, try inspect(captured.pid) == captured.identity
            else {
                throw OwnershipError.foreignProcess
            }
            guard Darwin.kill(captured.pid, SIGTERM) == 0 else { throw OwnershipError.signal }
            let deadline = Date().addingTimeInterval(10)
            while let remaining = try inspect(captured.pid) {
                guard remaining == captured.identity else { throw OwnershipError.foreignProcess }
                guard Date() < deadline else { throw OwnershipError.deadline }
                RunLoop.current.run(until: Date().addingTimeInterval(0.05))
            }
        }
        captured.state = "closed"
        launches[launches.count - 1] = captured
        try persist()
    }

    private func inspect(_ pid: pid_t) throws -> Identity? {
        var info = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.size)
        guard unsafe proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else {
            if Darwin.kill(pid, 0) == -1, errno == ESRCH { return nil }
            throw OwnershipError.inspection
        }
        var buffer = [CChar](repeating: 0, count: 4096)
        guard info.pbi_pid == UInt32(pid), info.pbi_uid == geteuid(), info.pbi_ruid == getuid(),
            unsafe proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0,
            String(bytes: buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, encoding: .utf8)
                == executable,
            info.pbi_start_tvsec > 0, info.pbi_start_tvusec < 1_000_000
        else { throw OwnershipError.foreignProcess }
        return Identity(
            uid: UInt64(info.pbi_uid), ruid: UInt64(info.pbi_ruid),
            startSeconds: info.pbi_start_tvsec, startMicroseconds: info.pbi_start_tvusec)
    }

    private func persist() throws {
        let proof = Journal(
            schemaVersion: 1, runID: runID, descriptor: descriptor,
            executable: executable, launches: launches)
        let bytes = try JSONEncoder().encode(proof)
        let schema = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent(
                "scripts/apple-acceptance/occurrence-launches.schema.json")
        try FacetSchema(data: Data(contentsOf: schema)).validate(data: bytes, definition: "journal")
        try bytes.write(to: destination, options: .atomic)
    }

    private struct Identity: Codable, Equatable {
        let uid: UInt64
        let ruid: UInt64
        let startSeconds: UInt64
        let startMicroseconds: UInt64
    }
    private struct Launch: Codable {
        let pid: pid_t
        let identity: Identity
        var state: String
    }
    private struct Journal: Encodable {
        let schemaVersion: Int
        let runID: String
        let descriptor: String
        let executable: String
        let launches: [Launch]
    }
    private enum OwnershipError: Error {
        case binding, foreignProcess, missingProcess, signal, deadline, inspection
    }
}
