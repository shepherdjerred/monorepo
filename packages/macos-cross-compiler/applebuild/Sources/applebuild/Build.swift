import Foundation

/// One application target, resolved for a platform and configuration.
struct AppTarget {
  let spec: ProjectSpec
  let name: String
  let raw: [String: Any]
  let platform: Platform
  let configuration: String
  let settings: BuildSettings
  let swiftSources: [URL]
  /// C, C++, Objective-C, and Objective-C++ sources, compiled by clang as
  /// Xcode's C build rule does.
  let cFamilySources: [URL]
  /// Directories holding the target's headers. Xcode's header maps make
  /// every one of them reachable by `#include "Name.h"`.
  let headerDirectories: [URL]
  /// Files and directories copied into the bundle's resources, by bundle-relative name.
  let resources: [(source: URL, name: String)]
  /// `.xcassets` / `.icon` inputs, which only Xcode's `actool` can compile.
  let assetCatalogs: [URL]
  let productDependencies: [(package: URL, product: String)]

  init(
    spec: ProjectSpec, name: String, platform requested: Platform?, configuration: String,
    overrides: [String: String] = [:]
  ) throws {
    self.spec = spec
    self.name = name
    self.configuration = configuration
    raw = try spec.target(name)

    guard raw["type"] as? String == "application" else {
      throw BuildError("target \(name) is not an application")
    }
    let declared = raw["platform"] as? String
    let destinations = raw["supportedDestinations"] as? [String] ?? []
    switch (declared, requested) {
    case ("macOS", nil), ("macOS", .macOS?): platform = .macOS
    case ("iOS", nil), ("iOS", .iOS?): platform = .iOS
    case ("iOS", .macCatalyst?) where destinations.contains("macCatalyst"): platform = .macCatalyst
    default:
      throw BuildError("target \(name) (platform \(declared ?? "?")) cannot be built for \(requested?.rawValue ?? "?")")
    }

    // XcodeGen presets: deployment targets, derived paths, bundle id prefix.
    var presets: [String: String] = [:]
    let deploymentSettings = ["macOS": "MACOSX_DEPLOYMENT_TARGET", "iOS": "IPHONEOS_DEPLOYMENT_TARGET"]
    for (key, value) in spec.options["deploymentTarget"] as? [String: Any] ?? [:] {
      if let setting = deploymentSettings[key] { presets[setting] = try settingString(value) }
    }
    switch raw["deploymentTarget"] {
    case let perPlatform as [String: Any]:
      for (key, value) in perPlatform {
        if let setting = deploymentSettings[key] { presets[setting] = try settingString(value) }
      }
    case let value?:
      if let declared, let setting = deploymentSettings[declared] { presets[setting] = try settingString(value) }
    case nil:
      break
    }
    if let prefix = spec.options["bundleIdPrefix"] as? String {
      presets["PRODUCT_BUNDLE_IDENTIFIER"] = "\(prefix).\(name)"
    }
    presets["PRODUCT_NAME"] = name
    if let info = raw["info"] as? [String: Any], let path = info["path"] as? String {
      presets["INFOPLIST_FILE"] = path
    }
    if let entitlements = raw["entitlements"] as? [String: Any], let path = entitlements["path"] as? String {
      presets["CODE_SIGN_ENTITLEMENTS"] = path
    }

    // Names Xcode derives from other settings; expansion is lazy, so these
    // follow whatever PRODUCT_NAME the spec finally sets.
    let derived = [
      "CONFIGURATION": configuration,
      "TARGET_NAME": name,
      "EXECUTABLE_NAME": "$(PRODUCT_NAME)",
      "PRODUCT_MODULE_NAME": "$(PRODUCT_NAME:c99extidentifier)",
      "WRAPPER_NAME": "$(PRODUCT_NAME).app",
      "DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER": "YES",
      "SRCROOT": spec.root.path,
      "PROJECT_DIR": spec.root.path,
    ]
    var layers = [
      derived, platform.defaultSettings, xcodeCompilerDefaults(), configurationPresets(configuration), presets,
    ]
    layers += try settingLayers(spec.raw["settings"], configuration: configuration)
    layers += try settingLayers(raw["settings"], configuration: configuration)
    if platform == .macCatalyst,
      BuildSettings(layers: layers)["DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER"] == "YES"
    {
      layers.append(["PRODUCT_BUNDLE_IDENTIFIER": "maccatalyst.$(inherited)"])
    }
    // Command-line settings win over everything, as with `xcodebuild KEY=VALUE`.
    layers.append(overrides)
    settings = BuildSettings(layers: layers)

    // Sources.
    var swiftSources: [URL] = []
    var cFamilySources: [URL] = []
    var headerDirectories: [URL] = []
    var resources: [(URL, String)] = []
    var assetCatalogs: [URL] = []
    for entry in raw["sources"] as? [Any] ?? [] {
      let path: String
      var excludes: [String] = []
      var phase: String?
      if let string = entry as? String {
        path = string
      } else if let map = entry as? [String: Any], let string = map["path"] as? String {
        path = string
        excludes = map["excludes"] as? [String] ?? []
        phase = map["buildPhase"] as? String
      } else {
        throw BuildError("target \(name): unsupported sources entry \(entry)")
      }
      let root = spec.root.appendingPathComponent(path)
      for file in try enumerateSources(root, excludes: excludes) {
        let ext = file.pathExtension
        if ["xcassets", "icon"].contains(ext) {
          assetCatalogs.append(file)
        } else if phase == nil && ext == "swift" {
          swiftSources.append(file)
        } else if phase == nil && clangLanguages[ext] != nil {
          cFamilySources.append(file)
        } else if phase == nil && ["h", "hh", "hpp", "hxx"].contains(ext) {
          // An application's headers are neither compiled nor copied.
          let directory = file.deletingLastPathComponent()
          if !headerDirectories.contains(directory) { headerDirectories.append(directory) }
        } else if phase == nil && ["metal", "storyboard", "xib", "intentdefinition", "xcstrings"].contains(ext) {
          throw BuildError("target \(name): \(file.lastPathComponent) needs a build rule applebuild does not implement")
        } else if phase == nil || phase == "resources" {
          resources.append((file, file.lastPathComponent))
        } else {
          throw BuildError("target \(name): buildPhase \(phase ?? "") is not supported")
        }
      }
    }
    self.swiftSources = swiftSources.sorted { $0.path < $1.path }
    self.cFamilySources = cFamilySources.sorted { $0.path < $1.path }
    self.headerDirectories = headerDirectories
    self.resources = resources
    self.assetCatalogs = assetCatalogs

    let packages = try spec.localPackages()
    var products: [(URL, String)] = []
    for dependency in raw["dependencies"] as? [[String: Any]] ?? [] {
      if let package = dependency["package"] as? String {
        guard let url = packages[package], let product = dependency["product"] as? String else {
          throw BuildError("target \(name): package dependency \(package) needs a local package and a product")
        }
        products.append((url, product))
      } else {
        throw BuildError("target \(name): only package-product dependencies are supported, not \(dependency)")
      }
    }
    productDependencies = products
  }

