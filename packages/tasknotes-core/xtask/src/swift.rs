//! The Swift binding and packaging pipeline.
//!
//! Modelled on `matrix-rust-sdk/xtask/src/swift.rs` rather than `cargo-swift`,
//! which has four open issues on exactly this path. The shape is:
//!
//! ```text
//! cargo build (per Apple target)
//!   → lipo, PER PLATFORM
//!   → uniffi-bindgen-swift
//!   → headers namespaced into headers/<Module>/
//!   → xcodebuild -create-xcframework
//! ```
//!
//! # Four things that are not optional
//!
//! 1. **`lipo` runs per platform, never across platforms.** `aarch64-apple-darwin`
//!    and `aarch64-apple-ios-sim` are both `arm64`; `lipo` refuses to put two
//!    slices of the same architecture in one fat file, and an XCFramework wants
//!    them as separate slices anyway.
//! 2. **`--module-name` is mandatory.** It defaults to the *library* basename,
//!    but the generated Swift imports `<namespace>FFI`. Without it the module
//!    the modulemap declares and the module the Swift imports have different
//!    names, `canImport` goes false, and the build fails with 139 `cannot find
//!    type 'RustBuffer' in scope` errors.
//! 3. **`--xcframework` must NOT be passed.** It prepends the `framework`
//!    keyword to the modulemap, which is only valid inside a real `.framework`
//!    bundle. We deliberately ship a **static library** via `-library` +
//!    `-headers`, which produces a plain `Headers/` slice; clang then silently
//!    declines to build the module — `-fsyntax-only` still exits 0 — and the
//!    import compiles out to the same 139 errors.
//! 4. **Anything that ships is built with `reldbg`, never `dev`.**
//!    matrix-rust-sdk hit `EXC_BAD_ACCESS` shipping dev-profile builds into an
//!    Apple host. `reldbg` is release codegen with full DWARF retained inside
//!    the archive's object files, which is what lets the *app's* link step
//!    produce a symbolicated `.dSYM` later. Binding generation is the one
//!    exception and defaults to `dev`: it never produces a shippable artifact,
//!    only reads metadata that is identical at every optimisation level.
//!
//! # `dsymutil` is deliberately absent
//!
//! It cannot process a static archive — measured: `dsymutil libfoo.a` fails
//! with *"The file was not recognized as a valid object file"*. `dsymutil`
//! consumes a *linked* Mach-O image plus its debug map, which for a static
//! library only exists once the host app links it. The plan's `dsymutil` step
//! therefore belongs to Phase 7, on the app binary; what this pipeline owes it
//! is the retained DWARF that `reldbg` provides.

use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::process;

/// The crate whose scaffolding is exported.
const FFI_CRATE: &str = "tasknotes-core-ffi";

/// The Apple static library cargo emits for [`FFI_CRATE`].
const APPLE_LIBRARY_FILE: &str = "libtasknotes_core_ffi.a";

/// The UniFFI namespace, and so the high-level Swift module name.
///
/// Set by `uniffi::setup_scaffolding!("TaskNotesCore")`.
const SWIFT_MODULE: &str = "TaskNotesCore";

/// The low-level C module the generated Swift imports.
///
/// UniFFI derives this as `<namespace>FFI` and there is no way to observe it
/// from the command line, which is exactly why `--module-name` has to be passed
/// explicitly and has to be this value.
const FFI_MODULE: &str = "TaskNotesCoreFFI";

/// The generated C header's filename, derived by UniFFI from [`FFI_MODULE`].
const HEADER_FILE: &str = "TaskNotesCoreFFI.h";

/// The modulemap filename, forced with `--modulemap-filename`.
///
/// `module.modulemap` is the name clang looks for when a directory is added to
/// the header search path; UniFFI would otherwise name it after the module.
const MODULEMAP_FILE: &str = "module.modulemap";

/// The XCFramework's name on disk.
const XCFRAMEWORK_NAME: &str = "TaskNotesCoreFFI.xcframework";

/// The git pathspecs that binding generation writes to.
///
/// Scoped to exactly the generated trees. `bindings/Package.swift` and
/// `bindings/README.md` are authored, and an uncommitted edit to either is not
/// a binding drift — folding them in would make gate 7 fire for the wrong
/// reason, which is how a gate gets ignored.
const GENERATED_PATHSPECS: [&str; 2] = ["bindings/Sources", "bindings/ffi"];

/// One Apple platform slice of the XCFramework.
///
/// A slice is a *platform*, not an architecture: several architectures are
/// `lipo`d into one static library per slice, and `xcodebuild` keys the slices
/// on platform + variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    /// macOS, universal across Apple silicon and Intel.
    MacOs,
    /// iOS devices.
    Ios,
    /// The iOS Simulator, universal across Apple silicon and Intel hosts.
    IosSimulator,
}

impl Platform {
    /// Parse the `--platform` spelling.
    ///
    /// # Errors
    ///
    /// Returns a message naming the accepted values.
    pub fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "macos" => Ok(Self::MacOs),
            "ios" => Ok(Self::Ios),
            "ios-sim" => Ok(Self::IosSimulator),
            other => Err(format!(
                "unknown platform {other:?}; expected one of macos, ios, ios-sim"
            )),
        }
    }

    /// The staging directory name, and the `--platform` spelling.
    const fn name(self) -> &'static str {
        match self {
            Self::MacOs => "macos",
            Self::Ios => "ios",
            Self::IosSimulator => "ios-sim",
        }
    }

    /// The rust targets `lipo`d into this slice.
    const fn targets(self) -> &'static [&'static str] {
        match self {
            Self::MacOs => &["aarch64-apple-darwin", "x86_64-apple-darwin"],
            Self::Ios => &["aarch64-apple-ios"],
            Self::IosSimulator => &["aarch64-apple-ios-sim", "x86_64-apple-ios"],
        }
    }

    /// The deployment-target environment for this slice.
    ///
    /// macOS 15 is the plan's deployment target and matches the SwiftPM
    /// manifest; a mismatch here produces a link-time warning per object file
    /// and, worse, a library usable on OS versions the app claims not to
    /// support.
    const fn deployment_environment(self) -> &'static [(&'static str, &'static str)] {
        match self {
            Self::MacOs => &[("MACOSX_DEPLOYMENT_TARGET", "15.0")],
            Self::Ios | Self::IosSimulator => &[("IPHONEOS_DEPLOYMENT_TARGET", "18.0")],
        }
    }
}

/// Regenerate the committed Swift bindings.
///
/// Runs anywhere the workspace compiles — no Apple SDK, no `xcodebuild`, no
/// Swift toolchain. UniFFI reads the exported metadata out of the built
/// library's symbol table, and that metadata is host-independent, so a Linux
/// CI run produces the same bytes a macOS developer commits. That is what makes
/// [`check_bindings`] usable as a per-PR Linux gate.
///
/// # Errors
///
/// Returns a message when a build, the generator, or a filesystem operation
/// fails.
pub fn generate_bindings(profile: &str) -> Result<String, String> {
    let root = workspace_root()?;

    let generator = build_bindgen(&root, profile)?;
    let library = build_library(&root, profile, None)?;

    let staging = root.join("target").join("bindings-staging");
    recreate_directory(&staging)?;

    // The flag set here is load-bearing in both directions: `--module-name` and
    // `--modulemap-filename` must be present, and `--xcframework` must not be.
    // See the module docs for what each omission or addition breaks.
    process::run(
        &generator.to_string_lossy(),
        &[
            "--swift-sources",
            "--headers",
            "--modulemap",
            "--module-name",
            FFI_MODULE,
            "--modulemap-filename",
            MODULEMAP_FILE,
            &library.to_string_lossy(),
            &staging.to_string_lossy(),
        ],
        &root,
    )?;

    // Generate into staging and copy into place, so a failed generation leaves
    // the committed bindings untouched rather than half-rewritten.
    let sources = root.join("bindings").join("Sources").join(SWIFT_MODULE);
    let ffi = root.join("bindings").join("ffi");
    create_directory(&sources)?;
    create_directory(&ffi)?;

    let swift_file = format!("{SWIFT_MODULE}.swift");
    copy(&staging.join(&swift_file), &sources.join(&swift_file))?;
    copy(&staging.join(HEADER_FILE), &ffi.join(HEADER_FILE))?;
    copy(&staging.join(MODULEMAP_FILE), &ffi.join(MODULEMAP_FILE))?;

    Ok(format!(
        "wrote bindings/Sources/{SWIFT_MODULE}/{swift_file}, bindings/ffi/{HEADER_FILE}, \
         bindings/ffi/{MODULEMAP_FILE}\n"
    ))
}

