// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "QuickTipApp",
    platforms: [
        .macOS(.v15)
    ],
    dependencies: [
        .package(url: "https://github.com/jpsim/Yams.git", from: "6.2.1"),
        .package(url: "https://github.com/swiftlang/swift-markdown.git", from: "0.7.3")
    ],
    targets: [
        .executableTarget(
            name: "QuickTipApp",
            dependencies: [
                "Yams",
                .product(name: "Markdown", package: "swift-markdown")
            ],
            path: "Sources",

            resources: [
                .process("Resources")
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
                .enableUpcomingFeature("ExistentialAny"),
                .enableUpcomingFeature("InternalImportsByDefault")
            ]
        ),
        .testTarget(
            name: "QuickTipAppTests",
            dependencies: [
                "QuickTipApp",
                "Yams",
                .product(name: "Markdown", package: "swift-markdown")
            ],
            path: "Tests",
            swiftSettings: [
                .swiftLanguageMode(.v6),
                .enableUpcomingFeature("ExistentialAny"),
                .enableUpcomingFeature("InternalImportsByDefault")
            ]
        )
    ]
)