  var architectures: [String] {
    if let archs = settings["ARCHS"], !archs.isEmpty, archs != "$(ARCHS_STANDARD)" {
      return archs.split(separator: " ").map(String.init)
    }
    return settings.bool("ONLY_ACTIVE_ARCH") ? ["arm64"] : platform.standardArchitectures
  }
}

/// Files under a source path, with XcodeGen's `excludes` globs applied.
/// Bundle-like directories (`.xcassets`, `.icon`, `.lproj`, `.bundle`) are
/// returned whole, as Xcode treats them as single items.
private func enumerateSources(_ root: URL, excludes: [String]) throws -> [URL] {
  let manager = FileManager.default
  guard manager.fileExists(atPath: root.path) else {
    throw BuildError("source path \(root.path) does not exist")
  }
  func excluded(_ relative: String) -> Bool {
    excludes.contains { fnmatch($0, relative, 0) == 0 || fnmatch($0, (relative as NSString).lastPathComponent, 0) == 0 }
  }
  guard manager.isDirectory(root), !["xcassets", "icon", "lproj", "bundle"].contains(root.pathExtension) else {
    return [root]
  }
  var results: [URL] = []
  func walk(_ directory: URL, relative: String) throws {
    for name in try manager.contentsOfDirectory(atPath: directory.path).sorted() where !name.hasPrefix(".") {
      let url = directory.appendingPathComponent(name)
      let path = relative.isEmpty ? name : "\(relative)/\(name)"
      if excluded(path) { continue }
      if manager.isDirectory(url), !["xcassets", "icon", "lproj", "bundle"].contains(url.pathExtension) {
        try walk(url, relative: path)
      } else {
        results.append(url)
      }
    }
  }
  try walk(root, relative: "")
  return results
}