/// Gate 7: regenerate the bindings, then fail if the committed copy moved.
///
/// This is the **only** mechanical guard against UniFFI's silent
/// `Record`-reordering corruption. Measured during the Phase 6 spike: swapping
/// two same-typed record fields left all 16 API checksums identical *and* the
/// generated C header byte-identical — only the Swift changed.
/// `uniffiCheckApiChecksums()` does not detect it, no Rust lint detects it, and
/// nothing else in the toolchain does either.
///
/// Deliberately rewrites the working tree rather than diffing a temporary
/// directory: a developer who runs this locally and sees it fail already has
/// the corrected files staged for review.
///
/// # Errors
///
/// Returns a message when generation fails, when `git` reports a difference, or
/// when generation produced a file that is not tracked.
pub fn check_bindings(profile: &str) -> Result<String, String> {
    let root = workspace_root()?;
    let generated = generate_bindings(profile)?;
    print!("{generated}");

    let mut diff = vec!["diff", "--exit-code", "--"];
    diff.extend(GENERATED_PATHSPECS);
    let clean = process::succeeded("git", &diff, &root)?;
    if !clean {
        return Err(format!(
            "the committed Swift bindings are out of date (diff above).\n\
             \n\
             Run `cargo xtask generate-bindings` and commit bindings/.\n\
             \n\
             If the only change is the order of fields inside a generated `struct`, treat it as a \
             data-corruption bug and not as churn: UniFFI writes {SWIFT_MODULE} record fields \
             positionally into the FFI buffer, the runtime checksum does not detect a reorder, and \
             this diff is the only thing that will."
        ));
    }

    // A gate that cannot see its own subject is not a gate. If `bindings/` ever
    // ends up gitignored, everything here passes vacuously and the only
    // mechanical guard against `Record` reordering goes quiet — the same
    // failure mode `ci/no-suppressions.sh` exists to prevent for the lints.
    //
    // Two flags are load-bearing, and the first was wrong until Phase 6.5.
    //
    // ⚠️ **One pathspec per invocation.** `git check-ignore -q` rejects more
    // than one with *"--quiet is only valid with a single pathname"* and exits
    // non-zero — which reads as "not ignored" and made this check itself pass
    // vacuously. Found by watching the command fail while `check-bindings`
    // still reported success: exactly the inert-gate failure the comment above
    // is about, inside the guard against it.
    //
    // ⚠️ **`--no-index`.** Without it git skips a path that is currently
    // tracked, so the check would only fire once the damage was already done.
    // The subject here is the ignore *rules*, not today's index state: a
    // tracked-and-ignored `bindings/ffi` works right up until regeneration adds
    // a new file there, which then silently never gets committed.
    for pathspec in GENERATED_PATHSPECS {
        if process::succeeded(
            "git",
            &["check-ignore", "-q", "--no-index", "--", pathspec],
            &root,
        )? {
            return Err(format!(
                "{pathspec} is gitignored, so the drift check cannot see it. Only \
                 bindings/artifacts/ may be ignored; bindings/Sources/ and bindings/ffi/ are \
                 committed on purpose."
            ));
        }
    }

    let mut ls_files = vec!["ls-files", "--others", "--exclude-standard", "--"];
    ls_files.extend(GENERATED_PATHSPECS);
    let untracked = process::capture("git", &ls_files, &root)?;
    if !untracked.trim().is_empty() {
        return Err(format!(
            "binding generation produced files that are not tracked by git:\n{untracked}\n\
             Add them so the drift check can see them."
        ));
    }

    Ok("check-bindings: committed bindings match the generated bindings\n".to_owned())
}

/// Build the Apple static libraries and package them as an XCFramework.
///
/// macOS-only: needs `lipo` and `xcodebuild`.
///
/// # Errors
///
/// Returns a message when a build, `lipo`, `xcodebuild`, or a filesystem
/// operation fails.
pub fn build_xcframework(profile: &str, platforms: &[Platform]) -> Result<String, String> {
    let root = workspace_root()?;

    // Regenerate first, so the header and modulemap that go into the framework
    // describe the library that goes in beside them.
    print!("{}", generate_bindings(profile)?);

    let staging = root.join("target").join("xcframework");
    recreate_directory(&staging)?;

    let mut libraries = Vec::new();
    for platform in platforms {
        let mut slices = Vec::new();
        for target in platform.targets() {
            slices.push(build_library_for_platform(
                &root, profile, target, *platform,
            )?);
        }

        let slice_directory = staging.join(platform.name());
        create_directory(&slice_directory)?;
        let fat = slice_directory.join(APPLE_LIBRARY_FILE);

        // One `lipo` per platform. Never one across platforms: macOS arm64 and
        // iOS-Simulator arm64 are the same architecture, and `lipo` rejects a
        // fat file with two slices of one architecture.
        let mut arguments: Vec<String> = vec!["-create".to_owned()];
        for slice in &slices {
            arguments.push(slice.to_string_lossy().into_owned());
        }
        arguments.push("-output".to_owned());
        arguments.push(fat.to_string_lossy().into_owned());
        process::run("lipo", &arguments, &root)?;

        libraries.push(fat);
    }

    // Headers are namespaced into `headers/<Module>/` so the slice's `Headers/`
    // directory contains one directory per module rather than a flat pile —
    // which is what lets more than one UniFFI component share an XCFramework
    // later without their headers colliding.
    let headers = staging.join("headers");
    let module_headers = headers.join(FFI_MODULE);
    create_directory(&module_headers)?;
    let ffi = root.join("bindings").join("ffi");
    copy(&ffi.join(HEADER_FILE), &module_headers.join(HEADER_FILE))?;
    copy(
        &ffi.join(MODULEMAP_FILE),
        &module_headers.join(MODULEMAP_FILE),
    )?;

    let output = root
        .join("bindings")
        .join("artifacts")
        .join(XCFRAMEWORK_NAME);
    create_directory(&root.join("bindings").join("artifacts"))?;
    remove_directory(&output)?;

    let mut arguments: Vec<String> = vec!["-create-xcframework".to_owned()];
    for library in &libraries {
        arguments.push("-library".to_owned());
        arguments.push(library.to_string_lossy().into_owned());
        arguments.push("-headers".to_owned());
        arguments.push(headers.to_string_lossy().into_owned());
    }
    arguments.push("-output".to_owned());
    arguments.push(output.to_string_lossy().into_owned());
    process::run("xcodebuild", &arguments, &root)?;

    let names: Vec<&str> = platforms.iter().map(|platform| platform.name()).collect();
    Ok(format!(
        "built bindings/artifacts/{XCFRAMEWORK_NAME} with slices: {}\n",
        names.join(", ")
    ))
}

