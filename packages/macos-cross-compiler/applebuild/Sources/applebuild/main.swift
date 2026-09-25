import Foundation

let usage = """
  usage: applebuild <project.yml> --target <name> [--configuration Debug|Release]
                    [--platform macos|ios|maccatalyst] [--output <dir>] [--work <dir>]
                    [--compiled-assets <dir>] [--setting KEY=VALUE]...
  """

do {
  var arguments = Array(CommandLine.arguments.dropFirst())
  func value(_ flag: String) throws -> String? {
    guard let index = arguments.firstIndex(of: flag) else { return nil }
    guard index + 1 < arguments.count else { throw BuildError("\(flag) needs a value\n\(usage)") }
    let value = arguments[index + 1]
    arguments.removeSubrange(index...index + 1)
    return value
  }
  guard let target = try value("--target") else { throw BuildError(usage) }
  let configuration = try value("--configuration") ?? "Release"
  let platform = try value("--platform").map { name in
    guard let platform = Platform(rawValue: name) else { throw BuildError("unknown platform \(name)") }
    return platform
  }
  let output = URL(fileURLWithPath: try value("--output") ?? "out")
  let compiledAssets = try value("--compiled-assets").map { URL(fileURLWithPath: $0) }
  var overrides: [String: String] = [:]
  while let setting = try value("--setting") {
    let parts = setting.split(separator: "=", maxSplits: 1).map(String.init)
    guard parts.count == 2 else { throw BuildError("--setting expects KEY=VALUE, got \(setting)") }
    overrides[parts[0]] = parts[1]
  }
  let work = URL(fileURLWithPath: try value("--work") ?? output.appendingPathComponent(".work").path)
  guard arguments.count == 1 else { throw BuildError(usage) }

  let spec = try ProjectSpec(path: URL(fileURLWithPath: arguments[0]))
  let app = try AppTarget(
    spec: spec, name: target, platform: platform, configuration: configuration, overrides: overrides)
  let toolchain = Toolchain()
  log("applebuild: \(target) \(configuration) for \(app.platform.rawValue) [\(app.architectures.joined(separator: ", "))]")

  var executables: [URL] = []
  var builds: [PackageBuild] = []
  for arch in app.architectures {
    let archWork = work.appendingPathComponent("\(app.platform.rawValue)-\(arch)")
    try FileManager.default.createDirectory(at: archWork, withIntermediateDirectories: true)
    let built = try buildPackages(for: app, arch: arch, work: work, toolchain: toolchain)
    builds.append(built)
    executables.append(try compileApp(app, arch: arch, packages: built, work: archWork, toolchain: toolchain))
  }

  /// One binary from the per-architecture builds: `lipo` when there are several.
  func universal(_ binaries: [URL], named name: String) throws -> URL {
    guard binaries.count > 1 else { return binaries[0] }
    let merged = work.appendingPathComponent("universal/\(name)")
    try FileManager.default.createDirectory(at: merged.deletingLastPathComponent(), withIntermediateDirectories: true)
    try run("lipo", ["-create"] + binaries.map(\.path) + ["-output", merged.path])
    return merged
  }
  let executable = try universal(executables, named: executables[0].lastPathComponent)
  var frameworks: [PackageFramework] = []
  for framework in builds[0].frameworks {
    let slices = try builds.map { build in
      guard let slice = build.frameworks.first(where: { $0.name == framework.name }) else {
        throw BuildError("framework \(framework.name) is missing from one architecture's package build")
      }
      return slice.binary
    }
    frameworks.append(
      PackageFramework(name: framework.name, binary: try universal(slices, named: framework.name), bundleIdentifier: framework.bundleIdentifier))
  }
  try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
  let bundle = try assembleBundle(
    app, executable: executable, frameworks: frameworks, resourceBundles: builds[0].resourceBundles,
    compiledAssets: compiledAssets, output: output, toolchain: toolchain)
  log("applebuild: built \(bundle.path)")
} catch {
  log("applebuild: error: \(error)")
  exit(1)
}
