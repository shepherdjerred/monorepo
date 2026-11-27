import Darwin
import Foundation
import QuotaBarCore

@main
struct BrimCollectorCLI {
  static func main() async {
    let usage = "Usage: brim-collector <https-base-url>"
    let arguments = Array(CommandLine.arguments.dropFirst())
    if arguments == ["--help"] {
      print(usage)
      return
    }
    guard arguments.count == 1, let baseURL = arguments.first else {
      FileHandle.standardError.write(Data("\(usage)\n".utf8))
      exit(64)
    }
    let variable = "BRIM_MACBOOK_PUBLISH_TOKEN"
    let token = ProcessInfo.processInfo.environment[variable] ?? ""
    // Provider CLI child processes do not need the publish credential.
    unsetenv(variable)
    do {
      try await BrimCollector.run(baseURL: baseURL, token: token)
    } catch {
      FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
      exit(1)
    }
  }
}
