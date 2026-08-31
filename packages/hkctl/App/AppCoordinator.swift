import Foundation
import HKCTLCore
import HomeKit

@MainActor
final class AppCoordinator: NSObject, HMHomeManagerDelegate {
  private let invocation: Invocation
  private var manager: HMHomeManager?
  private var timeoutTask: Task<Void, Never>?
  private var executionTask: Task<Void, Never>?
  private var hasStartedExecution = false
  private var hasFinished = false

  init(invocation: Invocation) {
    self.invocation = invocation
  }

  func start() {
    let manager = HMHomeManager()
    self.manager = manager
    manager.delegate = self
    timeoutTask = Task { @MainActor [weak self] in
      do {
        try await Task.sleep(for: .seconds(30))
      } catch {
        return
      }
      self?.finishError(
        HKCTLError.operationFailed(
          "Timed out waiting for HomeKit. Grant hkctl access in System Settings and retry."
        ),
        code: 3
      )
    }
  }

  func homeManagerDidUpdateHomes(_ manager: HMHomeManager) {
    guard !hasStartedExecution else { return }
    hasStartedExecution = true
    timeoutTask?.cancel()
    executionTask = Task { @MainActor [weak self] in
      await self?.execute(manager: manager)
    }
  }

  static func finishStartupFailure(
    error: any Error,
    outputPath: String,
    outputFormat: OutputFormat
  ) -> Never {
    let message = error.localizedDescription
    let output = Renderer.renderDiagnostic(error: message, code: 2, format: outputFormat)
    do {
      try Renderer.write(output, to: outputPath)
    } catch {
      writeStandardError("\(error.localizedDescription)\n")
    }
    writeStandardError(output)
    exit(2)
  }

  private func execute(manager: HMHomeManager) async {
    do {
      let prepared = try prepareInvocation()
      let gateway = HomeKitGateway(manager: manager)
      let outcome = try await CommandExecutor().execute(
        invocation: prepared.invocation,
        operations: prepared.operations,
        gateway: gateway
      )
      switch outcome {
      case let .success(report):
        try finish(report: report, invocation: prepared.invocation, exitCode: 0)
      case let .failure(report):
        try finish(report: report, invocation: prepared.invocation, exitCode: 1)
      }
    } catch {
      finishError(error, code: errorCode(for: error))
    }
  }

  private func prepareInvocation() throws -> (
    invocation: Invocation,
    operations: [HKCTLCore.Operation]
  ) {
    switch invocation.action {
    case .help, .version:
      throw HKCTLError.usage("Help and version requests must complete before app launch.")
    case .list:
      return (invocation, [])
    case let .operations(operations):
      return (invocation, operations)
    case let .batchFile(path):
      let data: Data
      do {
        data = try Data(contentsOf: URL(fileURLWithPath: path))
      } catch {
        throw HKCTLError.invalidBatch(
          "could not read '\(path)': \(error.localizedDescription)"
        )
      }
      let request = try BatchRequest.decode(data: data)
      let prepared = Invocation(
        action: .operations(request.operations),
        homeName: invocation.homeName ?? request.home,
        outputPath: invocation.outputPath,
        outputFormat: invocation.outputFormat,
        applyChanges: invocation.applyChanges
      )
      return (prepared, request.operations)
    }
  }

  private func finish(
    report: ExecutionReport,
    invocation: Invocation,
    exitCode: Int32
  ) throws -> Never {
    let output = try Renderer.render(report: report, format: invocation.outputFormat)
    try Renderer.write(output, to: invocation.outputPath)
    print(output, terminator: "")
    hasFinished = true
    exit(exitCode)
  }

  private func finishError(_ error: any Error, code: Int) -> Never {
    guard !hasFinished else { exit(Int32(code)) }
    hasFinished = true
    let message = error.localizedDescription
    let output = Renderer.renderDiagnostic(
      error: message,
      code: code,
      format: invocation.outputFormat
    )
    do {
      try Renderer.write(output, to: invocation.outputPath)
    } catch {
      writeStandardError("\(error.localizedDescription)\n")
    }
    writeStandardError(output)
    exit(Int32(code))
  }

  private func errorCode(for error: any Error) -> Int {
    guard let hkctlError = error as? HKCTLError else { return 1 }
    switch hkctlError {
    case .usage, .invalidBatch:
      return 2
    case .homeNotFound, .homeAmbiguous, .noPrimaryHome, .targetNotFound,
      .targetAmbiguous, .destinationConflict, .operationFailed, .outputFailed:
      return 1
    }
  }
}

private func writeStandardError(_ message: String) {
  FileHandle.standardError.write(Data(message.utf8))
}
