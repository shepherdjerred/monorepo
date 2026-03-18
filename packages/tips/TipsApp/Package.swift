// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "TipsApp",
    platforms: [
        .macOS(.v15),
    ],
    dependencies: [
        .package(url: "https://github.com/jpsim/Yams.git", from: "6.0.0"),
        .package(url: "https://github.com/swiftlang/swift-markdown.git", from: "0.5.0"),
    ],
    targets: [
        .executableTarget(
            name: "TipsApp",
            dependencies: [
                "Yams",
                .product(name: "Markdown", package: "swift-markdown"),
            ],
            path: "Sources",
            swiftSettings: [
                .swiftLanguageMode(.v6),
                .enableUpcomingFeature("ExistentialAny"),
                .enableUpcomingFeature("InternalImportsByDefault"),
            ]
        ),
        .testTarget(
            name: "TipsAppTests",
            dependencies: [
                "TipsApp",
                "Yams",
                .product(name: "Markdown", package: "swift-markdown"),
            ],
            path: "Tests",
            swiftSettings: [
                .swiftLanguageMode(.v6),
                .enableUpcomingFeature("ExistentialAny"),
                .enableUpcomingFeature("InternalImportsByDefault"),
            ]
        ),
    ]
)
