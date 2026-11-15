// swift-tools-version: 6.1

import PackageDescription

let strictSwiftSettings: [SwiftSetting] = [
  .swiftLanguageMode(.v6),
  .enableUpcomingFeature("ExistentialAny"),
  .enableUpcomingFeature("InternalImportsByDefault"),
]

let package = Package(
  name: "QuotaBar",
  platforms: [
    .macOS(.v15)
  ],
  products: [
    .library(name: "QuotaBarCore", targets: ["QuotaBarCore"]),
    .executable(name: "QuotaBar", targets: ["QuotaBar"]),
  ],
  targets: [
    .target(
      name: "QuotaBarCore",
      path: "Sources/QuotaBarCore",
      swiftSettings: strictSwiftSettings,
    ),
    .executableTarget(
      name: "QuotaBar",
      dependencies: ["QuotaBarCore"],
      path: "Sources/QuotaBar",
      resources: [.process("Resources")],
      swiftSettings: strictSwiftSettings,
    ),
    .testTarget(
      name: "QuotaBarCoreTests",
      dependencies: ["QuotaBarCore"],
      path: "Tests/QuotaBarCoreTests",
      resources: [.process("Fixtures")],
      swiftSettings: strictSwiftSettings,
    ),
  ],
)
