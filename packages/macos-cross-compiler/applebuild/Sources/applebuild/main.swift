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
  guard let targetName = try value("--target") else { throw BuildError(usage) }
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
  let target = try AppTarget(
    spec: spec, name: targetName, platform: platform, configuration: configuration, overrides: overrides)
  let toolchain = Toolchain()

  /// One target compiled for every architecture: its universal binary and
  /// package products, and per architecture what a hosted test bundle needs.
  struct Compiled {
    let binary: URL
    let frameworks: [PackageFramework]
    let resourceBundles: [URL]
    let hosts: [String: HostBuild]
  }

  func compile(_ target: AppTarget, hosts: [String: HostBuild] = [:]) throws -> Compiled {
    log("applebuild: \(target.name) \(configuration) for \(target.platform.rawValue) [\(target.architectures.joined(separator: ", "))]")
    let targetWork = work.appendingPathComponent(target.name)
    var binaries: [URL] = []
    var builds: [PackageBuild] = []
    var built: [String: HostBuild] = [:]
    for arch in target.architectures {
      let archWork = targetWork.appendingPathComponent("\(target.platform.rawValue)-\(arch)")
      try FileManager.default.createDirectory(at: archWork, withIntermediateDirectories: true)
      var host: HostBuild?
      if target.host != nil {
        guard let slice = hosts[arch] else { throw BuildError("the host application was not built for \(arch)") }
        host = slice
      }
      let packages = try buildPackages(for: target, arch: arch, work: targetWork, toolchain: toolchain)
      builds.append(packages)
      let binary = try compileApp(target, arch: arch, packages: packages, work: archWork, toolchain: toolchain, host: host)
      binaries.append(binary)
      built[arch] = HostBuild(executable: binary, modules: archWork.appendingPathComponent("Modules"))
    }

    /// One binary from the per-architecture builds: `lipo` when there are several.
    func universal(_ binaries: [URL], named name: String) throws -> URL {
      guard binaries.count > 1 else { return binaries[0] }
      let merged = targetWork.appendingPathComponent("universal/\(name)")
      try FileManager.default.createDirectory(at: merged.deletingLastPathComponent(), withIntermediateDirectories: true)
      try run("lipo", ["-create"] + binaries.map(\.path) + ["-output", merged.path])
      return merged
    }
    var frameworks: [PackageFramework] = []
    for framework in builds[0].frameworks {
      let slices = try builds.map { build in
        guard let slice = build.frameworks.first(where: { $0.name == framework.name }) else {
          throw BuildError("framework \(framework.name) is missing from one architecture's package build")
        }
        return slice.binary
      }
      frameworks.append(
        PackageFramework(
          name: framework.name, binary: try universal(slices, named: framework.name),
          bundleIdentifier: framework.bundleIdentifier))
    }
    return Compiled(
      binary: try universal(binaries, named: binaries[0].lastPathComponent), frameworks: frameworks,
      resourceBundles: builds[0].resourceBundles, hosts: built)
  }

  try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
  let bundle: URL
  if let hostName = target.host {
    // A hosted test bundle: build the host, then the bundle against it, and
    // embed the bundle in the host's PlugIns as Xcode does.
    let host = try AppTarget(
      spec: spec, name: hostName, platform: target.platform, configuration: configuration, overrides: overrides)
    let hostBuild = try compile(host)
    let testBuild = try compile(target, hosts: hostBuild.hosts)
    let staging = work.appendingPathComponent("\(target.name)/bundle")
    try FileManager.default.recreateDirectory(staging)
    let xctest = try assembleBundle(
      target, executable: testBuild.binary, frameworks: testBuild.frameworks, resourceBundles: testBuild.resourceBundles,
      compiledAssets: nil, output: staging, toolchain: toolchain)
    let dsym = staging.appendingPathComponent("\(xctest.lastPathComponent).dSYM")
    if FileManager.default.fileExists(atPath: dsym.path) {
      try FileManager.default.copyReplacing(dsym, to: output.appendingPathComponent(dsym.lastPathComponent))
    }
    bundle = try assembleBundle(
      host, executable: hostBuild.binary, frameworks: hostBuild.frameworks, resourceBundles: hostBuild.resourceBundles,
      compiledAssets: compiledAssets, output: output, toolchain: toolchain, plugIns: [xctest])
  } else {
    let built = try compile(target)
    bundle = try assembleBundle(
      target, executable: built.binary, frameworks: built.frameworks, resourceBundles: built.resourceBundles,
      compiledAssets: compiledAssets, output: output, toolchain: toolchain)
  }
  log("applebuild: built \(bundle.path)")
} catch {
  log("applebuild: error: \(error)")
  exit(1)
}