/// Fail if the built XCFramework is older than the committed bindings.
///
/// ## The failure this exists to name
///
/// `bindings/Sources` and `bindings/ffi` are **generated source** and are
/// committed; `bindings/artifacts/` is a **gitignored build artifact**. Nothing
/// couples them, because [`generate_bindings`] deliberately runs on any host —
/// that is what makes [`check_bindings`] a Linux per-PR gate — while
/// [`build_xcframework`] needs `xcodebuild` and `lipo`. So regenerating without
/// rebuilding leaves the Swift package declaring symbols the static library does
/// not export.
///
/// That presents as a wall of `Undefined symbol: _uniffi_…` at link time, which
/// reads as somebody else's half-finished edit rather than as a stale artifact.
/// On 2026-08-09 it cost four separate contributors a debugging detour, twice in
/// one session for one of them. The cost is not the rebuild; it is the minutes
/// spent misattributing the failure. This turns it into one line naming the
/// command.
///
/// ## Why modification time rather than a content hash
///
/// The question is not "do these agree" but "was one produced after the other",
/// and mtime answers exactly that with no stamp file to keep honest. It is
/// deliberately biased toward false positives: checking out a branch with older
/// bindings marks the artifact stale even though its contents may match. The
/// remedy in that case is the same command, so a spurious failure costs one
/// rebuild, while a missed one costs a debugging session. A missing artifact —
/// the fresh-clone case — is stale by definition.
///
/// # Errors
///
/// Returns a message when the artifact is missing or older than the generated
/// Swift, or when a path cannot be read.
pub fn check_xcframework() -> Result<String, String> {
    let root = workspace_root()?;
    let artifact = root
        .join("bindings")
        .join("artifacts")
        .join(XCFRAMEWORK_NAME);

    let rebuild = "cd packages/tasknotes-core && cargo xtask build-xcframework";

    if !artifact.exists() {
        return Err(format!(
            "bindings/artifacts/{XCFRAMEWORK_NAME} does not exist.\n\
             It is a gitignored build artifact, so a fresh clone never has one.\n\
             Build it with:\n    {rebuild}"
        ));
    }

    let generated = root
        .join("bindings")
        .join("Sources")
        .join(SWIFT_MODULE)
        .join(format!("{SWIFT_MODULE}.swift"));

    let artifact_time = modified_at(&artifact)?;
    let generated_time = modified_at(&generated)?;

    if artifact_time < generated_time {
        return Err(format!(
            "bindings/artifacts/{XCFRAMEWORK_NAME} is older than the committed \
             bindings.\n\
             The generated Swift declares symbols the built library may not \
             export yet, which surfaces as `Undefined symbol: _uniffi_…` at link \
             time rather than as a stale artifact.\n\
             Rebuild it with:\n    {rebuild}"
        ));
    }

    Ok(format!(
        "check-xcframework: bindings/artifacts/{XCFRAMEWORK_NAME} is newer than \
         the committed bindings\n"
    ))
}

/// The modification time of `path`, as a duration since the Unix epoch.
///
/// Returns the raw `SystemTime` comparison's inputs rather than the times
/// themselves so that a clock before 1970 — which would make `duration_since`
/// fail — is reported as the unreadable path it effectively is.
fn modified_at(path: &Path) -> Result<std::time::Duration, String> {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .map_err(|error| {
            format!(
                "cannot read the modification time of {}: {error}",
                path.display()
            )
        })?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| {
            format!(
                "{} has a modification time before the Unix epoch: {error}",
                path.display()
            )
        })
}

/// Build the XCFramework, then compile and run Swift against it.
///
/// A pipeline that produces artifacts nobody compiled is not verified. This
/// generates a throwaway SwiftPM package under `target/`, has it depend on
/// `bindings/` by path, and runs an executable that imports the module and
/// calls exported functions — so a failure to compile the generated Swift, a
/// broken modulemap, a missing symbol at link time, or a lifting bug at runtime
/// all fail here rather than in Phase 7.
///
/// # Errors
///
/// Returns a message when packaging, `swift build`, or `swift run` fails.
pub fn verify_swift(profile: &str, platforms: &[Platform]) -> Result<String, String> {
    let root = workspace_root()?;
    print!("{}", build_xcframework(profile, platforms)?);

    let smoke = root.join("target").join("swift-smoke");
    recreate_directory(&smoke)?;
    let sources = smoke.join("Sources").join("Smoke");
    create_directory(&sources)?;

    let bindings = root.join("bindings");
    // SwiftPM derives a path dependency's *identity* from its directory name,
    // not from the `name:` in its manifest, and `.product(package:)` wants the
    // identity. Deriving it here rather than hard-coding "bindings" keeps the
    // smoke package working if the directory is ever moved or renamed.
    let identity = bindings
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .ok_or_else(|| format!("{} has no directory name", bindings.display()))?;
    write(
        &smoke.join("Package.swift"),
        &smoke_manifest(&bindings.to_string_lossy(), &identity),
    )?;
    write(&sources.join("Hosts.swift"), HOSTS_SOURCE)?;
    write(&sources.join("main.swift"), SMOKE_SOURCE)?;

    process::run(
        "swift",
        &["run", "--package-path", &smoke.to_string_lossy()],
        &root,
    )?;

    Ok("verify-swift: the generated Swift compiled, linked, and ran\n".to_owned())
}

/// The throwaway package manifest used by [`verify_swift`].
fn smoke_manifest(bindings_path: &str, bindings_identity: &str) -> String {
    format!(
        r#"// swift-tools-version: 6.2
// Generated by `cargo xtask verify-swift`. Not committed; not a dependency of
// anything. Its only job is to prove the committed bindings compile, link, and
// run against the XCFramework this pipeline just built.
import PackageDescription

let package = Package(
    name: "Smoke",
    platforms: [.macOS(.v15)],
    dependencies: [.package(path: "{bindings_path}")],
    targets: [
        .executableTarget(
            name: "Smoke",
            dependencies: [.product(name: "{SWIFT_MODULE}", package: "{bindings_identity}")],
            swiftSettings: [
                .swiftLanguageMode(.v6),
                // Authored code, so it gets the maximal posture the plan
                // prescribes — and proves that unsafety does not leak out of
                // the lint-exempt generated module.
                .strictMemorySafety(),
                .treatAllWarnings(as: .error),
            ]
        )
    ]
)
"#
    )
}

/// Swift implementations of every exported host trait.
///
/// This file is the point of [`verify_swift`]. Everything else it checks could
/// in principle be inferred from the generated Swift; a **foreign trait** cannot
/// be, because it only works if the vtable UniFFI generates is registered, the
/// handle map round-trips, and a Swift `throws` becomes a Rust `Err` rather than
/// a trap. Every storage method below throws, which is exactly the shape that
/// reproduces uniffi-rs#2818 — so if the mitigation regressed, this file stops
/// compiling.
///
/// The implementations are deliberately minimal but not fake: an in-memory
/// store, a fixed clock, a recording scheduler, and — since Phase 4.5 — a whole
/// in-memory TaskNotes server sitting behind the *byte* transport a shell now
/// implements. That last one is what proves the moved boundary round-trips: the
/// Swift side never names a task, and the core builds the URL, escapes the vault
/// path, renames the wire fields, unwraps the envelope and decides what a 503
/// means.
const HOSTS_SOURCE: &str = r##"import Foundation
import Synchronization
import TaskNotesCore

/// Every mutable byte the host owns, in one place so the classes below can be
/// `Sendable` without an unchecked escape hatch. The exported protocols require
/// `Sendable`, and honouring it properly is part of what this proves.
struct HostState {
    var queue: String?
    var deadLetter: String?
    var tasks: [TaskNotesCore.Task] = []
    var idAliases: String?
    var idCounters: String?
    var lastSyncTime: Int64?
    var schemaVersion: UInt32 = 0
    var legacyQueue: String?
    var armedDelays: [Int64] = []
    var cancelledTimers: [TimerId] = []
    var nextTimer: UInt64 = 0
    /// Makes the next write fail, so a Swift-side storage failure can be
    /// observed arriving in Rust as a typed error rather than as a crash.
    var writesFail = false
}

/// An in-memory vault: the queue, the dead-letter list, the base task cache,
/// the alias map, the migration keys, and the retry timer.
///
/// One object implements four of the seven traits because a real shell will
/// too — they are all backed by the same store, and `QueueStorage.readQueue`
/// and `MigrationStorage.readQueue` are deliberately the same key.
final class MemoryHost: QueueStorage, TaskCacheStorage, MigrationStorage, RetryScheduler {
    let state = Mutex(HostState())

    private func guardWrites() throws {
        if state.withLock({ $0.writesFail }) {
            throw CoreError.Validation(message: "the smoke host was told to fail this write")
        }
    }

    // QueueStorage, and readQueue/writeQueue for MigrationStorage.
    func readQueue() throws -> String? { state.withLock { $0.queue } }
    func writeQueue(data: String) throws {
        try guardWrites()
        state.withLock { $0.queue = data }
    }
    func readDeadLetter() throws -> String? { state.withLock { $0.deadLetter } }
    func writeDeadLetter(data: String) throws {
        try guardWrites()
        state.withLock { $0.deadLetter = data }
    }

    // TaskCacheStorage.
    func readTasks() throws -> [TaskNotesCore.Task] { state.withLock { $0.tasks } }
    func writeTasks(tasks: [TaskNotesCore.Task]) throws {
        try guardWrites()
        state.withLock { $0.tasks = tasks }
    }
    func readIdAliases() throws -> String? { state.withLock { $0.idAliases } }
    func writeIdAliases(data: String) throws {
        try guardWrites()
        state.withLock { $0.idAliases = data }
    }
    func readIdCounters() throws -> String? { state.withLock { $0.idCounters } }
    func writeIdCounters(data: String) throws {
        try guardWrites()
        state.withLock { $0.idCounters = data }
    }
    func readLastSyncTime() throws -> Int64? { state.withLock { $0.lastSyncTime } }
    func writeLastSyncTime(millis: Int64) throws {
        try guardWrites()
        state.withLock { $0.lastSyncTime = millis }
    }

