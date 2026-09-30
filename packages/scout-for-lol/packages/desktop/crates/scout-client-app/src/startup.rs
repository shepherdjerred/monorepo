//! Per-user Windows and macOS start-at-login registration.

use auto_launch::{AutoLaunch, AutoLaunchBuilder};

fn registration(backend_origin: &str) -> Result<AutoLaunch, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let path = executable
        .to_str()
        .ok_or_else(|| "Scout Client executable path is not Unicode".to_owned())?;
    let mut builder = AutoLaunchBuilder::new();
    let server_argument = format!("--server={backend_origin}");
    builder
        .set_app_name("Scout Client")
        .set_app_path(path)
        .set_args(&["--background", &server_argument]);
    #[cfg(target_os = "macos")]
    builder.set_macos_launch_mode(auto_launch::MacOSLaunchMode::LaunchAgent);
    #[cfg(target_os = "windows")]
    builder.set_windows_enable_mode(auto_launch::WindowsEnableMode::CurrentUser);
    builder.build().map_err(|error| error.to_string())
}

/// Return whether the current user already starts Scout Client at login.
pub fn is_enabled(backend_origin: &str) -> Result<bool, String> {
    registration(backend_origin)?
        .is_enabled()
        .map_err(|error| error.to_string())
}

/// Enable or disable the current-user login registration.
pub fn set_enabled(backend_origin: &str, enabled: bool) -> Result<(), String> {
    let registration = registration(backend_origin)?;
    if enabled {
        registration.enable()
    } else {
        registration.disable()
    }
    .map_err(|error| error.to_string())
}
