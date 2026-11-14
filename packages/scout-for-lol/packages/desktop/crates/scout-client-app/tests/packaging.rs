//! The cargo-packager configs and the compiled release profiles name the same
//! product, so an installer cannot ship a binary that believes it is another.

use std::error::Error;
use std::fs;
use std::path::Path;

use serde_json::Value;

fn read(relative: &str) -> Result<Value, Box<dyn Error>> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative);
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, Box<dyn Error>> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing {key}").into())
}

#[test]
fn each_installer_config_matches_its_release_profile() -> Result<(), Box<dyn Error>> {
    for channel in ["stable", "beta"] {
        let profile = read(&format!("release-profiles/{channel}.json"))?;
        let packager = read(&format!("packaging/{channel}.json"))?;
        assert_eq!(
            text(&packager, "productName")?,
            text(&profile, "product_name")?
        );
        assert_eq!(
            text(&packager, "identifier")?,
            text(&profile, "identifier")?
        );
        assert_eq!(text(&packager, "outDir")?, format!("../dist/{channel}"));
        assert_eq!(
            text(&packager["binaries"][0], "path")?,
            text(&profile, "binary_name")?,
            "the installer ships the profile's binary name"
        );
        assert_eq!(packager["binaries"][0]["main"], true);
        assert!(
            text(&packager, "beforePackagingCommand")?.ends_with(&format!(" {channel}")),
            "the staged binary is built with this channel's profile"
        );
        assert_eq!(
            packager["nsis"]["installMode"], "currentUser",
            "Windows installs per user"
        );
    }
    Ok(())
}

#[test]
fn only_the_stable_installer_removes_the_old_scout_client() -> Result<(), Box<dyn Error>> {
    let stable = read("packaging/stable.json")?;
    let hook = text(&stable["nsis"], "preinstallSection")?;
    assert!(hook.contains("Uninstall\\Scout Client"));
    assert!(hook.contains("/S _?="));
    let beta = read("packaging/beta.json")?;
    assert!(beta["nsis"].get("preinstallSection").is_none());
    Ok(())
}

#[test]
fn beta_and_stable_install_beside_each_other() -> Result<(), Box<dyn Error>> {
    let stable = read("release-profiles/stable.json")?;
    let beta = read("release-profiles/beta.json")?;
    // NSIS kills a running process by this name before installing, so a shared
    // name would make installing one close the other.
    assert_ne!(text(&stable, "binary_name")?, text(&beta, "binary_name")?);
    assert_ne!(text(&stable, "product_name")?, text(&beta, "product_name")?);
    // Stable ships the cargo binary under its own name; beta is renamed when
    // staged, which `scripts/prepare-package.ts` does.
    let cargo_binary = Path::new(env!("CARGO_BIN_EXE_scout-client"));
    assert_eq!(
        cargo_binary.file_stem().and_then(|stem| stem.to_str()),
        Some(text(&stable, "binary_name")?)
    );
    Ok(())
}