    // MigrationStorage.
    func readSchemaVersion() throws -> UInt32 { state.withLock { $0.schemaVersion } }
    func writeSchemaVersion(version: UInt32) throws {
        try guardWrites()
        state.withLock { $0.schemaVersion = version }
    }
    func readLegacyQueue() throws -> String? { state.withLock { $0.legacyQueue } }
    func removeLegacyQueue() throws { state.withLock { $0.legacyQueue = nil } }

    // RetryScheduler. Neither method throws or calls back into Rust: the host
    // fires a timer by calling `requestSync()` and then `settle()`.
    func arm(delayMillis: Int64) -> TimerId {
        state.withLock { host in
            host.armedDelays.append(delayMillis)
            let timer = host.nextTimer
            host.nextTimer += 1
            return timer
        }
    }
    func cancel(timer: TimerId) {
        state.withLock { $0.cancelledTimers.append(timer) }
    }
}

/// A clock frozen at 2025-06-15T15:06:40Z, so every optimistic timestamp the
/// core mints is reproducible.
final class FixedClock: Clock {
    static let millis: Int64 = 1_750_000_000_000
    func nowMillis() -> Int64 { Self.millis }
    func localYmd(millis: Int64) -> String { "2025-06-15" }
}

/// Exactly half a unit, which is the parts-per-million spelling of the `0.5`
/// the shared scenario fixtures inject — so the backoff comes out as the bare
/// `[1000, 2000, …]` schedule with no jitter.
final class HalfUnit: Randomness {
    func nextUnitPpm() -> UInt32 { 500_000 }
}

/// A whole TaskNotes server, in memory, behind the byte transport the shell
/// actually implements.
///
/// This is the point of Phase 4.5, made executable. The class below knows
/// nothing about tasks: it sees a method, an absolute URL, headers and bytes,
/// and it answers with a status and bytes. Every part of the wire boundary that
/// used to live in Swift — the URL, the percent-escaping of a vault path, the
/// `customProperties` rename, the response envelope, and the HTTP-status →
/// error mapping the retry classifier reads — is exercised here from the *core*
/// side, and the assertions in `smokeSync` check the core got each one right.
final class SmokeServer: HttpClient {
    /// What the next request gets.
    enum Mode {
        /// A transport failure. Must reach the Rust classifier as transient.
        case offline
        /// A 503. Must *also* reach it as transient — and that decision is now
        /// the core's, which is the retry hazard this phase closed.
        case failing
        /// A real answer.
        case serving
    }

    struct State {
        var mode: Mode = .offline
        var requests: [HttpRequest] = []
        var cancels = 0
    }

    /// One task, with its unmodelled frontmatter keys in vault order.
    ///
    /// `zebra` before `apple` before `mango` is deliberately not alphabetical:
    /// Foundation has no ordered JSON type, so while the wire boundary lived in
    /// Swift these keys were reordered in both directions — and the server
    /// writes YAML frontmatter from them, so a read-then-write rewrote the
    /// user's file. `smokeSync` asserts the order survives.
    static let taskJSON = #"{"path":"TaskNotes/pulled.md","title":"Pulled from the server","status":"open","priority":"normal","customProperties":{"zebra":1,"apple":2,"mango":3}}"#

    let state = Mutex(State())

    func send(request: HttpRequest) throws -> HttpResponse {
        let mode = state.withLock { host -> Mode in
            host.requests.append(request)
            return host.mode
        }
        switch mode {
        case .offline:
            // A transport failure carries no status, by construction: the enum
            // cannot express one. Turning this into a transient `Connection` is
            // core policy now, not shell policy.
            throw TransportError.Offline(message: "the smoke server is unplugged")
        case .failing:
            return Self.response(status: 503, json: "upstream is restarting")
        case .serving:
            return Self.answer(request)
        }
    }

    func cancelAll() {
        state.withLock { $0.cancels += 1 }
    }

    /// Route on the method alone: the engine only ever sends one shape of each.
    private static func answer(_ request: HttpRequest) -> HttpResponse {
        switch request.method {
        case .get:
            // Envelope-wrapped, so the core's `unwrap_envelope` is exercised.
            return response(
                status: 200,
                json: #"{"success":true,"data":{"tasks":[\#(taskJSON)],"pagination":{"total":1,"offset":0,"limit":200,"hasMore":false}}}"#
            )
        case .delete:
            // Upstream answers `{ message }`, not `{ success }`.
            return response(status: 200, json: #"{"message":"deleted"}"#)
        case .post, .put:
            return response(status: 200, json: taskJSON)
        }
    }

    private static func response(status: UInt16, json: String) -> HttpResponse {
        HttpResponse(
            status: status,
            // The header both clients used to drop on the floor. Nothing acts
            // on it; it is here because the core can now see it at all.
            headers: [HttpHeader(name: "X-Idempotent-Replay", value: "false")],
            body: Data(json.utf8)
        )
    }
}

/// A create payload with only a title, spelled out because UniFFI records have
/// no default arguments.
func titleOnlyCreate(_ title: TaskTitle) -> CreateTaskRequest {
    CreateTaskRequest(
        title: title,
        details: nil,
        status: nil,
        priority: nil,
        due: nil,
        scheduled: nil,
        contexts: nil,
        projects: nil,
        tags: nil,
        recurrence: nil,
        recurrenceAnchor: nil,
        timeEstimate: nil,
        extraFields: nil
    )
}
"##;

/// The smoke test itself.
///
/// Exercises one call of each shape that can break independently: a plain
/// return, a record round trip through the FFI buffer (which is where a field
/// reorder would show up), a throwing call that must succeed, a throwing call
/// that must fail with a typed error, and — in [`smokeSync`] — a full engine
/// driven entirely through Swift implementations of the exported host traits.
const SMOKE_SOURCE: &str = r##"import TaskNotesCore

/// Exercises one call of each shape that can break independently.
func smoke() throws -> String {
    let version = coreVersion()
    guard !version.isEmpty else { throw Failure("coreVersion() returned an empty string") }

    // A plain enum across the boundary, both directions.
    guard taskStatusWireValue(status: .inProgress) == "in-progress" else {
        throw Failure("taskStatusWireValue disagrees with the core")
    }
    let parsed = try taskStatusParse(raw: "delegated")
    guard parsed == .delegated else { throw Failure("taskStatusParse disagrees with the core") }

    // A record round trip. A reordered Record field would surface here as a
    // value landing in the wrong property.
    let task = try taskFromJson(
        json: #"{"id":"Tasks/a.md","title":"Write the plan","due":"2026-08-08","extraFields":{"b":1,"a":2}}"#
    )
    guard task.id == "Tasks/a.md" else { throw Failure("wrong id: \(task.id)") }
    guard task.title == "Write the plan" else { throw Failure("wrong title: \(task.title)") }
    guard task.due == "2026-08-08" else { throw Failure("wrong due: \(String(describing: task.due))") }
    guard task.status == .open, task.priority == .normal else {
        throw Failure("schema defaults were not applied across the boundary")
    }
    // Preserved frontmatter keys cross as a JSON object string, in vault order.
    guard task.extraFields == #"{"b":1,"a":2}"# else {
        throw Failure("preserved frontmatter keys lost their order: \(task.extraFields)")
    }

    // A sequence of records in and out.
    let sorted = try taskSortApply(tasks: [task], sort: SortConfig(field: .dueDate, direction: .asc))
    guard sorted.count == 1, sorted[0].title == task.title else {
        throw Failure("taskSortApply did not round trip the list")
    }

