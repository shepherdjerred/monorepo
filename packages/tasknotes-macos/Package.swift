// swift-tools-version: 6.2
//
// The native macOS client for TaskNotes, over the shared Rust core.
//
// Three targets, and the split is load-bearing:
//
//   * `TaskNotesUniFFI` — the seam onto the machine-generated UniFFI bindings.
//     Lint-exempt by design (see below).
//   * `TaskNotesKit` — all portable logic. **Zero SwiftUI/AppKit imports**, so
//     it compiles and tests without a GUI. That rule is what keeps the bulk of
//     the Swift correctness story inside a headless test target rather than
//     behind a Mac-only UI gate.
//   * `TaskNotesMac` — SwiftUI views, scenes and commands. `MainActor`-isolated
//     by default; the only target that is.
//
// The Xcode application target (`project.yml`) links the `TaskNotesMac`
// product and supplies nothing but the `@main` entry point in `App/`. Both
// build systems therefore compile the same library sources with the same
// settings, and there is no second copy of the UI to keep in sync.
//
// **No `unsafeFlags` anywhere.** A package that uses them cannot be consumed as
// a versioned dependency, and the iOS app is meant to adopt this package later.
// Everything the repository's Swift posture needs has a first-class API as of
// tools-version 6.2.

import PackageDescription

// Authored Swift gets every gate. This is the "no type assertions / strong
// static typing / no suppressions / let the compiler work" posture from the
// root AGENTS.md, expressed in the compiler rather than in a linter.
//
//   .swiftLanguageMode(.v6)      Swift 6 mode — *not* the Xcode template
//                                default, which is still 5.0 in Xcode 27.
//                                Implies `-strict-concurrency=complete`.
//   .strictMemorySafety()        the "no type assertions" gate: every use of
//                                an unsafe construct must be spelled `unsafe`.
//   .treatAllWarnings(as: .error) warnings-as-errors.
//   ExistentialAny               bare `any`-less existentials become errors.
//   MemberImportVisibility       a member requires importing its own module.
//   InternalImportsByDefault     `import` is internal unless marked public.
//
// SwiftPM has no `SWIFT_APPROACHABLE_CONCURRENCY` umbrella, so its members are
// listed individually.
//
// ⚠️ Measured, not assumed: three of that umbrella's members —
// `InferSendableFromCaptures`, `GlobalActorIsolatedTypesUsability`, and
// `DisableOutwardActorInference` — are *already on* in the Swift 6 language
// mode, and naming them produces `upcoming feature '…' already enabled as of
// the Swift 6 language mode`. Under `.treatAllWarnings(as: .error)` that is a
// hard build failure, so listing the umbrella's full membership here is wrong.
// Only the two that are still upcoming in Swift 6.4 belong.
let authoredSwiftSettings: [SwiftSetting] = [
    .swiftLanguageMode(.v6),
    .strictMemorySafety(),
    .treatAllWarnings(as: .error),
    .enableUpcomingFeature("ExistentialAny"),
    .enableUpcomingFeature("MemberImportVisibility"),
    .enableUpcomingFeature("InternalImportsByDefault"),
    // SWIFT_APPROACHABLE_CONCURRENCY, minus what Swift 6 mode already implies.
    .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
    .enableUpcomingFeature("InferIsolatedConformances"),
]

