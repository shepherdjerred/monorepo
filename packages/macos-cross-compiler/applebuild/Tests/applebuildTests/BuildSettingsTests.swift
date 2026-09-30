import Testing

@testable import applebuild

@Suite struct BuildSettingsTests {
  @Test func laterLayersWinAndInheritEarlierOnes() {
    let settings = BuildSettings(layers: [
      ["LD_RUNPATH_SEARCH_PATHS": "@executable_path/../Frameworks", "SWIFT_VERSION": "5.0"],
      ["LD_RUNPATH_SEARCH_PATHS": "$(inherited) /usr/lib/swift", "SWIFT_VERSION": "6"],
    ])
    #expect(settings["LD_RUNPATH_SEARCH_PATHS"] == "@executable_path/../Frameworks /usr/lib/swift")
    #expect(settings["SWIFT_VERSION"] == "6")
  }

  @Test func expandsVariablesLazilyAndWithOperators() {
    let settings = BuildSettings(layers: [
      ["EXECUTABLE_NAME": "$(PRODUCT_NAME)", "PRODUCT_MODULE_NAME": "$(PRODUCT_NAME:c99extidentifier)"],
      ["PRODUCT_NAME": "Hello World-App"],
    ])
    #expect(settings["EXECUTABLE_NAME"] == "Hello World-App")
    #expect(settings["PRODUCT_MODULE_NAME"] == "Hello_World_App")
    #expect(settings.expand("$(MISSING)") == "")
    #expect(settings.expand("$(MISSING:default=-)") == "-")
    #expect(settings.expand("${PRODUCT_NAME:lower}") == "hello world-app")
  }

  @Test func swiftFlagsFollowXcodesSwiftBuildRule() throws {
    let settings = BuildSettings(layers: [
      configurationPresets("Release"),
      [
        "SWIFT_VERSION": "6",
        "SWIFT_APPROACHABLE_CONCURRENCY": "YES",
        "SWIFT_UPCOMING_FEATURE_EXISTENTIAL_ANY": "YES",
        "SWIFT_DEFAULT_ACTOR_ISOLATION": "MainActor",
        "SWIFT_TREAT_WARNINGS_AS_ERRORS": "YES",
      ],
    ])
    let flags = try swiftFlags(settings)
    #expect(flags.starts(with: ["-swift-version", "6", "-O", "-wmo"]))
    #expect(flags.contains("-warnings-as-errors"))
    #expect(flags.contains(where: { $0 == "MainActor" }))
    for feature in ["ExistentialAny", "InferIsolatedConformances", "NonisolatedNonsendingByDefault"] {
      #expect(flags.contains(feature))
    }
    // Swift 6 already implies these; Xcode passes only the still-upcoming members.
    #expect(!flags.contains("InferSendableFromCaptures"))
  }

  /// The settings an XcodeGen application target resolves, below the spec.
  private func appSettings(_ configuration: String) -> BuildSettings {
    BuildSettings(layers: [xcodeCompilerDefaults(), configurationPresets(configuration)])
  }

  /// Pinned to the flags Xcode 27 passes for an XcodeGen app target (its
  /// `*-common-args.resp`), less warnings and header-map search paths.
  @Test func clangFlagsFollowXcodesCBuildRule() throws {
    let release = appSettings("Release")
    #expect(try clangFlags(release, language: "c") == [
      "-std=gnu11", "-fmodules", "-gmodules", "-fpascal-strings", "-Os", "-fno-common", "-g", "-fvisibility=hidden",
    ])
    #expect(try clangFlags(release, language: "objective-c") == [
      "-std=gnu11", "-fobjc-arc", "-fobjc-weak", "-fmodules", "-gmodules", "-fpascal-strings", "-Os", "-fno-common",
      "-DNS_BLOCK_ASSERTIONS=1", "-DOBJC_OLD_DISPATCH_PROTOTYPES=0", "-g", "-fvisibility=hidden",
    ])
    #expect(try clangFlags(release, language: "c++") == [
      "-std=gnu++14", "-stdlib=libc++", "-fmodules", "-fno-cxx-modules", "-gmodules", "-fpascal-strings", "-Os",
      "-fno-common", "-g", "-fvisibility=hidden", "-fvisibility-inlines-hidden",
    ])

    let debug = appSettings("Debug")
    #expect(try clangFlags(debug, language: "c") == [
      "-std=gnu11", "-fmodules", "-gmodules", "-fpascal-strings", "-O0", "-fno-common", "-DDEBUG=1", "-g",
    ])
    #expect(try clangFlags(debug, language: "objective-c") == [
      "-std=gnu11", "-fobjc-arc", "-fobjc-weak", "-fmodules", "-gmodules", "-fpascal-strings", "-O0", "-fno-common",
      "-DDEBUG=1", "-DOBJC_OLD_DISPATCH_PROTOTYPES=0", "-g",
    ])
    #expect(try clangFlags(debug, language: "c++") == [
      "-std=gnu++14", "-stdlib=libc++", "-fmodules", "-fno-cxx-modules", "-gmodules",
      "-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_DEBUG", "-fpascal-strings", "-O0", "-fno-common", "-DDEBUG=1",
      "-g", "-fvisibility-inlines-hidden",
    ])
  }

  @Test func projectSettingsOverrideTheCDefaults() throws {
    let settings = BuildSettings(layers: [
      xcodeCompilerDefaults(), configurationPresets("Release"),
      [
        "CLANG_ENABLE_OBJC_ARC": "NO", "GCC_PREPROCESSOR_DEFINITIONS": "$(inherited) FEATURE=1",
        "OTHER_CFLAGS": "-fno-objc-exceptions", "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
        "CLANG_CXX_STANDARD_LIBRARY_HARDENING": "extensive",
      ],
    ])
    let objc = try clangFlags(settings, language: "objective-c")
    #expect(!objc.contains("-fobjc-arc"))
    #expect(objc.contains("-DFEATURE=1"))
    #expect(objc.last == "-fno-objc-exceptions")
    let cxx = try clangFlags(settings, language: "objective-c++")
    #expect(cxx.contains("-std=c++20"))
    #expect(cxx.contains("-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_EXTENSIVE"))
    // OTHER_CPLUSPLUSFLAGS defaults to OTHER_CFLAGS.
    #expect(cxx.last == "-fno-objc-exceptions")
  }

  @Test func missingSwiftVersionIsAnError() {
    #expect(throws: BuildError.self) { try swiftFlags(BuildSettings(layers: [])) }
  }

  @Test func triplesCarryTheDeploymentTarget() throws {
    let settings = BuildSettings(layers: [["MACOSX_DEPLOYMENT_TARGET": "15.0", "IPHONEOS_DEPLOYMENT_TARGET": "17.0"]])
    #expect(try Platform.macOS.triple(arch: "arm64", settings: settings) == "arm64-apple-macosx15.0")
    #expect(try Platform.iOS.triple(arch: "arm64", settings: settings) == "arm64-apple-ios17.0")
    #expect(try Platform.macCatalyst.triple(arch: "x86_64", settings: settings) == "x86_64-apple-ios17.0-macabi")
  }
}
