internal import Dispatch
internal import Foundation

/// Test-owned child completion retained independently of the caller's run loop.
/// Install before `run()` so an early exit cannot precede observation.
final class TaskNotesProcessTermination {
    private let process: Process
    private let completion = DispatchGroup()

    init(process: Process) {
        self.process = process
        completion.enter()
        let observedCompletion = completion
        process.terminationHandler = { _ in observedCompletion.leave() }
    }

    func stop(timeout: DispatchTimeInterval = .seconds(10)) throws {
        if process.isRunning {
            process.terminate()
        }
        try waitForExit(timeout: timeout)
    }

    func waitForExit(timeout: DispatchTimeInterval) throws {
        guard completion.wait(timeout: .now() + timeout) == .success else {
            throw ServerUnavailable(
                reason: "owned child termination was not observed before the deadline")
        }
    }
}