let package = Package(
    name: "TaskNotesMac",
    // macOS 15 is the deployment target decided in the plan, and matches the
    // `MACOSX_DEPLOYMENT_TARGET` the Rust xtask pins.
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "TaskNotesKit", targets: ["TaskNotesKit"]),
        .library(name: "TaskNotesMac", targets: ["TaskNotesMac"]),
    ],
    dependencies: [
        // The committed bindings package. `cargo xtask build-xcframework`
        // produces the XCFramework it wraps; the generated Swift itself is
        // committed and guarded by `cargo xtask check-bindings`.
        .package(path: "../tasknotes-core/bindings"),

        // The global hotkey that opens the quick-add panel.
        //
        // Named in the plan's dependency list, and the alternative is worse in
        // a way that is not obvious: this wraps Carbon's `RegisterEventHotKey`,
        // which needs **no** permission at all, while the only other way to see
        // a keystroke the app did not receive is a `CGEventTap`, which needs
        // Accessibility. A task app that demands "control your computer" on
        // first launch to give you a text field is not shipping.
        .package(url: "https://github.com/sindresorhus/KeyboardShortcuts.git", from: "3.0.1"),
    ],
    targets: [
        // ── Generated code is exempt; authored code is maximal. ────────────
        //
        // This target is the seam onto machine-generated bindings. It carries
        // *only* the two settings the generated module itself requires, and
        // none of the repository's lint posture.
        //
        // Measured during the Phase 6 spike (Swift 6.4 / Xcode 27), not
        // guessed: on the generated bindings `.strictMemorySafety()` produces
        // 37 errors, `ExistentialAny` 19, `InternalImportsByDefault` 65, and
        // all the gates together 119. The 37 are **not** post-processable —
        // 116 of the underlying warnings are "expression uses unsafe
        // constructs" on arbitrary expressions and the flag is module-wide with
        // no file-level opt-out. Running `sed` over generated code to appease a
        // linter buys lint coverage on code no human reads, in exchange for a
        // brittle transform to maintain across every uniffi upgrade.
        //
        // This costs nothing, and that is also measured: `TaskNotesKit` keeps
        // `.strictMemorySafety()` *and* `.treatAllWarnings(as: .error)` and
        // builds clean while calling in. Unsafety does not leak across the
        // module boundary, so every gate still covers 100% of authored Swift.
        // Generated code is guarded by the committed `bindings/` diff instead,
        // which catches the failure that actually matters there (silent
        // `Record` reordering) and that no lint would ever have caught.
        .target(
            name: "TaskNotesUniFFI",
            dependencies: [
                // `package:` is the *identity* of a path dependency, which
                // SwiftPM derives from the last path component — hence
                // `bindings`, not the manifest's `name:`.
                .product(name: "TaskNotesCore", package: "bindings")
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
                // Required, not stylistic, and it looks unused — do not remove.
                // uniffi-rs#2818 makes the generated bindings uncompilable under
                // `MainActor` default isolation as soon as a callback interface
                // has a throwing method, which is exactly the sans-I/O shape the
                // core is built around. This target re-exports that module, so
                // it must agree with it.
                .defaultIsolation(nil),
            ]
        ),

        // ── Portable logic. No SwiftUI. No AppKit. ─────────────────────────
        //
        // Enforced by `scripts/check-no-ui-imports.sh`, wired into `bun run
        // lint`. The rule is load-bearing rather than tidy: the plan's testing
        // strategy puts Swift unit and snapshot coverage in a headless target,
        // and anything that reaches for SwiftUI here silently moves that
        // coverage behind a Mac-GUI-only gate.
        .target(
            name: "TaskNotesKit",
            dependencies: ["TaskNotesUniFFI"],
            swiftSettings: authoredSwiftSettings + [.defaultIsolation(nil)]
        ),

        // ── SwiftUI shell. ────────────────────────────────────────────────
        //
        // The only target with `MainActor` default isolation. Views, scenes,
        // and commands live here; the `@main` entry point lives in `App/` and
        // belongs to the Xcode application target.
        .target(
            name: "TaskNotesMac",
            dependencies: [
                "TaskNotesKit",
                "TaskNotesUniFFI",
                // Only this target. The hotkey library imports Cocoa, so it can
                // never reach `TaskNotesKit` without breaking the
                // no-UI-imports rule `ci/no-suppressions.sh` enforces.
                .product(name: "KeyboardShortcuts", package: "KeyboardShortcuts"),
            ],
            swiftSettings: authoredSwiftSettings + [.defaultIsolation(MainActor.self)]
        ),

        // ── Shared test harness. ───────────────────────────────────────────
        //
        // A plain target rather than a test target, and that is forced rather
        // than stylistic: **a test target cannot import another test target.**
        // The server harness was needed by `TaskNotesKitTests` (the engine
        // against a real server) and is now also needed by `TaskNotesMacTests`
        // (`AppEnvironment` at launch against a real server) — and the second is
        // the one that matters, because the launch path is what shipped broken.
        //
        // Deliberately **not** in `products:`. Nothing outside this package
        // should be able to link a harness that spawns subprocesses; keeping it
        // unexported means the only consumers are the two test targets below.
        //
        // It carries `authoredSwiftSettings` like every other authored target,
        // and `ci/no-suppressions.sh` checks `.target(` as well as
        // `.testTarget(`, so the lint posture here is enforced identically.
        .target(
            name: "TaskNotesTestSupport",
            path: "Tests/Support",
            swiftSettings: authoredSwiftSettings + [.defaultIsolation(nil)]
        ),

        .testTarget(
            name: "TaskNotesKitTests",
            dependencies: ["TaskNotesKit", "TaskNotesTestSupport", "TaskNotesUniFFI"],
            swiftSettings: authoredSwiftSettings + [.defaultIsolation(nil)]
        ),

        // ── The image-snapshot layer. ──────────────────────────────────────
        //
        // The one test target that is allowed to touch SwiftUI, because it
        // renders it. `TaskNotesKit` has no UI imports by design and
        // `ci/no-suppressions.sh` enforces that, so a test that puts a view on
        // screen cannot live in `TaskNotesKitTests`; it belongs beside the
        // views instead.
        //
        // `MainActor` default isolation, matching `TaskNotesMac`: every type
        // under test is main-actor-isolated, and so is `NSHostingView`.
        //
        // The plan's testing table places this row at "local + Xcode Cloud"
        // rather than in the Linux gate, and the package's `lint` task is still
        // the only thing `bun run verify` runs. Nothing here changes that.
        .testTarget(
            name: "TaskNotesMacTests",
            dependencies: [
                "TaskNotesMac", "TaskNotesKit", "TaskNotesTestSupport", "TaskNotesUniFFI",
            ],
            swiftSettings: authoredSwiftSettings + [.defaultIsolation(MainActor.self)]
        ),
    ]
)
