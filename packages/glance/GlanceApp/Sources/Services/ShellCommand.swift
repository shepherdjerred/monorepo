import Foundation

// MARK: - ShellError

/// Error from running a shell command.
enum ShellError: Error, CustomStringConvertible {
    case nonZeroExit(command: String, exitCode: Int32, stderr: String)
    case commandNotFound(String)
    case timeout(command: String)

    // MARK: Internal

    var description: String {
        switch self {
        case let .nonZeroExit(command, exitCode, stderr):
            "\(command) exited with code \(exitCode): \(stderr)"
        case let .commandNotFound(command):
            "\(command) not found"
        case let .timeout(command):
            "\(command) timed out"
        }
    }
}

/// Run a shell command asynchronously with a hard timeout.
/// Uses DispatchQueue to avoid blocking the Swift cooperative thread pool.
func shellCommand(
    _ command: String,
    arguments: [String],
    timeoutSeconds: Int = 20,
) async throws -> Data {
    try await withCheckedThrowingContinuation { continuation in
        DispatchQueue.global(qos: .userInitiated).async {
            executeProcess(
                command: command,
                arguments: arguments,
                timeoutSeconds: timeoutSeconds,
                continuation: continuation,
            )
        }
    }
}

/// Synchronously execute a process and resume the continuation with the result.
private func executeProcess(
    command: String,
    arguments: [String],
    timeoutSeconds: Int,
    continuation: CheckedContinuation<Data, any Error>,
) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = [command] + arguments

    // GUI apps don't inherit shell PATH -- set it explicitly
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    var env = ProcessInfo.processInfo.environment
    let pathValue = "/opt/homebrew/bin:/usr/local/bin"
        + ":/usr/bin:/bin:/usr/sbin:/sbin:\(home)/bin"
    env["PATH"] = pathValue
    env["HOME"] = home
    env["KUBECONFIG"] = "\(home)/.kube/config"
    env["TALOSCONFIG"] = "\(home)/.talos/config"
    process.environment = env

    let stdout = Pipe()
    let stderr = Pipe()
    process.standardOutput = stdout
    process.standardError = stderr
    process.standardInput = FileHandle.nullDevice

    do {
        try process.run()
    } catch {
        continuation.resume(throwing: ShellError.commandNotFound(command))
        return
    }

    // Hard timeout: kill the process if it takes too long
    let timer = DispatchSource.makeTimerSource(queue: .global())
    timer.schedule(deadline: .now() + .seconds(timeoutSeconds))
    timer.setEventHandler {
        if process.isRunning {
            process.terminate()
        }
    }
    timer.resume()

    // Read stdout BEFORE waitUntilExit to avoid pipe buffer deadlock.
    let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()

    process.waitUntilExit()
    timer.cancel()

    guard process.terminationStatus == 0 else {
        let errData = stderr.fileHandleForReading.readDataToEndOfFile()
        let errMsg = String(data: errData, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if process.terminationStatus == 15 {
            GlanceLogger.network.error(
                "\(command) killed after \(timeoutSeconds)s: \(errMsg)",
            )
            continuation.resume(
                throwing: ShellError.timeout(command: command),
            )
            return
        }
        let exitCode = process.terminationStatus
        GlanceLogger.network.error("\(command) failed (exit \(exitCode)): \(errMsg)")
        continuation.resume(throwing: ShellError.nonZeroExit(
            command: command,
            exitCode: exitCode,
            stderr: errMsg,
        ))
        return
    }

    continuation.resume(returning: stdoutData)
}