/// The compiled package products one architecture of the app links.
struct PackageBuild {
  /// Swift Build's `Products/<configuration>` directory: swiftmodules live here.
  let products: URL?
  /// One merged object per package target, linked in whole as Xcode does.
  let objects: [URL]
  let moduleMaps: [URL]
  let frameworks: [PackageFramework]
  let resourceBundles: [URL]

  static let none = PackageBuild(products: nil, objects: [], moduleMaps: [], frameworks: [], resourceBundles: [])
}

/// A `type: .dynamic` package product, which Xcode embeds as a framework.
struct PackageFramework {
  let name: String
  /// The dylib with the framework install name already applied.
  let binary: URL
  let bundleIdentifier: String
}

/// Build every package product the app depends on with Swift Build — the
/// engine Xcode itself uses — by way of a generated wrapper package. Swift
/// Build gives the Xcode behaviours plain SwiftPM does not: a merged object
/// per target, resource bundles in the macOS layout, and the resource-bundle
/// accessor that looks in the app's Resources.
func buildPackages(for target: AppTarget, arch: String, work: URL, toolchain: Toolchain) throws -> PackageBuild {
  guard !target.productDependencies.isEmpty else { return .none }
  let manager = FileManager.default
  let wrapper = work.appendingPathComponent("deps")
  try manager.createDirectory(at: wrapper.appendingPathComponent("Sources/AppDependencies"), withIntermediateDirectories: true)
  try Data("// Pulls the application's package products into one build.\n".utf8)
    .write(to: wrapper.appendingPathComponent("Sources/AppDependencies/AppDependencies.swift"))

  let appPlatform = target.platform == .macOS ? "macos" : "ios"
  let packages = Set(target.productDependencies.map(\.package))
  func writeManifest(platforms: [String: String]) throws {
    let names = ["macos": "macOS", "ios": "iOS", "maccatalyst": "macCatalyst", "tvos": "tvOS", "watchos": "watchOS", "visionos": "visionOS"]
    let declared = try platforms.sorted { $0.key < $1.key }.map { platform, version in
      guard let name = names[platform] else { throw BuildError("unknown package platform \(platform)") }
      return ".\(name)(\"\(version)\")"
    }
    let manifest = """
      // swift-tools-version: 6.1
      // Generated by applebuild.
      import PackageDescription
      let package = Package(
        name: "AppDependencies",
        platforms: [\(declared.joined(separator: ", "))],
        products: [.library(name: "AppDependencies", type: .static, targets: ["AppDependencies"])],
        dependencies: [\(packages.map { ".package(path: \"\($0.path)\")" }.sorted().joined(separator: ", "))],
        targets: [.target(name: "AppDependencies", dependencies: [\(target.productDependencies.map { ".product(name: \"\($0.product)\", package: \"\($0.package.lastPathComponent)\")" }.joined(separator: ", "))])]
      )
      """
    try Data(manifest.utf8).write(to: wrapper.appendingPathComponent("Package.swift"))
  }
  // The wrapper must declare, per platform, at least what every package in
  // the graph requires — as the app project does for Xcode — so describe the
  // graph first, then write the final manifest.
  let appMinimum = try target.platform.deploymentTarget(target.settings)
  try writeManifest(platforms: [appPlatform: appMinimum])
  let graph = try describeGraph(wrapper)
  var platforms = graph.platforms
  platforms[appPlatform] = maxVersion(platforms[appPlatform], appMinimum)
  if target.platform == .macCatalyst {
    // Without it SwiftPM's default Mac Catalyst minimum applies, older than
    // the app's, and the packages back-deploy runtime shims the app never needs.
    platforms["maccatalyst"] = maxVersion(platforms["maccatalyst"], appMinimum)
  }
  try writeManifest(platforms: platforms)

  let scratch = work.appendingPathComponent("packages-\(arch)")
  let configuration = target.configuration.lowercased() == "debug" ? "debug" : "release"
  // The real Apple SDK, not a Swift SDK bundle: from a Swift SDK, Swift Build
  // synthesizes an SDK without the Apple one's SDKSettings, and then treats the
  // target as ELF (`.so` products, autolink extraction) and loses the Mac
  // Catalyst variant. Named explicitly: Swift Build is the default only from
  // Swift 6.3.
  try run(
    "swift",
    [
      "build", "--build-system", "swiftbuild", "--package-path", wrapper.path, "--scratch-path", scratch.path,
      "--triple", try target.platform.triple(arch: arch, settings: target.settings),
      "--sdk", toolchain.sdk(target.platform.sdkName).path,
      "-c", configuration, "--product", "AppDependencies",
    ])

  let productsRoot = scratch.appendingPathComponent("out/Products")
  guard
    let products = try manager.contentsOfDirectory(at: productsRoot, includingPropertiesForKeys: nil)
      .first(where: { manager.fileExists(atPath: $0.appendingPathComponent("AppDependencies.swiftmodule").path) })
  else {
    throw BuildError("Swift Build produced no AppDependencies module under \(productsRoot.path)")
  }

  // The archive lists exactly the targets the app's products pulled in.
  let members = try capture("/usr/lib/llvm-apple/bin/llvm-ar", ["t", products.appendingPathComponent("libAppDependencies.a").path])
    .split(separator: "\n").map(String.init).filter { $0.hasSuffix(".o") && $0 != "AppDependencies.o" }
  let objects = members.map { products.appendingPathComponent($0) }

  var moduleMaps: [URL] = []
  let intermediates = scratch.appendingPathComponent("out/Intermediates.noindex")
  for directory in try manager.contentsOfDirectory(at: intermediates, includingPropertiesForKeys: nil)
  where directory.lastPathComponent.hasPrefix("GeneratedModuleMaps") {
    moduleMaps += try manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
      .filter { $0.pathExtension == "modulemap" && $0.lastPathComponent != "AppDependencies.modulemap" }
  }
  let include = products.appendingPathComponent("include")
  if manager.fileExists(atPath: include.path) {
    for directory in try manager.contentsOfDirectory(at: include, includingPropertiesForKeys: nil) {
      let map = directory.appendingPathComponent("module.modulemap")
      if manager.fileExists(atPath: map.path) { moduleMaps.append(map) }
    }
  }

  // Dynamic products: Xcode embeds them as `<Name>.framework`, with the
  // install name to match.
  let identities = graph.dynamicProductIdentities
  var frameworks: [PackageFramework] = []
  let frameworkWork = work.appendingPathComponent("frameworks-\(arch)")
  try manager.recreateDirectory(frameworkWork)
  for file in try manager.contentsOfDirectory(at: products, includingPropertiesForKeys: nil)
  where file.lastPathComponent.hasPrefix("lib") && file.pathExtension == "dylib" {
    let name = String(file.deletingPathExtension().lastPathComponent.dropFirst(3))
    guard let identity = identities[name] else {
      throw BuildError("\(file.lastPathComponent) is not a dynamic product of any package in the graph")
    }
    let binary = frameworkWork.appendingPathComponent(name)
    try manager.copyReplacing(file, to: binary)
    let installName = target.platform.isMacBundle
      ? "@rpath/\(name).framework/Versions/A/\(name)" : "@rpath/\(name).framework/\(name)"
    try run("install_name_tool", ["-id", installName, binary.path])
    frameworks.append(PackageFramework(name: name, binary: binary, bundleIdentifier: "\(identity).\(name)"))
  }

  return PackageBuild(
    products: products,
    objects: objects.sorted { $0.path < $1.path },
    moduleMaps: moduleMaps.sorted { $0.path < $1.path },
    frameworks: frameworks.sorted { $0.name < $1.name },
    resourceBundles: try manager.contentsOfDirectory(at: products, includingPropertiesForKeys: nil)
      .filter { $0.pathExtension == "bundle" }.sorted { $0.path < $1.path }
  )
}

