public import Foundation

public struct CommandResult: Equatable, Sendable {
  public let stdout: Data
  public let terminationStatus: Int32

  public init(stdout: Data, terminationStatus: Int32) {
    self.stdout = stdout
    self.terminationStatus = terminationStatus
  }
}

public protocol CommandRunning: Sendable {
  func run(executableURL: URL, arguments: [String]) async throws -> CommandResult
}

public struct FoundationCommandRunner: CommandRunning, Sendable {
  public init() {}

  public func run(executableURL: URL, arguments: [String]) async throws -> CommandResult {
    let control = ProcessControl()
    control.process.executableURL = executableURL
    control.process.arguments = arguments
    control.process.standardOutput = control.output
    control.process.standardError = FileHandle.nullDevice

    return try await withTaskCancellationHandler {
      try await Task.detached {
        guard !control.isCancelled else { throw CancellationError() }
        do {
          try control.process.run()
          if control.isCancelled { control.process.terminate() }
          control.process.waitUntilExit()
        } catch is CancellationError {
          throw CancellationError()
        } catch {
          throw QuotaError.commandFailed("agy")
        }
        if control.isCancelled { throw CancellationError() }
        return CommandResult(
          stdout: control.output.fileHandleForReading.readDataToEndOfFile(),
          terminationStatus: control.process.terminationStatus
        )
      }.value
    } onCancel: {
      control.cancel()
    }
  }
}

/// Runs a short-lived command and blocks until it exits.
///
/// The credential stores read files, SQLite databases, and the keychain synchronously on the
/// polling task, so a credential helper that spawns a process belongs on the same blocking path
/// rather than forcing the whole `CredentialStore` API to become asynchronous.
public protocol SynchronousCommandRunning: Sendable {
  func run(executableURL: URL, arguments: [String]) throws -> CommandResult
}

public struct FoundationSynchronousCommandRunner: SynchronousCommandRunning, Sendable {
  public init() {}

  public func run(executableURL: URL, arguments: [String]) throws -> CommandResult {
    let process = Process()
    let output = Pipe()
    process.executableURL = executableURL
    process.arguments = arguments
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    process.standardInput = FileHandle.nullDevice
    do {
      try process.run()
    } catch {
      throw QuotaError.commandFailed(executableURL.lastPathComponent)
    }
    // Drain the pipe before waiting: a command whose output exceeds the pipe buffer blocks on
    // write, and waiting first would deadlock against it.
    let stdout = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return CommandResult(stdout: stdout, terminationStatus: process.terminationStatus)
  }
}

private final class ProcessControl: @unchecked Sendable {
  let process = Process()
  let output = Pipe()
  private let lock = NSLock()
  private var cancelled = false

  var isCancelled: Bool {
    lock.lock()
    defer { lock.unlock() }
    return cancelled
  }

  func cancel() {
    lock.lock()
    cancelled = true
    let running = process.isRunning
    lock.unlock()
    if running { process.terminate() }
  }
}