    // A validated newtype rejected at the boundary, as a typed error.
    do {
        _ = try taskFromJson(json: #"{"id":"Tasks/a.txt","title":"t"}"#)
        throw Failure("a non-markdown task id was accepted")
    } catch let error as CoreError {
        guard case .Validation = error else { throw Failure("unexpected error: \(error)") }
    }

    return version
}

/// The list surface a screen actually drives: search, the filter badge, and the
/// effective-date sort.
///
/// Every one of these was a decision a shell was making for itself. Search in
/// particular had a whole Swift predicate behind it — which fields, substring
/// or prefix, whose case folding, raw or display project matching — and each
/// answer is now the core's, asserted here from the far side of the FFI so the
/// boundary is proven rather than assumed.
func smokeListSurface() throws {
    let rent = try taskFromJson(
        json: #"{"id":"Tasks/rent.md","title":"Pay the rent","projects":["[[Areas/Home|Home]]"],"tags":["finance"],"due":"2026-08-31"}"#
    )
    let water = try taskFromJson(
        json: #"{"id":"Tasks/water.md","title":"Water the plants","scheduled":"2026-08-04","recurrence":"FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"}"#
    )
    let tasks = [rent, water]

    // 1. The search predicate, alone. Case-folded, substring, and reaching both
    //    halves of a wikilink project — none of which a second client should
    //    ever have had to guess at.
    guard taskSearchMatches(task: rent, query: "RENT") else {
        throw Failure("taskSearchMatches does not fold case")
    }
    guard taskSearchMatches(task: rent, query: "areas/"), taskSearchMatches(task: rent, query: "home")
    else {
        throw Failure("a project must be searchable by path and by display name")
    }
    guard taskSearchMatches(task: rent, query: "finance") else {
        throw Failure("tags are searched")
    }
    // One phrase, not a bag of tokens.
    guard !taskSearchMatches(task: rent, query: "rent pay") else {
        throw Failure("a query is one phrase; reordering it is a miss")
    }
    // An empty query narrows nothing, so a search field can sit over a list.
    guard taskSearchMatches(task: rent, query: "  ") else {
        throw Failure("a blank query must match everything")
    }

    // 2. The same predicate as the seventh filter dimension, and the count
    //    behind the `filters (3)` badge — a number, not a glyph.
    var filter = FilterConfig(
        projects: [], contexts: [], tags: [], statuses: [], priorities: [], hasNoDueDate: false)
    guard !taskFilterIsActive(filter: filter), taskFilterActiveCount(filter: filter) == 0 else {
        throw Failure("an empty filter is not active")
    }
    filter.query = "  PAY  "
    guard taskFilterIsActive(filter: filter), taskFilterActiveCount(filter: filter) == 1 else {
        throw Failure("a typed query is a filtered dimension")
    }
    guard taskFilterApply(tasks: tasks, filter: filter).map(\.id) == [rent.id] else {
        throw Failure("the filter did not run the core's search")
    }
    filter.tags = ["finance"]
    guard taskFilterActiveCount(filter: filter) == 2 else {
        throw Failure("the badge count did not add the second dimension")
    }

    // 3. The effective-date sort. `water` is scheduled but not due, so under
    //    `dueDate` it is "undated" and lands after the 31st while its own row
    //    says Today — the defect visible in the list snapshot.
    let byDue = try taskSortApply(
        tasks: tasks, sort: SortConfig(field: .dueDate, direction: .asc))
    guard byDue.map(\.id) == [rent.id, water.id] else {
        throw Failure("the due-date sort changed: \(byDue.map(\.id))")
    }
    let byEffective = try taskSortApply(
        tasks: tasks, sort: SortConfig(field: .effectiveDate, direction: .asc),
        today: "2026-08-03")
    guard byEffective.map(\.id) == [water.id, rent.id] else {
        throw Failure("the effective-date sort ignored `scheduled`: \(byEffective.map(\.id))")
    }
    // A `today` that is not a date is reported, never discarded.
    do {
        _ = try taskSortApply(
            tasks: tasks, sort: SortConfig(field: .effectiveDate, direction: .asc),
            today: "08/03/2026")
        throw Failure("a malformed today was accepted")
    } catch let error as CoreError {
        guard case .Validation = error else { throw Failure("unexpected error: \(error)") }
    }

    // 4. The rule as a sentence. Building this in Swift from `Frequency` alone
    //    would have dropped INTERVAL and BYDAY and printed "Weekly".
    guard
        recurrenceSummary(
            text: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE", scheduled: "2026-08-03", dateCreated: nil)
            == "Every 2 weeks on Mon, Wed"
    else {
        throw Failure("recurrenceSummary disagrees with the core")
    }
    guard recurrenceSummary(text: "garbage", scheduled: nil, dateCreated: nil) == nil else {
        throw Failure("a rule with no honest sentence must answer nil, not a guess")
    }

    // 5. Tomorrow, as whole civil days rather than 86,400,000 milliseconds.
    guard try dateAddDays(from: "2026-08-08", days: 1) == "2026-08-09" else {
        throw Failure("dateAddDays disagrees with the core")
    }
    guard try dateAddDays(from: "2028-02-28", days: 1) == "2028-02-29" else {
        throw Failure("dateAddDays does not count across a leap day")
    }
    guard try dateAddDays(from: "2026-08-08", days: -1) == "2026-08-07" else {
        throw Failure("dateAddDays does not walk backwards")
    }
}

/// The Phase 2 and Phase 5 surfaces, over their ISO-string boundary.
///
/// Cheap to check and worth checking: a binding that generates but was never
/// called is not verified.
func smokePureHelpers() throws {
    let monday = "2026-08-03"

    let occurrences = try recurrenceOccurrences(
        text: "FREQ=WEEKLY;BYDAY=MO", scheduled: monday, dateCreated: nil,
        start: monday, end: "2026-08-17"
    )
    guard occurrences == [monday, "2026-08-10", "2026-08-17"] else {
        throw Failure("recurrenceOccurrences is not inclusive on both ends: \(occurrences)")
    }
    guard recurrenceFrequency(text: "FREQ=WEEKLY;BYDAY=MO", scheduled: monday, dateCreated: nil) == .weekly else {
        throw Failure("recurrenceFrequency disagrees with the core")
    }
    // Fail open: an empty rule shows the task rather than hiding it.
    guard try recurrenceOccursOn(text: "", scheduled: monday, dateCreated: nil, date: "2026-08-11") else {
        throw Failure("an empty recurrence rule must fail open")
    }
    let next = try recurrenceNextUncompletedOccurrence(
        text: "FREQ=WEEKLY;BYDAY=MO", scheduled: monday, dateCreated: nil,
        today: "2026-08-10", anchor: .scheduled,
        completeInstances: ["2026-08-10"], skippedInstances: []
    )
    guard next == "2026-08-17" else {
        throw Failure("the next occurrence ignored a completed instance: \(String(describing: next))")
    }

    let quick = try parseTaskInput(input: "Ship the core !high p:TaskNotes tomorrow", today: "2026-08-08")
    guard quick.title == "Ship the core", quick.priority == .high, quick.due == "2026-08-09" else {
        throw Failure("parseTaskInput disagrees with the core: \(quick)")
    }
    guard quick.projects == ["TaskNotes"] else {
        throw Failure("parseTaskInput lost the project: \(String(describing: quick.projects))")
    }

    guard try dateGroup(date: "2026-08-08", today: "2026-08-08") == .today else {
        throw Failure("dateGroup disagrees with the core")
    }
    guard dateGroupHeading(group: .overdue) == "Overdue", dateGroupHeading(group: .later) == nil else {
        throw Failure("Later's heading is the shell's to format, and must be nil here")
    }
    guard try dateIsUpcoming(date: "2026-08-10", today: "2026-08-08", horizon: .days(7)) else {
        throw Failure("dateIsUpcoming disagrees with the core")
    }
    guard try dateNextSaturday(from: "2026-08-08") == "2026-08-08" else {
        throw Failure("this weekend on a Saturday is today")
    }
    // A bare date must not be read as UTC midnight and shifted west.
    guard try dateParseLocal(raw: "2026-07-10", viewerUtcOffsetSeconds: -8 * 3600) == "2026-07-10" else {
        throw Failure("dateParseLocal shifted a bare civil date")
    }

    let july = CalendarMonthRef(year: 2026, month: 7)
    guard try calendarMonthTitle(month: july) == "July 2026" else {
        throw Failure("calendarMonthTitle disagrees with the core")
    }
    let grid = try calendarMonthGrid(month: july)
    guard grid.allSatisfy({ $0.cells.count == 7 }) else {
        throw Failure("a calendar row crossed the boundary without seven cells")
    }
    guard calendarWeekdays().count == 7 else { throw Failure("wrong number of weekday headers") }

    guard elapsedFormat(seconds: 3661) == "1:01:01", elapsedFormat(seconds: 59) == "00:59" else {
        throw Failure("elapsedFormat disagrees with the core")
    }
    guard try elapsedSecondsSince(start: "2026-08-08T10:00:00Z", now: "2026-08-08T10:01:30Z") == 90 else {
        throw Failure("elapsedSecondsSince disagrees with the core")
    }
}

/// The whole sync stack, driven through Swift implementations of the exported
/// host traits — including the byte transport the wire boundary now sits on.
///
/// This is the part that cannot be inferred from reading the generated Swift.
/// Every call here re-enters Swift through a `with_foreign` vtable, every
/// storage method throws, and — since Phase 4.5 — every HTTP request is built by
/// the *core* and handed to Swift as bytes. The assertions below are therefore
/// assertions about the core's wire layer, observed from the far side of the
/// FFI: the absolute URL, the percent-escaped vault path, the `X-Mutation-Id`
/// header, the outbound rename table, the response envelope, and the
/// status → retry-class decision.
func smokeSync() throws -> TaskStoreSnapshot {
    let host = MemoryHost()
    let clock = FixedClock()
    let random = HalfUnit()
    let server = SmokeServer()

    // 1. The migration, which touches only MigrationStorage. A v1 relative
    //    mutation must become a replayable absolute command. The id carries a
    //    space and a slash on purpose: escaping it is the core's job now.
    host.state.withLock {
        $0.legacyQueue = #"[{"id":"m1","timestamp":30,"type":"delete","taskId":"TaskNotes/b c.md"}]"#
    }
    try runMigrations(storage: host, clock: clock, random: random)
    let (stamped, legacy) = host.state.withLock { ($0.schemaVersion, $0.legacyQueue) }
    guard stamped == migrationCurrentSchemaVersion() else {
        throw Failure("the migration did not stamp the schema version: \(stamped)")
    }
    guard legacy == nil else { throw Failure("the legacy queue survived the migration") }

    // 2. The core's own API client, over the Swift transport. The shell hands
    //    over an address and a socket; everything above that is the core's.
    let api = try TaskNotesApi(
        transport: server,
        baseUrl: "http://vault.test:8080/",
        requestTimeoutMillis: apiDefaultTimeoutMillis()
    )
    guard api.baseUrl() == "http://vault.test:8080" else {
        throw Failure("the trailing slash was not trimmed: \(api.baseUrl())")
    }

    // 3. The engine, over six Swift-implemented traits at once.
    let engine = FfiSyncEngine(
        api: api,
        queueStorage: host,
        cacheStorage: host,
        clock: clock,
        scheduler: host,
        random: random,
        autoSync: false
    )
    try engine.restore()
    guard try engine.snapshot().pendingCount == 1 else {
        throw Failure("the migrated v1 delete was not restored onto the queue")
    }

    // 4. One dispatch, answered optimistically without touching the network.
    guard let optimistic = try engine.dispatch(input: .create(payload: titleOnlyCreate("Written on the Mac")))
    else {
        throw Failure("a create dispatch answered no optimistic task")
    }
    guard optimistic.title == "Written on the Mac" else {
        throw Failure("the optimistic task lost its title: \(optimistic.title)")
    }
    guard optimistic.dateCreated == "2025-06-15T15:06:40.000Z" else {
        throw Failure("the Swift Clock did not reach the core: \(String(describing: optimistic.dateCreated))")
    }

    // 5. The snapshot, read back through the IndexMap → ordered-Vec projection.
    let snapshot = try engine.snapshot()
    guard snapshot.pendingCount == 2 else {
        throw Failure("wrong pending count: \(snapshot.pendingCount)")
    }
    guard snapshot.tasks.count == 1, snapshot.tasks[0].id == optimistic.id else {
        throw Failure("the optimistic task is not visible in the snapshot")
    }
    guard snapshot.pendingTaskIds.contains(optimistic.id) else {
        throw Failure("the optimistic task is missing its unsynced marker")
    }
    guard snapshot.deadLetters.isEmpty else { throw Failure("nothing should be parked yet") }

    // 6. A Swift `throws` failing *inward*, from the transport. A
    //    `TransportError.Offline` carries no status — the enum cannot express
    //    one — so turning it into a transient failure is the core's decision.
    //    Back off, arm one timer, keep the command, park nothing.
    try expectTransient(engine, host, expecting: [1000], describing: "a transport failure")

    // 7. The same, from an HTTP status. This is the hazard Phase 4.5 closed:
    //    while each shell mapped statuses itself, a 503 arriving as anything but
    //    `Api { status: 503 }` silently dead-lettered the user's work. The shell
    //    below returns a number; the core decides what it means.
    server.state.withLock { $0.mode = .failing }
    try expectTransient(engine, host, expecting: [1000, 2000], describing: "an HTTP 503")

    // 8. A successful drain, all the way through the core's wire layer.
    server.state.withLock { $0.mode = .serving }
    try engine.syncNow()
    let drained = try engine.snapshot()
    guard drained.pendingCount == 0, drained.deadLetters.isEmpty else {
        throw Failure("the queue did not drain: \(drained.pendingCount) pending")
    }

    // 9. What the transport actually saw. Every one of these was built in Rust.
    let served = Array(server.state.withLock { $0.requests }.suffix(3))
    guard served.count == 3 else { throw Failure("expected three served requests, got \(served.count)") }

    guard served[0].method == .delete,
        served[0].url == "http://vault.test:8080/api/tasks/TaskNotes%2Fb%20c.md"
    else {
        throw Failure("the core did not escape the vault path as one component: \(served[0].url)")
    }
    guard served[0].body == nil else { throw Failure("a delete must carry no body") }

    guard served[1].method == .post, served[1].url == "http://vault.test:8080/api/tasks" else {
        throw Failure("wrong create request: \(served[1].method) \(served[1].url)")
    }
    guard let createBody = served[1].body else { throw Failure("the create carried no body") }
    let createJSON = String(decoding: createBody, as: UTF8.self)
    guard createJSON == #"{"title":"Written on the Mac"}"# else {
        throw Failure("the core built the wrong create body: \(createJSON)")
    }
    guard served[1].headers.contains(where: { $0.name == "Content-Type" && $0.value == "application/json" }) else {
        throw Failure("the create lost its content type: \(served[1].headers)")
    }
    // The idempotency key is what makes a crash between server-ack and client
    // dequeue safe, and it is the core that knows the command's id.
    guard served[1].headers.contains(where: { $0.name == "X-Mutation-Id" && !$0.value.isEmpty }) else {
        throw Failure("the create lost its idempotency key: \(served[1].headers)")
    }

    guard served[2].method == .get,
        served[2].url == "http://vault.test:8080/api/tasks?limit=200&offset=0"
    else {
        throw Failure("wrong pull request: \(served[2].method) \(served[2].url)")
    }

    // 10. The argument that settled the refactor. The server answered with
    //     `customProperties` in vault order inside a `{ success, data }`
    //     envelope; the core unwrapped it, renamed the field, and kept the key
    //     order. Foundation has no ordered JSON type, so this assertion could
    //     not have held while the boundary lived in Swift.
    guard drained.tasks.count == 1 else {
        throw Failure("the pull did not replace the base: \(drained.tasks.count) task(s)")
    }
    let pulled = drained.tasks[0]
    guard pulled.id == "TaskNotes/pulled.md", pulled.title == "Pulled from the server" else {
        throw Failure("the pulled task did not survive the wire boundary: \(pulled.id)")
    }
    guard pulled.extraFields == #"{"zebra":1,"apple":2,"mango":3}"# else {
        throw Failure("unmodelled frontmatter lost its vault order: \(pulled.extraFields)")
    }

