import SwiftUI

/// Swift, called from Objective-C through the generated MixedApp-Swift.h.
@objc public final class Tally: NSObject {
  @objc public private(set) var count = 0
  @objc public func add(_ name: String) { count += name.count }
}

/// Every language's contribution, as one line.
func summary() -> String {
  let greeting = Greeter().greeting(for: "Linux")
  return "\(greeting) · C \(mixed_add(20, 22)) · C++ \(mixed_word_count("built on linux"))"
}

@main
struct MixedApp: App {
  init() {
    // `MixedApp --check` prints the summary and exits, for scripted runs.
    if CommandLine.arguments.contains("--check") {
      print(summary())
      exit(0)
    }
  }

  var body: some Scene {
    WindowGroup { Text(summary()).padding(40) }
  }
}
