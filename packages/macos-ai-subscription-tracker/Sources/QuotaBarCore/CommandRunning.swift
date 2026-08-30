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
    try await Task.detached {
      let process = Process()
      let output = Pipe()
      process.executableURL = executableURL
      process.arguments = arguments
      process.standardOutput = output
      process.standardError = FileHandle.nullDevice
      do {
        try process.run()
        process.waitUntilExit()
      } catch {
        throw QuotaError.commandFailed("agy")
      }
      return CommandResult(
        stdout: output.fileHandleForReading.readDataToEndOfFile(),
        terminationStatus: process.terminationStatus
      )
    }.value
  }
}
