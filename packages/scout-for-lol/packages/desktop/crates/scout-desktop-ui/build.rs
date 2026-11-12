//! Generates the window's theme constants from the design system's
//! language-neutral tokens, and fails the build when a token the window uses
//! is missing or malformed.

#[path = "src/token_source.rs"]
mod token_source;

use std::{env, error::Error, fs, path::PathBuf};

fn main() -> Result<(), Box<dyn Error>> {
    let manifest_dir =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").ok_or("CARGO_MANIFEST_DIR is not set")?);
    let tokens = manifest_dir.join("../../../design-system/tokens");
    let themes_path = tokens.join("themes.json");
    let schema_path = tokens.join("themes.schema.json");
    println!("cargo:rerun-if-changed={}", themes_path.display());
    println!("cargo:rerun-if-changed={}", schema_path.display());
    println!("cargo:rerun-if-changed=src/token_source.rs");

    let themes = token_source::resolve(
        &fs::read_to_string(&themes_path)?,
        &fs::read_to_string(&schema_path)?,
    )?;
    let output_dir = PathBuf::from(env::var_os("OUT_DIR").ok_or("OUT_DIR is not set")?);
    fs::write(
        output_dir.join("theme_tokens.rs"),
        token_source::render(&themes),
    )?;
    Ok(())
}
