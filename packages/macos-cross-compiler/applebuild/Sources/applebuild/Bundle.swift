import Foundation
import Yams

/// The Info.plist keys XcodeGen writes for an application before merging the
/// spec's `info.properties` over them.
private let xcodeGenInfoDefaults: [String: String] = [
  "CFBundleDevelopmentRegion": "$(DEVELOPMENT_LANGUAGE)",
  "CFBundleExecutable": "$(EXECUTABLE_NAME)",
  "CFBundleIdentifier": "$(PRODUCT_BUNDLE_IDENTIFIER)",
  "CFBundleInfoDictionaryVersion": "6.0",
  "CFBundleName": "$(PRODUCT_NAME)",
  "CFBundlePackageType": "APPL",
  "CFBundleShortVersionString": "1.0",
  "CFBundleVersion": "1",
]

/// Assemble, and sign, the `.app` bundle.
func assembleBundle(
  _ target: AppTarget, executable: URL, frameworks: [PackageFramework], resourceBundles: [URL],
  compiledAssets: URL?, output: URL, toolchain: Toolchain
) throws -> URL {
  let manager = FileManager.default
  let settings = target.settings
  let app = output.appendingPathComponent(settings["WRAPPER_NAME"] ?? "\(target.name).app")
  try manager.recreateDirectory(app)
  let contents = target.platform.isMacBundle ? app.appendingPathComponent("Contents") : app
  let resources = target.platform.isMacBundle ? contents.appendingPathComponent("Resources") : app
  let executableDirectory = target.platform.isMacBundle ? contents.appendingPathComponent("MacOS") : app
  try manager.createDirectory(at: executableDirectory, withIntermediateDirectories: true)

  try manager.copyReplacing(executable, to: executableDirectory.appendingPathComponent(executable.lastPathComponent))
  try Data("APPL????".utf8).write(to: contents.appendingPathComponent("PkgInfo"))

  // Resources: Xcode's Copy Bundle Resources flattens groups into Resources/.
  for (source, name) in target.resources {
    try manager.copyReplacing(source, to: resources.appendingPathComponent(name))
  }
  let xcode = try toolchain.xcodeVersion()
  for bundle in resourceBundles {
    let copy = resources.appendingPathComponent(bundle.lastPathComponent)
    try manager.copyReplacing(bundle, to: copy)
    // Swift Build stamps DTXcode/DTXcodeBuild from the Xcode it runs inside.
    // Driven by SwiftPM it is not inside one — SwiftPM decides that from its
    // own toolchain path, not DEVELOPER_DIR — so it writes placeholders
    // (10989 / 99T999). Every other key it stamps is already correct.
    let info = copy.appendingPathComponent(target.platform.isMacBundle ? "Contents/Info.plist" : "Info.plist")
    if manager.fileExists(atPath: info.path) {
      var plist = try readPlist(info)
      plist["DTXcode"] = xcode.version
      plist["DTXcodeBuild"] = xcode.build
      try writePlist(plist, to: info, format: target.platform == .iOS ? .binary : .xml)
    }
  }

  var assetInfo: [String: Any] = [:]
  if !target.assetCatalogs.isEmpty {
    guard let compiledAssets else {
      throw BuildError(
        "\(target.assetCatalogs.map(\.lastPathComponent).joined(separator: ", ")) must be compiled by Xcode's actool; "
          + "pass --compiled-assets <dir> with its output (Assets.car and friends)")
    }
    for item in try manager.contentsOfDirectory(at: compiledAssets, includingPropertiesForKeys: nil) {
      if item.lastPathComponent == "assetcatalog_generated_info.plist" {
        assetInfo = try readPlist(item)
      } else if !item.lastPathComponent.hasPrefix(".") {
        try manager.copyReplacing(item, to: resources.appendingPathComponent(item.lastPathComponent))
      }
    }
  }

  let info = try infoPlist(target, assetInfo: assetInfo, toolchain: toolchain)
  try writePlist(
    info, to: contents.appendingPathComponent("Info.plist"),
    format: target.platform == .iOS ? .binary : .xml)

  for framework in frameworks {
    let binary = try embedFramework(framework, in: contents.appendingPathComponent("Frameworks"), target: target, toolchain: toolchain)
    if settings["DEBUG_INFORMATION_FORMAT"] == "dwarf-with-dsym" {
      try makeDSYM(binary, output.appendingPathComponent("\(framework.name).framework.dSYM"))
    }
  }

  if settings["DEBUG_INFORMATION_FORMAT"] == "dwarf-with-dsym" {
    try makeDSYM(
      executableDirectory.appendingPathComponent(executable.lastPathComponent),
      output.appendingPathComponent("\(app.lastPathComponent).dSYM"))
  }

  try sign(app, target: target, work: output)
  return app
}