/// What the wrapper's package graph requires and provides.
private struct PackageGraph {
  /// Dynamic library product name → the identity of the package declaring
  /// it, which Xcode uses as the framework's bundle-identifier prefix.
  var dynamicProductIdentities: [String: String] = [:]
  /// Platform → the highest minimum version any package declares.
  var platforms: [String: String] = [:]
}

private func describeGraph(_ wrapper: URL) throws -> PackageGraph {
  let json = try capture("swift", ["package", "--package-path", wrapper.path, "show-dependencies", "--format", "json"])
  guard let root = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
    throw BuildError("unreadable show-dependencies output")
  }
  var packages: [(identity: String, path: String)] = []
  func visit(_ node: [String: Any]) {
    if let identity = node["identity"] as? String, let path = node["path"] as? String, path != wrapper.path {
      packages.append((identity, path))
    }
    for child in node["dependencies"] as? [[String: Any]] ?? [] { visit(child) }
  }
  visit(root)
  var graph = PackageGraph()
  for package in packages {
    let json = try capture("swift", ["package", "--package-path", package.path, "describe", "--type", "json"])
    guard let description = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
      throw BuildError("unreadable package description for \(package.path)")
    }
    for product in description["products"] as? [[String: Any]] ?? [] {
      if let name = product["name"] as? String,
        ((product["type"] as? [String: Any])?["library"] as? [String])?.contains("dynamic") == true
      {
        graph.dynamicProductIdentities[name] = package.identity
      }
    }
    for platform in description["platforms"] as? [[String: Any]] ?? [] {
      if let name = platform["name"] as? String, let version = platform["version"] as? String {
        graph.platforms[name] = maxVersion(graph.platforms[name], version)
      }
    }
  }
  return graph
}

