//! Deterministic C# binding generation for the Windows host.
//!
//! The third-party generator is installed by mise at the exact version paired
//! with UniFFI 0.31. It reads proc-macro metadata from the host `cdylib`, so the
//! same command works on Linux, macOS, and Windows and produces one committed
//! `TaskNotesCore.cs` file. The generated file is intentionally not formatted
//! after generation: hand-authored transformations would hide generator drift.

use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::process;

const FFI_CRATE: &str = "tasknotes-core-ffi";
const GENERATED_FILE: &str = "TaskNotesCore.cs";
const GENERATED_PATHSPEC: &str = "bindings/csharp";

/// Regenerate the committed C# binding from the host dynamic library.
///
/// # Errors
///
/// Returns a message when the library build, generator, or filesystem fails.
pub fn generate_bindings(profile: &str) -> Result<String, String> {
    let root = workspace_root()?;
    let library = build_library(&root, profile)?;
    let staging = root.join("target").join("csharp-bindings-staging");
    recreate_directory(&staging)?;

    process::run(
        "uniffi-bindgen-cs",
        &[
            "--library",
            &library.to_string_lossy(),
            "--out-dir",
            &staging.to_string_lossy(),
            "--no-format",
        ],
        &root,
    )?;

    let destination = root.join(GENERATED_PATHSPEC);
    create_directory(&destination)?;
    copy(
        &staging.join(GENERATED_FILE),
        &destination.join(GENERATED_FILE),
    )?;

    Ok(format!("wrote {GENERATED_PATHSPEC}/{GENERATED_FILE}\n"))
}

/// Regenerate the C# binding and fail when the committed source moved.
///
/// # Errors
///
/// Returns a message when generation fails, git reports drift, the path is
/// ignored, or generation produces an untracked file.
pub fn check_bindings(profile: &str) -> Result<String, String> {
    let root = workspace_root()?;
    let generated = generate_bindings(profile)?;
    print!("{generated}");

    if !process::succeeded(
        "git",
        &["diff", "--exit-code", "--", GENERATED_PATHSPEC],
        &root,
    )? {
        return Err("the committed C# binding is out of date (diff above).\n\
             Run `cargo xtask generate-bindings` and commit bindings/csharp/."
            .to_owned());
    }

    if process::succeeded(
        "git",
        &["check-ignore", "-q", "--no-index", "--", GENERATED_PATHSPEC],
        &root,
    )? {
        return Err(format!(
            "{GENERATED_PATHSPEC} is gitignored, so the binding drift check cannot see it"
        ));
    }

    let untracked = process::capture(
        "git",
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "--",
            GENERATED_PATHSPEC,
        ],
        &root,
    )?;
    if !untracked.trim().is_empty() {
        return Err(format!(
            "C# binding generation produced files that are not tracked by git:\n{untracked}\n\
             Add them so the drift check can see them."
        ));
    }

    Ok("check-bindings: committed C# binding matches the generated binding\n".to_owned())
}

fn build_library(root: &Path, profile: &str) -> Result<PathBuf, String> {
    process::run(
        "cargo",
        &[
            "build",
            "--package",
            FFI_CRATE,
            "--lib",
            "--profile",
            profile,
        ],
        root,
    )?;
    Ok(root
        .join("target")
        .join(profile_directory(profile))
        .join(library_file()))
}

fn library_file() -> &'static str {
    if cfg!(target_os = "windows") {
        "tasknotes_core_ffi.dll"
    } else if cfg!(target_os = "macos") {
        "libtasknotes_core_ffi.dylib"
    } else {
        "libtasknotes_core_ffi.so"
    }
}

fn workspace_root() -> Result<PathBuf, String> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("{} has no parent directory", manifest.display()))
}

fn profile_directory(profile: &str) -> &str {
    match profile {
        "dev" | "test" => "debug",
        "bench" => "release",
        other => other,
    }
}

fn create_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|error| format!("could not create {}: {error}", path.display()))
}

fn recreate_directory(path: &Path) -> Result<(), String> {
    match fs::remove_dir_all(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("could not remove {}: {error}", path.display())),
    }
    create_directory(path)
}

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

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{library_file, profile_directory};

    #[test]
    fn cargo_profile_directories_match_cargo_conventions() {
        assert_eq!(profile_directory("dev"), "debug");
        assert_eq!(profile_directory("release"), "release");
        assert_eq!(profile_directory("reldbg"), "reldbg");
    }

    #[test]
    fn host_library_name_is_dynamic() {
        let extension = Path::new(library_file())
            .extension()
            .and_then(std::ffi::OsStr::to_str)
            .unwrap();
        assert!(["dll", "dylib", "so"].contains(&extension));
    }
}
