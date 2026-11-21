//! The one rule for `cfg(scout_proactive_coach)`, shared by every crate's
//! `build.rs` that compiles part of the proactive coach (`#[path]`-included).
//!
//! Riot's published policy prohibits unprompted alerts from live game state,
//! so proactive coaching exists only in the beta release profile: the
//! detectors, the trigger sender, its IPC variant and its card are compiled
//! when the selected profile is beta and absent from a stable build.
//! `SCOUT_DESKTOP_PROFILE` selects it; an unset variable is a development
//! build, which is beta. Each crate sets the cfg from the same variable in the
//! same build, so the crates cannot disagree.

/// The cfg every proactive item is gated on.
pub const CFG: &str = "scout_proactive_coach";

/// Whether `profile` (the value of `SCOUT_DESKTOP_PROFILE`, if set) compiles
/// proactive coaching.
///
/// # Errors
///
/// A profile other than `stable` or `beta`, or a value that is not Unicode.
pub fn enabled(profile: Result<String, std::env::VarError>) -> Result<bool, String> {
    match profile {
        Err(std::env::VarError::NotPresent) => Ok(true),
        Ok(profile) if profile == "beta" => Ok(true),
        Ok(profile) if profile == "stable" => Ok(false),
        Ok(profile) => Err(format!(
            "SCOUT_DESKTOP_PROFILE must be stable or beta, not {profile:?}"
        )),
        Err(error) => Err(error.to_string()),
    }
}

/// Declare the cfg, and set it for the beta profile.
///
/// # Errors
///
/// As [`enabled`].
pub fn emit() -> Result<(), String> {
    println!("cargo:rerun-if-env-changed=SCOUT_DESKTOP_PROFILE");
    println!("cargo::rustc-check-cfg=cfg({CFG})");
    if enabled(std::env::var("SCOUT_DESKTOP_PROFILE"))? {
        println!("cargo::rustc-cfg={CFG}");
    }
    Ok(())
}
