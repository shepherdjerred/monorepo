// swift-tools-version: 6.1

import PackageDescription

let strictSwiftSettings: [SwiftSetting] = [
  .swiftLanguageMode(.v6),
  .enableUpcomingFeature("ExistentialAny"),
  .enableUpcomingFeature("InternalImportsByDefault"),
]

let package = Package(
  name: "HKCTL",
  platforms: [
    .macOS(.v15),
    .iOS(.v17),
  ],
  products: [
    .library(name: "HKCTLCore", targets: ["HKCTLCore"])
  ],
  targets: [
    .target(
      name: "HKCTLCore",
      path: "Sources/HKCTLCore",
      swiftSettings: strictSwiftSettings,
    ),
    .testTarget(
      name: "HKCTLCoreTests",
      dependencies: ["HKCTLCore"],
      path: "Tests/HKCTLCoreTests",
      swiftSettings: strictSwiftSettings,
    ),
  ],
)
