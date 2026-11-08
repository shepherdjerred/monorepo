//! First-party Kotlin binding generation using the pinned UniFFI toolchain.

use std::fs;

use crate::{process, swift};

const GENERATED_PATH: &str = "bindings/kotlin/uniffi/TaskNotesCore/TaskNotesCore.kt";

/// Generate Kotlin from the same metadata library used by Swift and C#.
///
/// # Errors
/// Returns build, generator, or filesystem failures.
pub fn generate_bindings(profile: &str) -> Result<String, String> {
    let root = swift::workspace_root()?;
    let library = swift::build_library(&root, profile, None)?;
    let output = root.join("bindings/kotlin");
    fs::create_dir_all(&output)
        .map_err(|error| format!("cannot create Kotlin bindings directory: {error}"))?;
    process::run(
        "cargo",
        &[
            "run",
            "--locked",
            "--package",
            "tasknotes-core-ffi",
            "--features",
            "cli",
            "--bin",
            "uniffi-bindgen",
            "--profile",
            profile,
            "--",
            "generate",
            "--library",
            &library.to_string_lossy(),
            "--language",
            "kotlin",
            "--out-dir",
            &output.to_string_lossy(),
            "--no-format",
        ],
        &root,
    )?;
    let metadata = fs::metadata(root.join(GENERATED_PATH))
        .map_err(|error| format!("Kotlin generator did not produce {GENERATED_PATH}: {error}"))?;
    if !metadata.is_file() {
        return Err("Kotlin generator output is not a file".to_owned());
    }
    Ok(format!("wrote {GENERATED_PATH}\n"))
}

/// Regenerate Kotlin and check tracked source for ABI drift.
///
/// # Errors
/// Fails for generation errors, ignored/untracked output, or changed bindings.
pub fn check_bindings(profile: &str) -> Result<String, String> {
    let root = swift::workspace_root()?;
    print!("{}", generate_bindings(profile)?);
    if !process::succeeded("git", &["diff", "--exit-code", "--", GENERATED_PATH], &root)? {
        return Err("Kotlin bindings are out of date; run cargo xtask generate-bindings and commit all generated outputs".to_owned());
    }
    if process::succeeded(
        "git",
        &["check-ignore", "-q", "--no-index", "--", GENERATED_PATH],
        &root,
    )? {
        return Err("Kotlin bindings are ignored by git".to_owned());
    }
    let untracked = process::capture(
        "git",
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "--",
            GENERATED_PATH,
        ],
        &root,
    )?;
    if !untracked.trim().is_empty() {
        return Err("Kotlin bindings are untracked; add the generated file".to_owned());
    }
    Ok("check-bindings: committed Kotlin matches generated metadata\n".to_owned())
}
