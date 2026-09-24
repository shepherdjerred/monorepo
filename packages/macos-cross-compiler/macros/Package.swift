// swift-tools-version: 6.1
//
// Linux implementations of the SwiftUI macros whose Apple plugins ship only as
// closed-source macOS binaries inside Xcode (`SwiftUIMacros`, `PreviewsMacros`).
//
// The compiler resolves `#externalMacro(module: "SwiftUIMacros", type: …)` to
// whichever plugin executable claims that module name, so this one executable
// is loaded for both modules with
// `-load-plugin-executable <path>#SwiftUIMacros,PreviewsMacros`.
//
// Every expansion reproduces the one Xcode 27's plugin emits; the tests pin
// them against expansions captured with `-Xfrontend -dump-macro-expansions`.

import CompilerPluginSupport
import PackageDescription

let syntax: [Target.Dependency] = [
  .product(name: "SwiftSyntax", package: "swift-syntax"),
  .product(name: "SwiftSyntaxBuilder", package: "swift-syntax"),
  .product(name: "SwiftSyntaxMacros", package: "swift-syntax"),
]
let settings: [SwiftSetting] = [.swiftLanguageMode(.v6)]

let package = Package(
  name: "AppleMacros",
  platforms: [.macOS(.v15)],
  dependencies: [
    .package(url: "https://github.com/swiftlang/swift-syntax.git", exact: "603.0.2")
  ],
  targets: [
    // swift-syntax resolves a macro by matching `String(reflecting: type)`
    // against "<module>.<type>", so the implementations must live in modules
    // carrying Apple's plugin module names.
    .target(name: "MacroSupport", dependencies: syntax, swiftSettings: settings),
    .target(name: "SwiftUIMacros", dependencies: syntax + ["MacroSupport"], swiftSettings: settings),
    .target(name: "PreviewsMacros", dependencies: syntax + ["MacroSupport"], swiftSettings: settings),
    .executableTarget(
      name: "AppleMacros",
      dependencies: [
        "SwiftUIMacros", "PreviewsMacros",
        .product(name: "SwiftCompilerPlugin", package: "swift-syntax"),
      ],
      swiftSettings: settings
    ),
  ]
)
