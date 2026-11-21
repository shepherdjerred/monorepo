//! Embeds the Windows version resource: icon, product name and file version.

use std::error::Error;

#[path = "../../build-support/proactive_coach.rs"]
mod proactive_coach;

fn main() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-changed=../../assets/icon.ico");
    proactive_coach::emit()?;
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return Ok(());
    }
    // `scout-client-core` validates and compiles the profiles; the resource
    // only needs the product name of the same one.
    let channel = std::env::var("SCOUT_DESKTOP_PROFILE").unwrap_or_else(|_| "beta".to_owned());
    let profile_path = format!("../../release-profiles/{channel}.json");
    println!("cargo:rerun-if-changed={profile_path}");
    let profile: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(profile_path)?)?;
    let product_name = profile
        .get("product_name")
        .and_then(serde_json::Value::as_str)
        .ok_or("release profile has no product_name")?;
    let mut resource = winresource::WindowsResource::new();
    resource.set_icon("../../assets/icon.ico");
    resource.set("ProductName", product_name);
    resource.set("FileDescription", product_name);
    resource.compile()?;
    Ok(())
}