private func maxVersion(_ a: String?, _ b: String) -> String {
  guard let a else { return b }
  let parse = { (v: String) in v.split(separator: ".").map { Int($0) ?? 0 } + [0, 0, 0] }
  return parse(a).lexicographicallyPrecedes(parse(b)) ? b : a
}

/// Compile and link the application target for one architecture.
///
/// Two steps, as Xcode does, so the objects outlive the link: the executable's
/// debug map points at them, and `dsymutil` reads them to build the dSYM.
func compileApp(_ target: AppTarget, arch: String, packages: PackageBuild, work: URL, toolchain: Toolchain) throws -> URL {
  let settings = target.settings
  let manager = FileManager.default
  let sdk = toolchain.sdk(target.platform.sdkName)
  let moduleName = settings["PRODUCT_MODULE_NAME"] ?? target.name
  let objects = work.appendingPathComponent("objects")
  try manager.recreateDirectory(objects)
  let triple = try target.platform.triple(arch: arch, settings: settings)
  let common = toolchain.swiftcArguments(sdk: sdk, platform: target.platform) + ["-target", triple]
  // Where Xcode puts generated sources: here, the Swift module's
  // Objective-C interface header, which the target's Objective-C imports.
  let derived = work.appendingPathComponent("DerivedSources")
  try manager.recreateDirectory(derived)
  let headerSearch = try headerSearchArguments(target, derived: derived)

  // Kept with the build, like Swift Build's, so a rebuild does not recompile
  // every SDK module from its .swiftinterface.
  let moduleCache = work.deletingLastPathComponent().appendingPathComponent("ModuleCache.noindex")
  var compile = common + ["-module-name", moduleName, "-c", "-g", "-module-cache-path", moduleCache.path]
  compile += try swiftFlags(settings)
  if !target.swiftSources.contains(where: { $0.lastPathComponent == "main.swift" }) {
    compile.append("-parse-as-library")
  }
  if let products = packages.products { compile += ["-I", products.path] }
  for map in packages.moduleMaps { compile += ["-Xcc", "-fmodule-map-file=\(map.path)"] }
  if let bridgingHeader = settings["SWIFT_OBJC_BRIDGING_HEADER"], !bridgingHeader.isEmpty {
    compile += ["-import-objc-header", target.spec.root.appendingPathComponent(bridgingHeader).standardizedFileURL.path]
  }
  if !target.cFamilySources.isEmpty {
    compile += headerSearch.flatMap { ["-Xcc", $0] }
    let interface = settings["SWIFT_OBJC_INTERFACE_HEADER_NAME"] ?? "\(moduleName)-Swift.h"
    compile += ["-emit-objc-header-path", derived.appendingPathComponent(interface).path]
  }
  if settings["SWIFT_COMPILATION_MODE"] == "wholemodule" {
    compile += ["-o", objects.appendingPathComponent("\(moduleName).o").path]
  } else {
    compile += ["-working-directory", objects.path]
  }
  compile += target.swiftSources.map(\.path)
  try run("swiftc", compile)

  // The C-family sources, after Swift: Objective-C may import the interface
  // header the Swift compile just wrote. clang's per-triple configuration
  // supplies the SDK, as Xcode's -isysroot does.
  let swiftObjects = try manager.contentsOfDirectory(at: objects, includingPropertiesForKeys: nil)
    .filter { $0.pathExtension == "o" }.sorted { $0.path < $1.path }
  var objectNames = Set(swiftObjects.map(\.lastPathComponent))
  var cFamilyObjects: [URL] = []
  for source in target.cFamilySources {
    let object = source.deletingPathExtension().lastPathComponent + ".o"
    guard objectNames.insert(object).inserted else {
      throw BuildError("target \(target.name): two sources compile to \(object); rename one")
    }
    let language = clangLanguages[source.pathExtension]!
    // For Mac Catalyst, clang's macabi configuration adds the iOSSupport paths.
    var arguments = ["-x", language, "-target", triple]
    arguments += try clangFlags(settings, language: language)
    arguments += headerSearch
    let output = objects.appendingPathComponent(object)
    arguments += ["-fmodules-cache-path=\(moduleCache.path)", "-c", source.path, "-o", output.path]
    try run("clang", arguments)
    cFamilyObjects.append(output)
  }

  let output = work.appendingPathComponent(settings["EXECUTABLE_NAME"] ?? target.name)
  var link = common + ["-emit-executable", "-o", output.path]
  // Xcode's link file list: the C-family objects in source order, then Swift's.
  link += (cFamilyObjects + swiftObjects).map(\.path)
  link += packages.objects.map(\.path)
  link += packages.frameworks.map(\.binary.path)
  var runpaths: [String] = []
  for path in settings.list("LD_RUNPATH_SEARCH_PATHS") where !runpaths.contains(path) { runpaths.append(path) }
  for path in runpaths { link += ["-Xlinker", "-rpath", "-Xlinker", path] }
  if settings.bool("DEAD_CODE_STRIPPING") { link += ["-Xlinker", "-dead_strip"] }
  // Testability links with -rdynamic, which clang passes to ld64 as this.
  if settings.bool("ENABLE_TESTABILITY") { link += ["-Xlinker", "-export_dynamic"] }
  // Xcode links with clang++ `-stdlib=libc++` once a target has C++ sources.
  if target.cFamilySources.contains(where: { clangLanguages[$0.pathExtension]!.hasSuffix("c++") }) {
    link.append("-lc++")
  }
  try run("swiftc", link)
  return output
}

