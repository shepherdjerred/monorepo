// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "MailMateCodeFill",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "MailMateCodeFillShared", targets: ["MailMateCodeFillShared"]),
        .executable(name: "MailMateCodeFillHelper", targets: ["MailMateCodeFillHelper"]),
    ],
    targets: [
        .target(
            name: "MailMateCodeFillShared",
            path: "Sources/MailMateCodeFillShared"
        ),
        .executableTarget(
            name: "MailMateCodeFillHelper",
            dependencies: ["MailMateCodeFillShared"],
            path: "Sources/MailMateCodeFillHelper",
            exclude: ["Info.plist"]
        ),
        .testTarget(
            name: "MailMateCodeFillTests",
            dependencies: ["MailMateCodeFillShared"],
            path: "Tests/MailMateCodeFillTests",
            resources: [.copy("Fixtures")]
        ),
    ]
)