    // 11. A Swift storage failure, which must arrive as a typed error rather
    //     than as a panic that aborts the host process.
    host.state.withLock { $0.writesFail = true }
    do {
        _ = try engine.dispatch(input: .delete(taskId: pulled.id))
        throw Failure("a failing QueueStorage.writeQueue was not reported")
    } catch let error as CoreError {
        guard case .Validation = error else { throw Failure("unexpected storage error: \(error)") }
    }
    host.state.withLock { $0.writesFail = false }

    // 12. Cancellation, which UniFFI's async story cannot provide: an explicit
    //     hook, reaching the Swift transport, taking no engine lock.
    engine.cancelAll()
    guard server.state.withLock({ $0.cancels }) == 1 else {
        throw Failure("cancelAll() did not reach the Swift transport")
    }

    // 13. Disposal cancels the armed timer through the Swift scheduler, and
    //     abandons anything still in flight before it takes the lock.
    try engine.shutdown()
    guard try engine.isDisposed() else { throw Failure("shutdown() did not take") }
    guard host.state.withLock({ !$0.cancelledTimers.isEmpty }) else {
        throw Failure("shutdown() did not cancel the armed retry timer")
    }
    guard server.state.withLock({ $0.cancels }) == 2 else {
        throw Failure("shutdown() did not abandon in-flight requests")
    }

