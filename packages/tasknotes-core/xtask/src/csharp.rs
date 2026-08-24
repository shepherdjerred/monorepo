//! Deterministic C# binding generation for the Windows host.
//!
//! The upstream C# generator still targets UniFFI 0.31, while this core uses
//! UniFFI 0.32. The small, source-controlled retarget patch in
//! `tools/uniffi-bindgen-cs/` is applied to one pinned upstream commit, then
//! built with its committed lockfile. It reads proc-macro metadata from the
//! host `cdylib`, so the same command works on Linux, macOS, and Windows and
//! produces one committed `TaskNotesCore.cs` file. The generated file is
//! intentionally not formatted after generation: hand-authored transformations
//! would hide generator drift.

use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::process;

const FFI_CRATE: &str = "tasknotes-core-ffi";
const GENERATED_FILE: &str = "TaskNotesCore.cs";
const GENERATED_PATHSPEC: &str = "bindings/csharp";
const BINDGEN_REPOSITORY: &str = "https://github.com/NordSecurity/uniffi-bindgen-cs.git";
const BINDGEN_REVISION: &str = "e10ce410eb3a10cc19c7928b93ea8d84e038c034";
const BINDGEN_PATCH_HEX: &str = "tools/uniffi-bindgen-cs/uniffi-bindgen-cs-0.32.patch.hex";
const BINDGEN_LOCKFILE: &str = "tools/uniffi-bindgen-cs/Cargo.lock";
const BINDGEN_SOURCE_DIRECTORY: &str = "target/uniffi-bindgen-cs-0.32";

/// Regenerate the committed C# binding from the host dynamic library.
///
/// # Errors
///
/// Returns a message when the library build, generator, or filesystem fails.
pub fn generate_bindings(profile: &str) -> Result<String, String> {
    let root = workspace_root()?;
    let library = build_library(&root, profile)?;
    let generator = build_generator(&root)?;
    let staging = root.join("target").join("csharp-bindings-staging");
    recreate_directory(&staging)?;

    let generator = generator.to_string_lossy().into_owned();
    let library = library.to_string_lossy().into_owned();
    let staging_argument = staging.to_string_lossy().into_owned();

    process::run(
        &generator,
        &[
            "--library",
            &library,
            "--out-dir",
            &staging_argument,
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

fn build_generator(root: &Path) -> Result<PathBuf, String> {
    let source = root.join(BINDGEN_SOURCE_DIRECTORY);
    remove_directory(&source)?;

    let source_parent = source
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", source.display()))?;
    create_directory(source_parent)?;

    let source = source.to_string_lossy().into_owned();
    process::run(
        "git",
        &[
            "clone",
            "--quiet",
            "--no-checkout",
            BINDGEN_REPOSITORY,
            &source,
        ],
        root,
    )?;
    let source_path = Path::new(&source);
    process::run(
        "git",
        &["checkout", "--detach", BINDGEN_REVISION],
        source_path,
    )?;

    let patch = write_patch(root, source_path)?;
    let patch = patch.to_string_lossy().into_owned();
    process::run("git", &["apply", "--check", &patch], source_path)?;
    process::run("git", &["apply", &patch], source_path)?;

    let lockfile = root.join(BINDGEN_LOCKFILE);
    fs::copy(&lockfile, source_path.join("Cargo.lock")).map_err(|error| {
        format!(
            "could not copy {} into the pinned C# generator source: {error}",
            lockfile.display()
        )
    })?;
    process::run(
        "cargo",
        &["build", "--locked", "--package", "uniffi-bindgen-cs"],
        source_path,
    )?;

    let binary = source_path
        .join("target")
        .join("debug")
        .join(generator_binary_name());
    if !binary.is_file() {
        return Err(format!(
            "the pinned C# generator build completed without {}",
            binary.display()
        ));
    }
    Ok(binary)
}

fn write_patch(root: &Path, source: &Path) -> Result<PathBuf, String> {
    let encoded_path = root.join(BINDGEN_PATCH_HEX);
    let encoded = fs::read_to_string(&encoded_path).map_err(|error| {
        format!(
            "could not read the pinned C# generator patch {}: {error}",
            encoded_path.display()
        )
    })?;
    let patch = source.join("uniffi-bindgen-cs-0.32.patch");
    fs::write(&patch, decode_hex(&encoded)?).map_err(|error| {
        format!(
            "could not write the pinned C# generator patch {}: {error}",
            patch.display()
        )
    })?;
    Ok(patch)
}

fn decode_hex(encoded: &str) -> Result<Vec<u8>, String> {
    let compact: Vec<u8> = encoded
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect();
    if !compact.len().is_multiple_of(2) {
        return Err("the pinned C# generator patch has an odd number of hex digits".to_owned());
    }

    let mut decoded = Vec::with_capacity(compact.len() / 2);
    for &[high, low] in compact.as_chunks::<2>().0 {
        decoded.push((hex_nibble(high)? << 4) | hex_nibble(low)?);
    }
    Ok(decoded)
}

fn hex_nibble(byte: u8) -> Result<u8, String> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        other => Err(format!(
            "the pinned C# generator patch has a non-hex byte {other}"
        )),
    }
}

fn generator_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "uniffi-bindgen-cs.exe"
    } else {
        "uniffi-bindgen-cs"
    }
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
    remove_directory(path)?;
    create_directory(path)
}

fn remove_directory(path: &Path) -> Result<(), String> {
    match fs::remove_dir_all(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("could not remove {}: {error}", path.display())),
    }
    Ok(())
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

    use super::{decode_hex, generator_binary_name, library_file, profile_directory};

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

    #[test]
    fn generator_binary_matches_the_host_convention() {
        if cfg!(windows) {
            assert_eq!(generator_binary_name(), "uniffi-bindgen-cs.exe");
        } else {
            assert_eq!(generator_binary_name(), "uniffi-bindgen-cs");
        }
    }

    #[test]
    fn decodes_hex_without_permitting_malformed_source() {
        assert_eq!(decode_hex("4869\n").unwrap(), b"Hi");
        assert!(decode_hex("0").is_err());
        assert!(decode_hex("zz").is_err());
    }
}
