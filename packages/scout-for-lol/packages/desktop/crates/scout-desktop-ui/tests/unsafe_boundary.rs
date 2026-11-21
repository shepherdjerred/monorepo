//! `unsafe` lives only in `scout-desktop-ui/src/native/`.
//!
//! The workspace denies `unsafe_code`. The overlay's click-through needs a raw
//! platform window handle turned into the platform's window type, which no
//! safe binding offers, so `src/native/` opts out file by file. This test
//! reads every Rust file in the workspace and fails on an `unsafe` keyword or
//! an `unsafe_code` lint override anywhere else, so a new one gets reviewed as
//! a change to this boundary rather than slipping in beside other code.

use std::path::{Path, PathBuf};

/// Where `unsafe` may appear, relative to the workspace root.
const ALLOWED: &str = "crates/scout-desktop-ui/src/native/";

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Every `.rs` file under `directory`, skipping build output.
fn rust_files(directory: &Path, found: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(directory)? {
        let path = entry?.path();
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        if path.is_dir() {
            if name != "target" && !name.starts_with('.') {
                rust_files(&path, found)?;
            }
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            found.push(path);
        }
    }
    Ok(())
}

/// Whether `at` in `line` sits inside a string literal: an odd number of
/// unescaped double quotes before it.
fn in_string(line: &str, at: usize) -> bool {
    let before = line[..at]
        .replace("\\\\", "")
        .replace("\\\"", "")
        .replace("'\"'", "");
    before.matches('"').count() % 2 == 1
}

fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

/// The `unsafe` keywords and `unsafe_code` lint names in one line of code,
/// outside comments and string literals.
fn hits(line: &str) -> usize {
    let code = line.split_once("//").map_or(line, |(code, _)| code);
    let bytes = code.as_bytes();
    let mut count = 0;
    for (at, _) in code.match_indices("unsafe") {
        let before = at.checked_sub(1).map(|index| bytes[index]);
        if before.is_some_and(is_word_byte) || in_string(code, at) {
            continue;
        }
        let rest = &code[at + "unsafe".len()..];
        let keyword = !rest.bytes().next().is_some_and(is_word_byte);
        let lint_override =
            rest.starts_with("_code") && !rest[5..].bytes().next().is_some_and(is_word_byte);
        if keyword || lint_override {
            count += 1;
        }
    }
    count
}

#[test]
fn unsafe_appears_only_in_the_native_module() -> Result<(), Box<dyn std::error::Error>> {
    let root = workspace_root();
    let mut files = Vec::new();
    rust_files(&root.join("crates"), &mut files)?;
    rust_files(&root.join("build-support"), &mut files)?;
    assert!(
        files.len() > 50,
        "the walk found too few files: {}",
        files.len()
    );
    let mut outside = Vec::new();
    let mut inside = 0;
    for file in &files {
        let relative = file
            .strip_prefix(&root)?
            .to_string_lossy()
            .replace('\\', "/");
        let text = std::fs::read_to_string(file)?;
        for (number, line) in text.lines().enumerate() {
            let found = hits(line);
            if found == 0 {
                continue;
            }
            if relative.starts_with(ALLOWED) {
                inside += found;
            } else {
                outside.push(format!("{relative}:{}: {}", number + 1, line.trim()));
            }
        }
    }
    assert!(
        outside.is_empty(),
        "`unsafe` belongs only in {ALLOWED}:\n{}",
        outside.join("\n")
    );
    // The positive control: each platform file opts out once and converts
    // its handle in one `unsafe` block.
    assert!(
        inside >= 4,
        "the scan no longer finds the native module's own unsafe ({inside})"
    );
    Ok(())
}

#[test]
fn the_scan_finds_code_and_skips_prose() {
    assert_eq!(hits("    let view = unsafe { pointer.as_ref() };"), 1);
    assert_eq!(hits("unsafe fn raw() {}"), 1);
    assert_eq!(hits("unsafe impl Send for Raw {}"), 1);
    assert_eq!(hits("#[unsafe(no_mangle)]"), 1);
    // Test data, split so the repository's suppression scan does not read it
    // as a real lint override.
    assert_eq!(hits(concat!("#![al", "low(unsafe_code)]")), 1);
    assert_eq!(hits("#![expect(unsafe_code, reason = \"x\")]"), 1);
    assert_eq!(
        hits("    /// fields, unsafe JSON keys, or excessive payload"),
        0
    );
    assert_eq!(
        hits("#[error(\"JSON payload contains unsafe key {0:?}\")]"),
        0
    );
    assert_eq!(hits("    unsafe_keys: Vec<String>,"), 0);
    assert_eq!(hits("let x = 1; // unsafe { }"), 0);
}