    return snapshot
}

/// Drive one failed pass and require the transient policy: back off on the
/// documented schedule, keep the queue, park nothing.
func expectTransient(
    _ engine: FfiSyncEngine,
    _ host: MemoryHost,
    expecting delays: [Int64],
    describing what: String
) throws {
    do {
        try engine.syncNow()
        throw Failure("syncNow succeeded despite \(what)")
    } catch let error as CoreError {
        // A transport failure and a 503 are different core variants, and both
        // must classify as transient. Asserting the *outcome* is the point: the
        // shell no longer gets a vote in which one it is.
        switch error {
        case .Connection, .Api: break
        default: throw Failure("\(what) surfaced as \(error)")
        }
    }
    let status = try engine.status()
    guard status.state == .backoff else {
        throw Failure("\(what) left the engine in \(status.state), not backoff")
    }
    let armed = host.state.withLock { $0.armedDelays }
    guard armed == delays else {
        throw Failure("\(what) armed \(armed), expected \(delays)")
    }
    let snapshot = try engine.snapshot()
    guard snapshot.pendingCount == 2, snapshot.deadLetters.isEmpty else {
        throw Failure("\(what) must keep the queue intact, saw \(snapshot.pendingCount) pending")
    }
}

/// A local error so the smoke test never force-unwraps or traps blind.
struct Failure: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

do {
    let version = try smoke()
    try smokePureHelpers()
    try smokeListSurface()
    let snapshot = try smokeSync()
    print("smoke: TaskNotesCore \(version), \(taskStatusAll().count) statuses, \(priorityAll().count) priorities")
    print("smoke: sync engine round trip — \(snapshot.tasks.count) task(s), \(snapshot.pendingCount) pending, "
        + "through 7 Swift-implemented host traits")
} catch {
    fatalError("smoke failed: \(error)")
}
"##;

// ── Build steps ────────────────────────────────────────────────────────────

/// Build the pinned `uniffi-bindgen-swift` and return its path.
fn build_bindgen(root: &Path, profile: &str) -> Result<PathBuf, String> {
    process::run(
        "cargo",
        &[
            "build",
            "--package",
            FFI_CRATE,
            "--features",
            "cli",
            "--bin",
            "uniffi-bindgen-swift",
            "--profile",
            profile,
        ],
        root,
    )?;
    Ok(root
        .join("target")
        .join(profile_directory(profile))
        .join(executable_file("uniffi-bindgen-swift")))
}

/// Build the host dynamic library UniFFI reads metadata from.
///
/// Built *after* the generator on purpose. Both write
/// `target/<profile>/libtasknotes_core_ffi.a`, and the generator's build turns
/// the `cli` feature on for the library too; this second build restores the
/// feature set the app actually ships. The metadata is identical either way,
/// but leaving a `clap`-carrying archive lying around named as the shipping one
/// invites someone to link it.
fn build_library(root: &Path, profile: &str, target: Option<&str>) -> Result<PathBuf, String> {
    let mut arguments = vec![
        "build".to_owned(),
        "--package".to_owned(),
        FFI_CRATE.to_owned(),
        "--lib".to_owned(),
        "--profile".to_owned(),
        profile.to_owned(),
    ];
    if let Some(target) = target {
        arguments.push("--target".to_owned());
        arguments.push(target.to_owned());
    }
    process::run("cargo", &arguments, root)?;

    let mut path = root.join("target");
    if let Some(target) = target {
        path = path.join(target);
    }
    let library_file = if target.is_some() {
        APPLE_LIBRARY_FILE
    } else {
        host_dynamic_library_file()
    };
    Ok(path.join(profile_directory(profile)).join(library_file))
}

/// Build one architecture of one platform slice.
fn build_library_for_platform(
    root: &Path,
    profile: &str,
    target: &str,
    platform: Platform,
) -> Result<PathBuf, String> {
    process::run_with_env(
        "cargo",
        &[
            "build",
            "--package",
            FFI_CRATE,
            "--lib",
            "--profile",
            profile,
            "--target",
            target,
        ],
        root,
        platform.deployment_environment(),
    )?;
    Ok(root
        .join("target")
        .join(target)
        .join(profile_directory(profile))
        .join(APPLE_LIBRARY_FILE))
}

// ── Paths and filesystem ───────────────────────────────────────────────────

/// The workspace root, derived from this crate's manifest directory.
///
/// `xtask/` sits directly under the workspace root, so the parent is the root.
/// Derived rather than read from the current directory because `cargo xtask`
/// can be invoked from anywhere in the tree.
fn workspace_root() -> Result<PathBuf, String> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("{} has no parent directory", manifest.display()))
}

/// The `target/` subdirectory a cargo profile writes into.
///
/// Cargo maps its two built-in profiles onto directories that do not share
/// their names; every custom profile, `reldbg` included, uses its own name.
fn profile_directory(profile: &str) -> &str {
    match profile {
        "dev" | "test" => "debug",
        "bench" => "release",
        other => other,
    }
}

/// Add the platform executable suffix when Cargo emitted one.
fn executable_file(name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_owned()
    }
}

/// The host `cdylib` whose symbol table carries UniFFI metadata.
fn host_dynamic_library_file() -> &'static str {
    if cfg!(target_os = "windows") {
        "tasknotes_core_ffi.dll"
    } else if cfg!(target_os = "macos") {
        "libtasknotes_core_ffi.dylib"
    } else {
        "libtasknotes_core_ffi.so"
    }
}

/// Create a directory and every missing parent.
fn create_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|error| format!("could not create {}: {error}", path.display()))
}

/// Remove a directory tree, tolerating its absence but nothing else.
fn remove_directory(path: &Path) -> Result<(), String> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not remove {}: {error}", path.display())),
    }
}

/// Remove a directory tree and recreate it empty.
///
/// Staging directories are rebuilt rather than written over so a stale artifact
/// from a previous run — a slice for a platform no longer requested, a header
/// for a module that was renamed — cannot survive into the new output.
fn recreate_directory(path: &Path) -> Result<(), String> {
    remove_directory(path)?;
    create_directory(path)
}

/// Copy a file, failing with both paths named.
///
/// **A copy of identical bytes is skipped, and that is load-bearing rather than
/// an optimisation.** [`check_bindings`] regenerates on every run — it is gate 7,
/// and it runs inside the package's `lint` script — so an unconditional copy
/// would rewrite the committed bindings, and bump their modification time, every
/// time anyone linted. [`check_xcframework`] reads exactly that timestamp, so it
/// would then report the XCFramework stale after a lint that changed nothing.
///
/// A guard that fires when nothing is wrong gets ignored, which is the failure
/// mode this whole area already suffers from. Skipping the no-op copy makes the
/// mtime mean "the generated bytes actually changed", which is the question
/// being asked.
fn copy(from: &Path, to: &Path) -> Result<(), String> {
    let source =
        fs::read(from).map_err(|error| format!("could not read {}: {error}", from.display()))?;
    if let Ok(existing) = fs::read(to)
        && existing == source
    {
        return Ok(());
    }
    fs::write(to, &source).map_err(|error| {
        format!(
            "could not copy {} to {}: {error}",
            from.display(),
            to.display()
        )
    })
}

