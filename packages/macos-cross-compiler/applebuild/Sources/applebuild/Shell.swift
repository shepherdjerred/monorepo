import Foundation

struct BuildError: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}

/// Run a tool to completion, streaming its output; throw on a non-zero exit.
func run(_ executable: String, _ arguments: [String], in directory: URL? = nil) throws {
  log("$ \(([executable] + arguments).map(shellQuoted).joined(separator: " "))")
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
  process.arguments = [executable] + arguments
  if let directory { process.currentDirectoryURL = directory }
  try process.run()
  process.waitUntilExit()
  guard process.terminationStatus == 0 else {
    throw BuildError("\(executable) exited with status \(process.terminationStatus)")
  }
}

/// Run a tool and return its standard output.
func capture(_ executable: String, _ arguments: [String], in directory: URL? = nil) throws -> String {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
  process.arguments = [executable] + arguments
  if let directory { process.currentDirectoryURL = directory }
  let output = Pipe()
  process.standardOutput = output
  try process.run()
  let data = output.fileHandleForReading.readDataToEndOfFile()
  process.waitUntilExit()
  guard process.terminationStatus == 0 else {
    throw BuildError("\(executable) \(arguments.joined(separator: " ")) exited with status \(process.terminationStatus)")
  }
  return String(decoding: data, as: UTF8.self)
}

func log(_ message: String) {
  FileHandle.standardError.write(Data("\(message)\n".utf8))
}

private func shellQuoted(_ argument: String) -> String {
  argument.allSatisfy { $0.isLetter || $0.isNumber || "-_./=:@,+".contains($0) }
    ? argument : "'\(argument.replacingOccurrences(of: "'", with: "'\\''"))'"
}

extension FileManager {
  func recreateDirectory(_ url: URL) throws {
    if fileExists(atPath: url.path) { try removeItem(at: url) }
    try createDirectory(at: url, withIntermediateDirectories: true)
  }

  func copyReplacing(_ source: URL, to destination: URL) throws {
    if fileExists(atPath: destination.path) { try removeItem(at: destination) }
    try createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    try copyItem(at: source, to: destination)
  }

  func isDirectory(_ url: URL) -> Bool {
    var isDirectory: ObjCBool = false
    return fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
  }
}
