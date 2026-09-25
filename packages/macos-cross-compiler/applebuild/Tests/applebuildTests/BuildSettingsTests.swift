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
