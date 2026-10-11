import Dispatch
import Foundation
import Testing

@testable import TaskNotesTestSupport

@Suite("Test server process termination")
struct TaskNotesProcessTerminationTests {
    @Test("an exit before teardown is retained and repeated stops return")
    func earlyExitIsRetained() throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/true")
        let termination = TaskNotesProcessTermination(process: process)
        try process.run()
        try termination.waitForExit(timeout: .seconds(5))
        #expect(!process.isRunning)
        try termination.stop(timeout: .milliseconds(100))
        try termination.stop(timeout: .milliseconds(100))
    }

    @Test("a running owned child is terminated without a caller run loop")
    func runningChildStops() throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sleep")
        process.arguments = ["60"]
        let termination = TaskNotesProcessTermination(process: process)
        try process.run()
        try termination.stop(timeout: .seconds(5))
        #expect(!process.isRunning)
        #expect(process.terminationReason == .uncaughtSignal)
    }

    @Test("an uncompleted child wait fails within its deadline")
    func completionTimeoutFails() throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sleep")
        process.arguments = ["60"]
        let termination = TaskNotesProcessTermination(process: process)
        try process.run()
        defer { try! termination.stop(timeout: .seconds(5)) }
        let start = ContinuousClock.now
        #expect(throws: ServerUnavailable.self) {
            try termination.waitForExit(timeout: .milliseconds(20))
        }
        #expect(ContinuousClock.now - start < .seconds(2))
        #expect(process.isRunning, "a wait timeout must not masquerade as child completion")
    }
}
