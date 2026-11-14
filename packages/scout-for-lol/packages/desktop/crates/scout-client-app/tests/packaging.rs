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
