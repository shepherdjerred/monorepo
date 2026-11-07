import Darwin
import Dispatch
public import Foundation

/// Bounds only the newly spawned child. Signals require its original kernel
/// lifetime, parent and user identities; process groups are never addressed.
public final class FacetFixtureChildTermination {
    private struct Identity: Equatable {
        let parent: UInt32
        let user: UInt32
        let realUser: UInt32
        let seconds: UInt64
        let microseconds: UInt64
    }
    private let process: Process
    private let completion: TaskNotesProcessTermination
    private var identity: Identity?

    public init(process: Process) {
        self.process = process
        completion = TaskNotesProcessTermination(process: process)
    }

    public func bindStartedChild() throws {
        guard identity == nil, process.isRunning else {
            throw ServerUnavailable(reason: "Fixture child did not start")
        }
        identity = try inspect()
    }

    @discardableResult public func stop() throws -> Bool {
        let deadline = DispatchTime.now() + .seconds(10)
        guard process.isRunning else {
            try completion.waitForExit(timeout: .seconds(1))
            return false
        }
        try requireOriginalChild()
        process.terminate()
        let grace = Result { try completion.waitForExit(timeout: .seconds(2)) }
        if case .success = grace { return false }
        if process.isRunning {
            try requireOriginalChild()
            guard Darwin.kill(process.processIdentifier, SIGKILL) == 0 else {
                throw ServerUnavailable(reason: "Owned fixture child force-stop failed")
            }
        }
        let remaining =
            deadline.uptimeNanoseconds
            - min(deadline.uptimeNanoseconds, DispatchTime.now().uptimeNanoseconds)
        guard let nanoseconds = Int(exactly: remaining), nanoseconds > 0 else {
            throw ServerUnavailable(reason: "Owned fixture child stop deadline expired")
        }
        try completion.waitForExit(timeout: .nanoseconds(nanoseconds))
        return true
    }

    private func requireOriginalChild() throws {
        guard let identity, try inspect() == identity else {
            throw ServerUnavailable(reason: "Fixture child lifetime changed")
        }
    }

    private func inspect() throws -> Identity {
        let pid = process.processIdentifier
        var information = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.size)
        // The fixed-size initialized value remains alive throughout the C call.
        guard pid > 0, unsafe proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &information, size) == size,
            information.pbi_pid == UInt32(pid), information.pbi_ppid == UInt32(getpid()),
            information.pbi_uid == geteuid(), information.pbi_ruid == getuid(),
            information.pbi_start_tvsec > 0, information.pbi_start_tvusec < 1_000_000
        else { throw ServerUnavailable(reason: "Fixture child ownership is unproven") }
        return Identity(
            parent: information.pbi_ppid, user: information.pbi_uid,
            realUser: information.pbi_ruid, seconds: information.pbi_start_tvsec,
            microseconds: information.pbi_start_tvusec)
    }
}
