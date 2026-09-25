import Foundation

/// Where the image keeps the Apple SDKs and the Linux-side tools.
///
/// Linking needs nothing here: clang's per-triple configuration supplies the
/// SDK and ld64 to every Darwin link, including the ones swiftc drives.
struct Toolchain {
  let root = URL(fileURLWithPath: ProcessInfo.processInfo.environment["APPLE_CROSS_ROOT"] ?? "/opt/apple")
  var resourceDirectory: URL { root.appendingPathComponent("swift-resource") }
  func sdk(_ name: String) -> URL { root.appendingPathComponent("sdks/\(name)") }
  var macroPlugin: String { root.appendingPathComponent("plugins/AppleMacros").path + "#SwiftUIMacros,PreviewsMacros" }

  /// Xcode's version record, as staged beside the developer directory:
  /// ("27.0", "27A5228h") → ("2700", "27A5228h").
  func xcodeVersion() throws -> (version: String, build: String) {
    let info = try readPlist(root.appendingPathComponent("version.plist"))
    guard let short = info["CFBundleShortVersionString"] as? String,
      let build = info["ProductBuildVersion"] as? String
    else {
      throw BuildError("\(root.path)/version.plist lacks the Xcode version keys")
    }
    let parts = short.split(separator: ".").map { Int($0) ?? 0 } + [0, 0]
    return (String(format: "%d%d%d", parts[0], parts[1], parts[2]), build)
  }

  /// Every Swift compile and link against an Apple SDK needs these.
  func swiftcArguments(sdk: URL, platform: Platform) -> [String] {
    var arguments = [
      "-sdk", sdk.path,
      "-resource-dir", resourceDirectory.path,
      "-load-plugin-executable", macroPlugin,
    ]
    if platform == .macCatalyst {
      // Apple's compiler adds the iOSSupport tree ahead of the regular
      // frameworks for a macabi target; the upstream one does not.
      let support = sdk.appendingPathComponent("System/iOSSupport")
      arguments += [
        "-Fsystem", support.appendingPathComponent("System/Library/Frameworks").path,
        "-I", support.appendingPathComponent("usr/lib/swift").path,
        "-L", support.appendingPathComponent("usr/lib/swift").path,
        "-Xcc", "-isystem", "-Xcc", support.appendingPathComponent("usr/include").path,
      ]
    }
    return arguments
  }
}

enum Platform: String {
  case macOS = "macos"
  case iOS = "ios"
  case macCatalyst = "maccatalyst"

  var sdkName: String { self == .iOS ? "iPhoneOS.sdk" : "MacOSX.sdk" }
  func triple(arch: String, settings: BuildSettings) throws -> String {
    switch self {
    case .macOS: "\(arch)-apple-macosx\(try deploymentTarget(settings))"
    case .iOS: "\(arch)-apple-ios\(try deploymentTarget(settings))"
    case .macCatalyst: "\(arch)-apple-ios\(try deploymentTarget(settings))-macabi"
    }
  }

  var deploymentTargetSetting: String {
    self == .macOS ? "MACOSX_DEPLOYMENT_TARGET" : "IPHONEOS_DEPLOYMENT_TARGET"
  }

  func deploymentTarget(_ settings: BuildSettings) throws -> String {
    guard let version = settings[deploymentTargetSetting], !version.isEmpty else {
      throw BuildError("\(deploymentTargetSetting) is not set")
    }
    return version
  }

  /// macOS-style bundles keep everything under `Contents/`.
  var isMacBundle: Bool { self != .iOS }

  var supportedPlatform: String { self == .iOS ? "iPhoneOS" : "MacOSX" }
  var platformName: String { self == .iOS ? "iphoneos" : "macosx" }

  /// Architectures Xcode builds when `ONLY_ACTIVE_ARCH` is off.
  var standardArchitectures: [String] { self == .iOS ? ["arm64"] : ["arm64", "x86_64"] }

  /// Settings Xcode itself supplies for this platform, below every spec layer.
  var defaultSettings: [String: String] {
    var settings = [
      "DEVELOPMENT_LANGUAGE": "en",
      "PRODUCT_BUNDLE_PACKAGE_TYPE": "APPL",
      "DEAD_CODE_STRIPPING": "YES",
      "CODE_SIGN_INJECT_BASE_ENTITLEMENTS": "YES",
      "ENABLE_HARDENED_RUNTIME": "NO",
    ]
    switch self {
    case .macOS:
      settings["SDKROOT"] = "macosx"
      settings["LD_RUNPATH_SEARCH_PATHS"] = "$(inherited) @executable_path/../Frameworks"
    case .iOS:
      settings["SDKROOT"] = "iphoneos"
      settings["LD_RUNPATH_SEARCH_PATHS"] = "$(inherited) @executable_path/Frameworks"
      settings["TARGETED_DEVICE_FAMILY"] = "1"
    case .macCatalyst:
      settings["SDKROOT"] = "iphoneos"
      settings["LD_RUNPATH_SEARCH_PATHS"] = "$(inherited) @executable_path/../Frameworks"
      settings["TARGETED_DEVICE_FAMILY"] = "1"
    }
    return settings
  }
}

/// XcodeGen's per-configuration presets for every project.
func configurationPresets(_ configuration: String) -> [String: String] {
  if configuration.lowercased() == "debug" {
    return [
      "DEBUG_INFORMATION_FORMAT": "dwarf",
      "ENABLE_TESTABILITY": "YES",
      "ONLY_ACTIVE_ARCH": "YES",
      "SWIFT_OPTIMIZATION_LEVEL": "-Onone",
      "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "DEBUG",
    ]
  }
  return [
    "DEBUG_INFORMATION_FORMAT": "dwarf-with-dsym",
    "SWIFT_COMPILATION_MODE": "wholemodule",
    "SWIFT_OPTIMIZATION_LEVEL": "-O",
    "VALIDATE_PRODUCT": "YES",
  ]
}

/// The SDK's own identity, for the `DT*` keys Xcode stamps into Info.plist.
struct SDKInfo {
  let canonicalName: String
  let version: String
  let build: String

  init(sdk: URL) throws {
    let settings = try readPlist(sdk.appendingPathComponent("SDKSettings.plist"))
    let system = try readPlist(sdk.appendingPathComponent("System/Library/CoreServices/SystemVersion.plist"))
    guard let canonicalName = settings["CanonicalName"] as? String,
      let version = settings["Version"] as? String,
      let build = system["ProductBuildVersion"] as? String
    else {
      throw BuildError("\(sdk.path) is missing SDK identity keys")
    }
    self.canonicalName = canonicalName
    self.version = version
    self.build = build
  }
}

func readPlist(_ url: URL) throws -> [String: Any] {
  let data = try Data(contentsOf: url)
  guard let plist = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
  else {
    throw BuildError("\(url.path) is not a property-list dictionary")
  }
  return plist
}

func writePlist(_ plist: [String: Any], to url: URL, format: PropertyListSerialization.PropertyListFormat) throws {
  let data = try PropertyListSerialization.data(fromPropertyList: plist, format: format, options: 0)
  try data.write(to: url)
}
