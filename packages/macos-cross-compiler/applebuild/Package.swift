// swift-tools-version: 6.1
//
// `applebuild`: builds an XcodeGen application target on Linux.
//
// The app's `project.yml` stays the single source of truth for bundle
// settings. Package products are compiled by SwiftPM (as Xcode does); the
// application target itself is compiled and linked with `swiftc` from the
// resolved Xcode build settings; then the `.app` is assembled and signed.

import PackageDescription

let package = Package(
  name: "applebuild",
  platforms: [.macOS(.v15)],
  dependencies: [
    .package(url: "https://github.com/jpsim/Yams.git", exact: "6.2.2")
  ],
  targets: [
    .executableTarget(
      name: "applebuild",
      dependencies: [.product(name: "Yams", package: "Yams")],
      swiftSettings: [.swiftLanguageMode(.v6)]
    ),
    .testTarget(
      name: "applebuildTests",
      dependencies: ["applebuild"],
      swiftSettings: [.swiftLanguageMode(.v6)]
    ),
  ]
)
