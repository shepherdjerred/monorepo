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
    targets: [
        .executableTarget(
            name: "GlanceApp",
            path: "Sources",
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
