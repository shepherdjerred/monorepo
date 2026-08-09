// swift-tools-version: 6.2
//
// The Swift face of the TaskNotes core.
//
// Two targets, deliberately:
//
//   * `TaskNotesCoreFFI` — a `binaryTarget` wrapping the XCFramework that
//     `cargo xtask build-xcframework` produces. It is a **static** library, so
//     it is never a nested signed item inside the app bundle and the whole
//     notarization failure class for embedded binaries does not apply.
//   * `TaskNotesCore` — the generated Swift in `Sources/`, committed so that
//     `cargo xtask check-bindings` can diff it. It is machine-generated and
//     never hand-edited.
//
// Cargo is never invoked from an Xcode build phase. `cargo xtask` is the only
// thing that drives a build; this manifest only consumes its output.

import PackageDescription

let package = Package(
    name: "TaskNotesCore",
    // macOS 15 is the deployment target from the plan, and matches the
    // `MACOSX_DEPLOYMENT_TARGET` the xtask pins for the Rust build. iOS is
    // listed because the iOS app is meant to adopt this package later; build
    // its slice with `cargo xtask build-xcframework --platform ios`.
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "TaskNotesCore", type: .dynamic, targets: ["TaskNotesCore"])
    ],
    targets: [
        .binaryTarget(
            name: "TaskNotesCoreFFI",
            // A local path for development. A release consumer switches this to
            // `url:` + `checksum:`; that is a Phase 7 packaging decision and
            // deliberately not made here.
            path: "artifacts/TaskNotesCoreFFI.xcframework"
        ),
        .target(
            name: "TaskNotesCore",
            dependencies: ["TaskNotesCoreFFI"],
            // Generated code is exempt; authored code is maximal.
            //
            // This target is machine-generated and regenerated on every build,
            // so it gets only the two settings it *needs* and none of the
            // repository's lint posture. Measured during the Phase 6 spike:
            // `.strictMemorySafety()` produces 37 errors here that are not
            // post-processable (116 of the 288 warnings are "expression uses
            // unsafe constructs" on arbitrary expressions, and the flag is
            // module-wide with no file-level opt-out); `ExistentialAny` adds
            // 19 and `InternalImportsByDefault` 65. Running `sed` over
            // generated code to appease a linter would buy lint coverage on
            // code no human reads, in exchange for a brittle transform to
            // maintain across every uniffi upgrade.
            //
            // The spike also verified this costs nothing: a consumer target
            // keeps `.strictMemorySafety()` and `.treatAllWarnings(as: .error)`
            // and builds clean while calling in — unsafety does not leak across
            // the module boundary. Generated code is guarded by the committed
            // bindings diff instead, which catches the failure that actually
            // matters here (silent `Record` reordering) and that no lint would
            // ever have caught.
            swiftSettings: [
                .swiftLanguageMode(.v6),
                // Required, not stylistic: uniffi-rs#2818 makes the generated
                // bindings uncompilable under `MainActor` default isolation as
                // soon as a callback interface has a throwing method — which is
                // exactly the sans-I/O shape, where HTTP and storage are traits
                // the host implements.
                .defaultIsolation(nil)
            ]
        )
    ]
)
