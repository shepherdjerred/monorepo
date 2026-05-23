// swift-tools-version: 6.1

import PackageDescription

let strictSwiftSettings: [SwiftSetting] = [
    .swiftLanguageMode(.v6),
    .enableUpcomingFeature("ExistentialAny"),
    .enableUpcomingFeature("InternalImportsByDefault"),
]

let package = Package(
    name: "GlanceApp",
    platforms: [
        .macOS(.v15),
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.10.0"),
    ],
    targets: [
        .executableTarget(
            name: "GlanceApp",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
            ],
            path: "Sources",
            resources: [
                .process("Localizable.xcstrings"),
            ],
            swiftSettings: strictSwiftSettings,
        ),
        .testTarget(
            name: "GlanceAppTests",
            dependencies: [
                "GlanceApp",
            ],
            path: "Tests",
            swiftSettings: strictSwiftSettings,
        ),
    ],
)
