// swift-tools-version: 6.2
//
// Native Apple client libraries for Facet over SQLite3 and `/api/v1/sync`.
//
// Three library products:
//   * `TaskNotesKit` — portable Foundation + SQLite3 sync, persistence, Keychain,
//     quick-capture NLP, RFC 5545 recurrence, filter evaluation, and Markdown
//     blocks. **Zero SwiftUI/AppKit/UIKit imports**.
//   * `TaskNotesFacetUI` — shared MainActor SwiftUI workspace, task inspector,
//     Kanban boards, capture sheet, sensory feedback, and settings used by both
//     macOS and iOS.
//   * `TaskNotesMac` — macOS-specific environment, non-activating Quick Add
//     `NSPanel` with global hotkey, menu commands, and window restoration.

import PackageDescription

let authoredSwiftSettings: [SwiftSetting] = [
    .swiftLanguageMode(.v6),
    .strictMemorySafety(),
    .treatAllWarnings(as: .error),
    .enableUpcomingFeature("ExistentialAny"),
    .enableUpcomingFeature("MemberImportVisibility"),
    .enableUpcomingFeature("InternalImportsByDefault"),
    .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
    .enableUpcomingFeature("InferIsolatedConformances"),
]

let package = Package(
    name: "TaskNotesMac",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "TaskNotesKit", targets: ["TaskNotesKit"]),
        .library(name: "TaskNotesMac", targets: ["TaskNotesMac"]),
        .library(name: "TaskNotesFacetUI", targets: ["TaskNotesFacetUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/sindresorhus/KeyboardShortcuts.git", from: "3.1.0")
    ],
    targets: [
        .target(
            name: "TaskNotesKit",
            dependencies: [],
            resources: [
                .copy("Presentation/FacetPresentationTokens.json"),
                .copy("Presentation/FacetPresentationSchema.json"),
                .copy("Presentation/FacetColorPolicy.json"),
                .copy("Presentation/FacetFeedbackPolicy.json"),
                .copy("Presentation/FacetFeedbackSchema.json"),
            ],
            swiftSettings: authoredSwiftSettings + [.defaultIsolation(nil)]
        ),
        .target(
            name: "TaskNotesFacetUI",
            dependencies: ["TaskNotesKit"],
            resources: [
                .copy("Presentation/Sounds/complete.wav"),
                .copy("Presentation/Sounds/create.wav"),
                .copy("Presentation/Sounds/delete.wav"),
                .copy("Presentation/Sounds/reverse.wav"),
                .copy("Presentation/Sounds/palette.json"),
            ],
            swiftSettings: authoredSwiftSettings + [.defaultIsolation(MainActor.self)]
        ),
        .target(
            name: "TaskNotesMac",
            dependencies: [
                "TaskNotesKit",
                "TaskNotesFacetUI",
                .product(name: "KeyboardShortcuts", package: "KeyboardShortcuts"),
            ],
            swiftSettings: authoredSwiftSettings + [.defaultIsolation(MainActor.self)]
        ),
        .target(
            name: "TaskNotesTestSupport",
            path: "Tests/Support",
            swiftSettings: authoredSwiftSettings + [.defaultIsolation(nil)]
        ),
        .testTarget(
            name: "TaskNotesKitTests",
            dependencies: ["TaskNotesKit", "TaskNotesTestSupport"],
            resources: [],
            swiftSettings: authoredSwiftSettings + [.defaultIsolation(nil)]
        ),
        .testTarget(
            name: "TaskNotesMacTests",
            dependencies: [
                "TaskNotesMac",
                "TaskNotesKit",
                "TaskNotesFacetUI",
                "TaskNotesTestSupport",
            ],
            resources: [],
            swiftSettings: authoredSwiftSettings + [.defaultIsolation(MainActor.self)]
        ),
    ]
)