/// Source extension → clang language, for the sources Xcode's C build rule compiles.
let clangLanguages = [
  "c": "c", "m": "objective-c", "cc": "c++", "cpp": "c++", "cxx": "c++", "mm": "objective-c++",
]

/// Header search arguments shared by the C-family compiles and Swift's clang
/// importer: Xcode's header maps (every target header by its quoted name),
/// then `HEADER_SEARCH_PATHS`, then the derived sources.
func headerSearchArguments(_ target: AppTarget, derived: URL) throws -> [String] {
  var arguments: [String] = []
  for directory in target.headerDirectories { arguments += ["-iquote", directory.path] }
  for path in target.settings.list("USER_HEADER_SEARCH_PATHS") {
    arguments += ["-iquote", target.spec.root.appendingPathComponent(path).standardizedFileURL.path]
  }
  for path in target.settings.list("HEADER_SEARCH_PATHS") {
    arguments.append("-I" + target.spec.root.appendingPathComponent(path).standardizedFileURL.path)
  }
  arguments.append("-I" + derived.path)
  return arguments
}

/// clang flags from Xcode build settings for one language, in the order
/// Xcode's C build rule passes them. Warning flags are left out: they change
/// diagnostics, not the object code.
func clangFlags(_ settings: BuildSettings, language: String) throws -> [String] {
  let isCPlusPlus = language.hasSuffix("c++")
  let isObjC = language.hasPrefix("objective-c")
  var flags: [String] = []
  if isCPlusPlus {
    if let standard = settings["CLANG_CXX_LANGUAGE_STANDARD"], !standard.isEmpty { flags.append("-std=\(standard)") }
    if let library = settings["CLANG_CXX_LIBRARY"], !library.isEmpty { flags.append("-stdlib=\(library)") }
  } else if let standard = settings["GCC_C_LANGUAGE_STANDARD"], !standard.isEmpty {
    flags.append("-std=\(standard)")
  }
  if isObjC && settings.bool("CLANG_ENABLE_OBJC_ARC") {
    flags.append("-fobjc-arc")
    if settings.bool("CLANG_ENABLE_OBJC_WEAK") { flags.append("-fobjc-weak") }
  }
  if settings.bool("CLANG_ENABLE_MODULES") {
    flags.append("-fmodules")
    if isCPlusPlus { flags.append("-fno-cxx-modules") }
    if settings.bool("CLANG_ENABLE_MODULE_DEBUGGING") { flags.append("-gmodules") }
  }
  if isCPlusPlus, let mode = libraryHardening(settings) {
    flags.append("-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_\(mode.uppercased())")
  }
  if settings.bool("GCC_ENABLE_PASCAL_STRINGS") { flags.append("-fpascal-strings") }
  guard let level = settings["GCC_OPTIMIZATION_LEVEL"], !level.isEmpty else {
    throw BuildError("GCC_OPTIMIZATION_LEVEL is not set")
  }
  flags.append("-O\(level)")
  if settings.bool("GCC_NO_COMMON_BLOCKS") { flags.append("-fno-common") }
  flags += settings.list("GCC_PREPROCESSOR_DEFINITIONS").map { "-D\($0)" }
  if isObjC {
    if settings["ENABLE_NS_ASSERTIONS"] == "NO" { flags.append("-DNS_BLOCK_ASSERTIONS=1") }
    if settings.bool("ENABLE_STRICT_OBJC_MSGSEND") { flags.append("-DOBJC_OLD_DISPATCH_PROTOTYPES=0") }
  }
  flags.append("-g")
  // Testability exports every symbol, so it overrides hidden visibility.
  if settings.bool("GCC_SYMBOLS_PRIVATE_EXTERN") && !settings.bool("ENABLE_TESTABILITY") {
    flags.append("-fvisibility=hidden")
  }
  if isCPlusPlus && settings.bool("GCC_INLINES_ARE_PRIVATE_EXTERN") { flags.append("-fvisibility-inlines-hidden") }
  flags += settings.list(isCPlusPlus ? "OTHER_CPLUSPLUSFLAGS" : "OTHER_CFLAGS")
  return flags
}

