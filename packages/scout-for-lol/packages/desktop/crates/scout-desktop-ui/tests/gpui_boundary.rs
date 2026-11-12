//! gpui-kit pins a pre-1.0 GPUI snapshot. Only `scout-desktop-ui` may depend
//! on it, and only where the window runs, so an upgrade touches one crate and
//! Linux CI never needs GUI libraries.

use std::process::Command;

use serde_json::Value;

const UI_CRATE: &str = "scout-desktop-ui";
const WINDOW_TARGETS: &[&str] = &[
    "cfg(any(windows, target_os = \"macos\"))",
    "cfg(target_os = \"macos\")",
];

fn is_gpui(package: &str) -> bool {
    package == "gpui" || package.starts_with("gpui-")
}

fn workspace_metadata() -> Result<Value, Box<dyn std::error::Error>> {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());
    let manifest = concat!(env!("CARGO_MANIFEST_DIR"), "/../../Cargo.toml");
    let output = Command::new(cargo)
        .args([
            "metadata",
            "--format-version",
            "1",
            "--no-deps",
            "--offline",
        ])
        .args(["--manifest-path", manifest])
        .output()?;
    if !output.status.success() {
        return Err(format!(
            "cargo metadata failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    Ok(serde_json::from_slice(&output.stdout)?)
}

/// `(member, dependency package, kind, target)`.
type Declared = (String, String, String, String);

/// Every declared dependency of every workspace member.
fn declared_dependencies() -> Result<Vec<Declared>, Box<dyn std::error::Error>> {
    let metadata = workspace_metadata()?;
    let packages = metadata["packages"]
        .as_array()
        .ok_or("cargo metadata has no packages")?;
    let mut declared = Vec::new();
    for package in packages {
        let member = package["name"].as_str().ok_or("package without a name")?;
        for dependency in package["dependencies"]
            .as_array()
            .ok_or("package without dependencies")?
        {
            declared.push((
                member.to_owned(),
                dependency["name"]
                    .as_str()
                    .ok_or("dependency without a name")?
                    .to_owned(),
                dependency["kind"].as_str().unwrap_or("normal").to_owned(),
                dependency["target"].as_str().unwrap_or("").to_owned(),
            ));
        }
    }
    Ok(declared)
}

#[test]
fn only_the_ui_crate_depends_on_gpui() -> Result<(), Box<dyn std::error::Error>> {
    let declared = declared_dependencies()?;
    let members = declared
        .iter()
        .map(|(member, ..)| member.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    assert!(
        members.contains(UI_CRATE) && members.contains("scout-client-app"),
        "cargo metadata did not list the workspace: {members:?}"
    );
    let outside = declared
        .iter()
        .filter(|(member, package, ..)| member != UI_CRATE && is_gpui(package))
        .collect::<Vec<_>>();
    assert!(
        outside.is_empty(),
        "only {UI_CRATE} may depend on gpui-kit or GPUI: {outside:?}"
    );
    Ok(())
}

#[test]
fn the_ui_crate_takes_gpui_only_on_windows_and_macos() -> Result<(), Box<dyn std::error::Error>> {
    let gpui = declared_dependencies()?
        .into_iter()
        .filter(|(member, package, ..)| member == UI_CRATE && is_gpui(package))
        .collect::<Vec<_>>();
    for required in ["gpui-kit", "gpui-pre"] {
        assert!(
            gpui.iter()
                .any(|(_, package, kind, _)| package == required && kind == "normal"),
            "{UI_CRATE} should depend on {required}: {gpui:?}"
        );
    }
    let ungated = gpui
        .iter()
        .filter(|(.., target)| !WINDOW_TARGETS.contains(&target.as_str()))
        .collect::<Vec<_>>();
    assert!(
        ungated.is_empty(),
        "GPUI dependencies must be gated to Windows and macOS: {ungated:?}"
    );
    Ok(())
}
