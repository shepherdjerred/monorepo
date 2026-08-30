import Foundation
import HKCTLCore
import UIKit

@MainActor
private func bootstrap() -> Never {
  let arguments = Array(CommandLine.arguments.dropFirst())
  do {
    let invocation = try CLI.parse(arguments: arguments)
    switch invocation.action {
    case .help:
      writeBootstrapOutput(CLI.help, invocation: invocation, exitCode: 0)
    case .version:
      writeBootstrapOutput("hkctl \(CLI.version)\n", invocation: invocation, exitCode: 0)
    case .list, .operations, .batchFile:
      _ = UIApplicationMain(
        CommandLine.argc,
        CommandLine.unsafeArgv,
        nil,
        NSStringFromClass(AppDelegate.self)
      )
      exit(0)
    }
  } catch {
    let outputPath = CLI.requestedOutputPath(arguments: arguments)
    let message = error.localizedDescription
    let output = Renderer.renderDiagnostic(
      error: message,
      code: 2,
      format: CLI.requestedOutputFormat(arguments: arguments)
    )
    do {
      try Renderer.write(output, to: outputPath)
    } catch {
      writeStandardError("\(error.localizedDescription)\n")
    }
    writeStandardError(output)
    exit(2)
  }
}

@MainActor
private func writeBootstrapOutput(
  _ output: String,
  invocation: Invocation,
  exitCode: Int32
) -> Never {
  do {
    try Renderer.write(output, to: invocation.outputPath)
  } catch {
    writeStandardError("\(error.localizedDescription)\n")
    exit(1)
  }
  print(output, terminator: "")
  exit(exitCode)
}

private func writeStandardError(_ message: String) {
  FileHandle.standardError.write(Data(message.utf8))
}

bootstrap()