func infoPlist(_ target: AppTarget, assetInfo: [String: Any], toolchain: Toolchain) throws -> [String: Any] {
  let settings = target.settings
  var plist: [String: Any]
  if let info = target.raw["info"] as? [String: Any] {
    plist = xcodeGenInfoDefaults
    for (key, value) in info["properties"] as? [String: Any] ?? [:] { plist[key] = value }
  } else if let path = settings["INFOPLIST_FILE"], !path.isEmpty {
    plist = try readPlist(target.spec.root.appendingPathComponent(path))
  } else {
    throw BuildError("target \(target.name) has neither `info:` nor INFOPLIST_FILE")
  }
  if settings.bool("GENERATE_INFOPLIST_FILE") {
    for (key, value) in settings.all where key.hasPrefix("INFOPLIST_KEY_") {
      let key = String(key.dropFirst("INFOPLIST_KEY_".count))
      switch value {
      case "YES": plist[key] = true
      case "NO": plist[key] = false
      default: plist[key] = value
      }
    }
  }
  for (key, value) in assetInfo { plist[key] = value }
  plist = try expandPlist(plist, settings) as? [String: Any] ?? plist

  for (key, value) in try toolchainInfoKeys(target.platform, toolchain: toolchain) { plist[key] = value }
  switch target.platform {
  case .macOS:
    if plist["LSMinimumSystemVersion"] == nil { plist["LSMinimumSystemVersion"] = try target.platform.deploymentTarget(settings) }
  case .iOS:
    plist["MinimumOSVersion"] = try target.platform.deploymentTarget(settings)
    plist["UIDeviceFamily"] = deviceFamilies(settings).filter { $0 == 1 || $0 == 2 }
    plist["UIRequiredDeviceCapabilities"] = plist["UIRequiredDeviceCapabilities"] ?? ["arm64"]
  case .macCatalyst:
    plist["UIDeviceFamily"] = deviceFamilies(settings).contains(6) ? [6] : [2]
    // The macOS release equivalent to the iOS deployment target, from the SDK's own map.
    let map = try catalystVersionMap(toolchain.sdk(target.platform.sdkName))
    let iOSMinimum = try target.platform.deploymentTarget(settings)
    guard let macOSMinimum = map[iOSMinimum] else {
      throw BuildError("SDKSettings.json has no macOS equivalent for Mac Catalyst \(iOSMinimum)")
    }
    plist["LSMinimumSystemVersion"] = plist["LSMinimumSystemVersion"] ?? macOSMinimum
    plist["NSSupportsAutomaticTermination"] = plist["NSSupportsAutomaticTermination"] ?? true
    plist["NSSupportsSuddenTermination"] = plist["NSSupportsSuddenTermination"] ?? true
  }
  return plist
}

/// `VersionMap.iOSMac_macOS` from the SDK: Mac Catalyst (iOS) version → macOS version.
private func catalystVersionMap(_ sdk: URL) throws -> [String: String] {
  let data = try Data(contentsOf: sdk.appendingPathComponent("SDKSettings.json"))
  guard let settings = try JSONSerialization.jsonObject(with: data) as? [String: Any],
    let map = (settings["VersionMap"] as? [String: Any])?["iOSMac_macOS"] as? [String: String]
  else {
    throw BuildError("\(sdk.path)/SDKSettings.json has no iOSMac_macOS version map")
  }
  return map
}

private func deviceFamilies(_ settings: BuildSettings) -> [Int] {
  (settings["TARGETED_DEVICE_FAMILY"] ?? "1").split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
}

/// The keys Xcode's ProcessInfoPlistFile stamps into every bundle for the SDK
/// and toolchain it was built with.
func toolchainInfoKeys(_ platform: Platform, toolchain: Toolchain) throws -> [String: Any] {
  let sdk = try SDKInfo(sdk: toolchain.sdk(platform.sdkName))
  let xcode = try toolchain.xcodeVersion()
  return [
    "CFBundleSupportedPlatforms": [platform.supportedPlatform],
    "DTCompiler": "com.apple.compilers.llvm.clang.1_0",
    "DTPlatformBuild": sdk.build,
    "DTPlatformName": platform.platformName,
    "DTPlatformVersion": sdk.version,
    "DTSDKBuild": sdk.build,
    "DTSDKName": sdk.canonicalName,
    "DTXcode": xcode.version,
    "DTXcodeBuild": xcode.build,
  ]
}