/// libc++'s hardening mode (`CLANG_CXX_STANDARD_LIBRARY_HARDENING`), or nil
/// for none. Unset, Clang.xcspec derives it: `debug` at -O0, and `fast` when
/// optimizing with enhanced security or C++ bounds-safe buffers on.
func libraryHardening(_ settings: BuildSettings) -> String? {
  if let mode = settings["CLANG_CXX_STANDARD_LIBRARY_HARDENING"], !mode.isEmpty { return mode }
  if settings["GCC_OPTIMIZATION_LEVEL"] == "0" { return "debug" }
  if settings.bool("ENABLE_ENHANCED_SECURITY") || settings.bool("ENABLE_CPLUSPLUS_BOUNDS_SAFE_BUFFERS") { return "fast" }
  return nil
}

/// Swift compiler flags from Xcode build settings, as Xcode's Swift build rule derives them.
func swiftFlags(_ settings: BuildSettings) throws -> [String] {
  var flags: [String] = []
  let version = settings["SWIFT_VERSION"] ?? ""
  guard let major = version.split(separator: ".").first.flatMap({ Int($0) }) else {
    throw BuildError("SWIFT_VERSION is not set")
  }
  flags += ["-swift-version", String(major)]
  flags.append(settings["SWIFT_OPTIMIZATION_LEVEL"] ?? "-Onone")
  if settings["SWIFT_COMPILATION_MODE"] == "wholemodule" { flags.append("-wmo") }
  if settings.bool("ENABLE_TESTABILITY") { flags.append("-enable-testing") }
  for condition in settings.list("SWIFT_ACTIVE_COMPILATION_CONDITIONS") { flags += ["-D", condition] }
  if settings.bool("SWIFT_TREAT_WARNINGS_AS_ERRORS") { flags.append("-warnings-as-errors") }
  if let strict = settings["SWIFT_STRICT_CONCURRENCY"], !strict.isEmpty, major < 6 {
    flags.append("-strict-concurrency=\(strict)")
  }
  if settings.bool("SWIFT_STRICT_MEMORY_SAFETY") { flags.append("-strict-memory-safety") }
  if let isolation = settings["SWIFT_DEFAULT_ACTOR_ISOLATION"], isolation == "MainActor" {
    flags += ["-default-isolation", "MainActor"]
  }
  var features: [String] = []
  if settings.bool("SWIFT_APPROACHABLE_CONCURRENCY") {
    // Only the members still upcoming in the selected language mode, as Xcode does.
    features += ["NonisolatedNonsendingByDefault", "InferIsolatedConformances"]
    if major < 6 { features += ["InferSendableFromCaptures", "GlobalActorIsolatedTypesUsability", "DisableOutwardActorInference"] }
  }
  for (key, value) in settings.all where key.hasPrefix("SWIFT_UPCOMING_FEATURE_") && value == "YES" {
    let words = key.dropFirst("SWIFT_UPCOMING_FEATURE_".count).split(separator: "_")
    features.append(words.map { $0.prefix(1) + $0.dropFirst().lowercased() }.joined())
  }
  for feature in Set(features).sorted() { flags += ["-enable-upcoming-feature", feature] }
  flags += settings.list("OTHER_SWIFT_FLAGS")
  return flags
}
