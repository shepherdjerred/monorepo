import Foundation
import Testing

@testable import applebuild

/// Targets resolved from a real project.yml, against what Xcode 27 reports
/// (`xcodebuild -showBuildSettings`) for the same XcodeGen project.
@Suite struct TargetTests {
  /// A throwaway project: an app, its hosted unit tests, and mixed sources.
  private func project() throws -> ProjectSpec {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("applebuild-\(UUID().uuidString)")
    let files = [
      "App/App.swift": "", "App/Bridge.h": "", "App/Legacy.m": "", "App/Math.c": "", "App/Engine.cpp": "",
      "Tests/AppTests.swift": "",
      "project.yml": """
        name: Sample
        options: {bundleIdPrefix: dev.example, deploymentTarget: {macOS: "15.0"}}
        settings: {base: {SWIFT_VERSION: "6"}}
        targets:
          Sample: {type: application, platform: macOS, sources: [App]}
          SampleTests:
            type: bundle.unit-test
            platform: macOS
            sources: [Tests]
            dependencies: [{target: Sample}]
          SampleUITests: {type: bundle.ui-testing, platform: macOS, sources: [Tests]}
        """,
    ]
    for (path, contents) in files {
      let url = root.appendingPathComponent(path)
      try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try Data(contents.utf8).write(to: url)
    }
    return try ProjectSpec(path: root.appendingPathComponent("project.yml"))
  }

  @Test func unitTestBundlesResolveLikeXcode() throws {
    let target = try AppTarget(spec: try project(), name: "SampleTests", platform: nil, configuration: "Debug")
    #expect(target.productType == .unitTest)
    #expect(target.host == "Sample")
    #expect(target.settings["WRAPPER_NAME"] == "SampleTests.xctest")
    #expect(target.settings["PRODUCT_BUNDLE_PACKAGE_TYPE"] == "BNDL")
    // Xcode reports " @loader_path/../Frameworks @executable_path/../Frameworks @loader_path/../Frameworks".
    #expect(target.settings.list("LD_RUNPATH_SEARCH_PATHS") == [
      "@loader_path/../Frameworks", "@executable_path/../Frameworks", "@loader_path/../Frameworks",
    ])
  }

  @Test func applicationsKeepTheirOwnLayout() throws {
    let target = try AppTarget(spec: try project(), name: "Sample", platform: nil, configuration: "Release")
    #expect(target.productType == .application)
    #expect(target.settings["WRAPPER_NAME"] == "Sample.app")
    #expect(target.settings["PRODUCT_BUNDLE_PACKAGE_TYPE"] == "APPL")
    #expect(target.settings.list("LD_RUNPATH_SEARCH_PATHS") == ["@executable_path/../Frameworks"])
  }

  @Test func sourcesAreClassifiedByBuildRule() throws {
    let target = try AppTarget(spec: try project(), name: "Sample", platform: nil, configuration: "Release")
    #expect(target.swiftSources.map(\.lastPathComponent) == ["App.swift"])
    #expect(target.cFamilySources.map(\.lastPathComponent) == ["Engine.cpp", "Legacy.m", "Math.c"])
    #expect(target.headerDirectories.map(\.lastPathComponent) == ["App"])
    // Headers are neither compiled nor copied.
    #expect(target.resources.isEmpty)
  }

  @Test func uiTestBundlesAreRejectedByName() throws {
    #expect(throws: BuildError.self) {
      try AppTarget(spec: try project(), name: "SampleUITests", platform: nil, configuration: "Debug")
    }
  }
}