/// Embed a package's dynamic product as `<Name>.framework`, in the versioned
/// layout on macOS and the flat one on iOS — as Xcode does. Returns the binary.
private func embedFramework(
  _ framework: PackageFramework, in directory: URL, target: AppTarget, toolchain: Toolchain
) throws -> URL {
  let manager = FileManager.default
  let bundle = directory.appendingPathComponent("\(framework.name).framework")
  try manager.recreateDirectory(bundle)
  let versioned = target.platform.isMacBundle
  let root = versioned ? bundle.appendingPathComponent("Versions/A") : bundle
  let resources = versioned ? root.appendingPathComponent("Resources") : root
  try manager.createDirectory(at: resources, withIntermediateDirectories: true)
  let binary = root.appendingPathComponent(framework.name)
  try manager.copyReplacing(framework.binary, to: binary)

  var info: [String: Any] = [
    "CFBundleDevelopmentRegion": "en",
    "CFBundleExecutable": framework.name,
    "CFBundleIdentifier": framework.bundleIdentifier,
    "CFBundleInfoDictionaryVersion": "6.0",
    "CFBundleName": framework.name,
    "CFBundlePackageType": "FMWK",
    "CFBundleShortVersionString": "1.0",
    "CFBundleVersion": "1",
  ]
  for (key, value) in try toolchainInfoKeys(target.platform, toolchain: toolchain) { info[key] = value }
  let minimum = try target.platform.deploymentTarget(target.settings)
  if target.platform == .iOS { info["MinimumOSVersion"] = minimum } else if target.platform == .macOS {
    info["LSMinimumSystemVersion"] = minimum
  }
  try writePlist(info, to: resources.appendingPathComponent("Info.plist"), format: target.platform == .iOS ? .binary : .xml)

  if versioned {
    try manager.createSymbolicLink(atPath: bundle.appendingPathComponent("Versions/Current").path, withDestinationPath: "A")
    try manager.createSymbolicLink(
      atPath: bundle.appendingPathComponent(framework.name).path, withDestinationPath: "Versions/Current/\(framework.name)")
    try manager.createSymbolicLink(atPath: bundle.appendingPathComponent("Resources").path, withDestinationPath: "Versions/Current/Resources")
  }
  return binary
}

private func makeDSYM(_ binary: URL, _ dsym: URL) throws {
  if FileManager.default.fileExists(atPath: dsym.path) { try FileManager.default.removeItem(at: dsym) }
  try run("dsymutil", [binary.path, "-o", dsym.path])
}

/// Expand `$(VAR)` in every string of a property list.
private func expandPlist(_ value: Any, _ settings: BuildSettings) throws -> Any {
  switch value {
  case let string as String: return settings.expand(string)
  case let array as [Any]: return try array.map { try expandPlist($0, settings) }
  case let dictionary as [String: Any]: return try dictionary.mapValues { try expandPlist($0, settings) }
  default: return value
  }
}

/// Code-sign the bundle with `rcodesign`: ad-hoc for `CODE_SIGN_IDENTITY = -`,
/// otherwise with the PKCS#12 identity named by the environment.
private func sign(_ app: URL, target: AppTarget, work: URL) throws {
  let settings = target.settings
  var entitlements: [String: Any] = [:]
  if let spec = target.raw["entitlements"] as? [String: Any], let properties = spec["properties"] as? [String: Any] {
    entitlements = properties
  } else if let path = settings["CODE_SIGN_ENTITLEMENTS"], !path.isEmpty {
    entitlements = try readPlist(target.spec.root.appendingPathComponent(path))
  }
  // Xcode injects this for development signing so a debugger can attach.
  if target.configuration.lowercased() == "debug", settings.bool("CODE_SIGN_INJECT_BASE_ENTITLEMENTS") {
    entitlements["com.apple.security.get-task-allow"] = true
  }

  var arguments = ["sign"]
  if !entitlements.isEmpty {
    let path = work.appendingPathComponent("\(target.name).xcent")
    try writePlist(entitlements, to: path, format: .xml)
    arguments += ["--entitlements-xml-path", path.path]
  }
  if target.platform != .iOS, settings.bool("ENABLE_HARDENED_RUNTIME") {
    arguments += ["--code-signature-flags", "runtime"]
  }
  let identity = settings["CODE_SIGN_IDENTITY"] ?? "-"
  if identity != "-" {
    let environment = ProcessInfo.processInfo.environment
    guard let p12 = environment["APPLEBUILD_P12_FILE"], let password = environment["APPLEBUILD_P12_PASSWORD_FILE"] else {
      throw BuildError(
        "CODE_SIGN_IDENTITY is \"\(identity)\": set APPLEBUILD_P12_FILE and APPLEBUILD_P12_PASSWORD_FILE, or build with CODE_SIGN_IDENTITY=-")
    }
    arguments += ["--p12-file", p12, "--p12-password-file", password]
    if let profile = environment["APPLEBUILD_PROVISIONING_PROFILE"] {
      try FileManager.default.copyReplacing(
        URL(fileURLWithPath: profile),
        to: app.appendingPathComponent(target.platform.isMacBundle ? "Contents/embedded.provisionprofile" : "embedded.mobileprovision"))
    }
  }
  arguments.append(app.path)
  try run("rcodesign", arguments)
}