/// Write a file, failing with the path named.
fn write(path: &Path, contents: &str) -> Result<(), String> {
    fs::write(path, contents)
        .map_err(|error| format!("could not write {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::{
        FFI_MODULE, HOSTS_SOURCE, Platform, SMOKE_SOURCE, SWIFT_MODULE, profile_directory,
        smoke_manifest, workspace_root,
    };

    #[test]
    fn platforms_round_trip_through_their_cli_spelling() {
        for platform in [Platform::MacOs, Platform::Ios, Platform::IosSimulator] {
            assert_eq!(Platform::parse(platform.name()).unwrap(), platform);
        }
        assert_eq!(
            Platform::parse("watchos").unwrap_err(),
            "unknown platform \"watchos\"; expected one of macos, ios, ios-sim"
        );
    }

    #[test]
    fn no_architecture_appears_in_two_slices_of_one_invocation() {
        // The reason `lipo` runs per platform: macOS and the iOS Simulator both
        // ship an `aarch64` target, so a single fat file across platforms is
        // not merely wrong, it is rejected by `lipo`.
        let macos = Platform::MacOs.targets();
        let simulator = Platform::IosSimulator.targets();
        assert!(macos.contains(&"aarch64-apple-darwin"));
        assert!(simulator.contains(&"aarch64-apple-ios-sim"));
        for platform in [Platform::MacOs, Platform::Ios, Platform::IosSimulator] {
            let targets = platform.targets();
            let mut architectures: Vec<&str> = targets
                .iter()
                .filter_map(|target| target.split('-').next())
                .collect();
            architectures.sort_unstable();
            let count = architectures.len();
            architectures.dedup();
            assert_eq!(
                architectures.len(),
                count,
                "{:?} would lipo two slices of one architecture",
                platform.name()
            );
        }
    }

    #[test]
    fn every_platform_pins_a_deployment_target() {
        for platform in [Platform::MacOs, Platform::Ios, Platform::IosSimulator] {
            assert!(
                !platform.deployment_environment().is_empty(),
                "{} has no deployment target",
                platform.name()
            );
        }
    }

    #[test]
    fn maps_cargo_profiles_onto_their_target_directories() {
        assert_eq!(profile_directory("dev"), "debug");
        assert_eq!(profile_directory("test"), "debug");
        assert_eq!(profile_directory("bench"), "release");
        assert_eq!(profile_directory("release"), "release");
        assert_eq!(profile_directory("reldbg"), "reldbg");
    }

    #[test]
    fn the_workspace_root_holds_the_workspace_manifest() {
        let root = workspace_root().unwrap();
        assert!(root.join("Cargo.toml").is_file(), "{}", root.display());
        assert!(root.join("crates").is_dir(), "{}", root.display());
    }

    #[test]
    fn the_ffi_module_is_the_swift_module_plus_the_uniffi_suffix() {
        // Not decoration: `--module-name` has to be exactly what the generated
        // Swift imports, and UniFFI derives that as `<namespace>FFI`.
        assert_eq!(FFI_MODULE, format!("{SWIFT_MODULE}FFI"));
    }

    #[test]
    fn the_smoke_package_consumes_the_bindings_by_path() {
        let manifest = smoke_manifest("/somewhere/bindings", "bindings");
        assert!(manifest.contains(r#".package(path: "/somewhere/bindings")"#));
        assert!(manifest.contains(r#".product(name: "TaskNotesCore", package: "bindings")"#));
        assert!(manifest.contains("swift-tools-version: 6.2"));
        assert!(SMOKE_SOURCE.contains("import TaskNotesCore"));
        assert!(SMOKE_SOURCE.contains("coreVersion()"));
    }

    #[test]
    fn the_smoke_test_implements_every_exported_host_trait_in_swift() {
        // A generated binding that is never called is not verified, and a
        // *foreign* trait is the one shape whose correctness cannot be read off
        // the generated Swift: it works only if the vtable is registered, the
        // handle map round-trips, and a Swift `throws` becomes a Rust `Err`.
        // Losing one of these conformances would silently shrink what
        // `verify-swift` proves, so the list is pinned here.
        for host in [
            "Clock",
            "Randomness",
            "RetryScheduler",
            "HttpClient",
            "QueueStorage",
            "TaskCacheStorage",
            "MigrationStorage",
        ] {
            assert!(
                HOSTS_SOURCE.contains(host),
                "the smoke test no longer implements {host}"
            );
        }
        // The engine has to actually be driven, not merely constructed.
        for call in [
            "FfiSyncEngine(",
            "engine.restore()",
            "engine.dispatch(",
            "engine.snapshot()",
            "engine.syncNow()",
            "engine.cancelAll()",
        ] {
            assert!(
                SMOKE_SOURCE.contains(call),
                "the smoke test no longer exercises {call}"
            );
        }
    }

    #[test]
    fn the_smoke_test_proves_the_core_owns_the_list_surface() {
        // Five answers a shell was making up for itself until the core
        // exported them. Each of these is here because losing the call would
        // shrink `verify-swift` back to "the bindings compile" for a decision
        // that has a *product* consequence, not just an ABI one.
        for call in [
            // Search: which fields, substring, whose case folding.
            "taskSearchMatches(",
            // The seventh filter dimension, composed by the core.
            "filter.query =",
            // The `filters (3)` badge as a number rather than a glyph.
            "taskFilterActiveCount(",
            // due → scheduled → the rule's next occurrence.
            "field: .effectiveDate",
            // The human-readable rule, which `Frequency` alone cannot build.
            "recurrenceSummary(",
            // Civil-day arithmetic, not milliseconds.
            "dateAddDays(",
        ] {
            assert!(
                SMOKE_SOURCE.contains(call),
                "the smoke test no longer exercises {call}"
            );
        }
        // And the answers themselves, so a semantic change has to be a
        // deliberate edit here rather than a quiet drift.
        for evidence in [
            // A project is searchable by path *and* by display name — the
            // decision `projectDisplayName` would have silently reversed.
            r#"taskSearchMatches(task: rent, query: "areas/")"#,
            // One phrase, not a bag of tokens.
            r#"!taskSearchMatches(task: rent, query: "rent pay")"#,
            // The sentence the inspector needs, in full.
            "Every 2 weeks on Mon, Wed",
            // A `today` the core cannot read is reported, never discarded.
            r#"today: "08/03/2026""#,
        ] {
            assert!(
                SMOKE_SOURCE.contains(evidence),
                "the smoke test no longer proves: {evidence}"
            );
        }
    }

    #[test]
    fn the_smoke_test_proves_the_core_owns_the_wire_boundary() {
        // Phase 4.5 moved the wire boundary out of the shells and into the
        // core. `verify-swift` is where that is proven end to end rather than
        // asserted: the Swift side implements a byte transport and nothing
        // else, and the core has to produce every one of these itself. Losing
        // one of these assertions would quietly shrink the proof back to
        // "the bindings compile".
        for evidence in [
            // The absolute URL, built in Rust.
            "http://vault.test:8080/api/tasks?limit=200&offset=0",
            // A vault path escaped as ONE path component — the mistake
            // `CharacterSet.urlPathAllowed` invites, and that every further
            // shell would rediscover.
            "http://vault.test:8080/api/tasks/TaskNotes%2Fb%20c.md",
            // The idempotency key, which only the core knows.
            "X-Mutation-Id",
            // Unmodelled frontmatter in vault order. Unrepresentable in
            // Foundation, which has no ordered JSON type.
            r#"{"zebra":1,"apple":2,"mango":3}"#,
            // Cancellation, designed in rather than added later.
            "engine.cancelAll()",
        ] {
            assert!(
                SMOKE_SOURCE.contains(evidence),
                "the smoke test no longer proves: {evidence}"
            );
        }
        // The transport must answer a status and let the core classify it,
        // never classify it itself.
        assert!(
            HOSTS_SOURCE.contains("status: 503"),
            "the smoke transport no longer exercises the status → error mapping"
        );
        // And the transport itself must name no domain type at all. This is the
        // same grep the Swift `Host/` layer is held to: after Phase 4.5 a shell
        // that touches the network mentions `HttpRequest`, `HttpResponse` and
        // `TransportError`, and nothing from the domain.
        let transport = HOSTS_SOURCE
            .split_once("final class SmokeServer")
            .and_then(|(_, rest)| rest.split_once("\n/// A create payload"))
            .map(|(class, _)| class)
            .unwrap();
        for domain in [
            "TaskId",
            "CreateTaskRequest",
            "TaskStatus",
            "InstanceCompletion",
        ] {
            assert!(
                !transport.contains(domain),
                "the smoke transport names the domain type {domain}; it should only move bytes"
            );
        }
        for shape in ["HttpRequest", "HttpResponse", "TransportError"] {
            assert!(
                transport.contains(shape),
                "the smoke transport no longer speaks {shape}"
            );
        }
    }
}
