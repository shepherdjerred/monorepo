//! Centralized path management for the Scout for LoL desktop application.
//!
//! All application data (config, logs, cache, sounds) is stored under a single
//! app data directory to keep things organized and easy to find.
//!
//! Directory structure:
//! ```
//! {app_data_dir}/
//! ├── config.json           # Application configuration
//! ├── logs/                  # All log files
//! │   ├── scout.log         # Main application log (Tauri plugin)
//! │   ├── scout-debug.log   # Debug log for sound/event debugging
//! │   └── startup-log.txt   # Startup diagnostics
//! └── cache/                 # Cached data
//!     ├── sounds/           # Extracted sound files
//!     │   └── base-beep.wav # Bundled beep sound
//!     └── youtube-audio/    # Downloaded YouTube audio
//! ```

use log::{error, info, warn};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Application identifier used for path resolution
const APP_IDENTIFIER: &str = "com.shepherdjerred.scout-for-lol";

/// Legacy application identifier from before proper app ID was set
const LEGACY_APP_IDENTIFIER: &str = "scout-for-lol";

/// Global app data directory, initialized once during app setup
static APP_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Computes the app data directory based on the platform.
/// This can be called before Tauri is initialized.
///
/// On Windows, this explicitly uses %LOCALAPPDATA% (Local) rather than %APPDATA% (Roaming)
/// because logs and cache data don't need to sync across machines.
#[must_use]
pub fn compute_app_data_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_IDENTIFIER)
}

/// Initialize the app data directory. Called during app setup.
/// If already initialized (from early init), this is a no-op.
pub fn init(app_data_dir: &Path) {
    // Try to set, but don't panic if already set (from early_init)
    let _ = APP_DATA_DIR.set(app_data_dir.to_path_buf());
    info!("App data directory: {}", app_data_dir.display());
}

/// Early initialization using computed paths (before Tauri setup).
/// Call this from main() before building the Tauri app.
pub fn early_init() {
    let app_data_dir = compute_app_data_dir();
    let _ = APP_DATA_DIR.set(app_data_dir);
}

/// Returns the base app data directory.
///
/// # Panics
/// Panics if `init()` has not been called.
#[must_use]
#[allow(clippy::expect_used)]
pub fn app_data_dir() -> &'static PathBuf {
    APP_DATA_DIR
        .get()
        .expect("App data directory not initialized - call paths::init() first")
}

/// Returns the base app data directory if initialized, or None.
/// Useful for code that runs before initialization.
#[must_use]
pub fn try_app_data_dir() -> Option<&'static PathBuf> {
    APP_DATA_DIR.get()
}

/// Returns the path to the config file.
#[must_use]
pub fn config_file() -> PathBuf {
    app_data_dir().join("config.json")
}

/// Returns the path to the sound pack file.
#[must_use]
pub fn sound_pack_file() -> PathBuf {
    app_data_dir().join("sound-pack.json")
}

/// Returns the logs directory.
#[must_use]
pub fn logs_dir() -> PathBuf {
    app_data_dir().join("logs")
}

/// Returns the path to the debug log file.
#[must_use]
pub fn debug_log_file() -> PathBuf {
    logs_dir().join("scout-debug.log")
}

/// Returns the path to the startup log file.
#[must_use]
pub fn startup_log_file() -> PathBuf {
    logs_dir().join("startup-log.txt")
}

/// Returns the cache directory.
#[must_use]
pub fn cache_dir() -> PathBuf {
    app_data_dir().join("cache")
}

/// Returns the sounds cache directory.
#[must_use]
pub fn sounds_cache_dir() -> PathBuf {
    cache_dir().join("sounds")
}

/// Returns the path to the base beep sound file.
#[must_use]
pub fn base_beep_file() -> PathBuf {
    sounds_cache_dir().join("base-beep.wav")
}

/// Returns the YouTube audio cache directory.
#[must_use]
pub fn youtube_cache_dir() -> PathBuf {
    cache_dir().join("youtube-audio")
}

/// Ensures all required directories exist.
/// Call this after `init()` to create the directory structure.
pub fn ensure_directories() {
    let dirs = [logs_dir(), sounds_cache_dir(), youtube_cache_dir()];

    for dir in &dirs {
        if !dir.exists() {
            if let Err(err) = std::fs::create_dir_all(dir) {
                error!("Failed to create directory {}: {}", dir.display(), err);
            } else {
                info!("Created directory: {}", dir.display());
            }
        }
    }
}

/// Computes the legacy app data directory path.
/// Returns the path where older versions of the app stored data.
#[must_use]
fn legacy_app_data_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(LEGACY_APP_IDENTIFIER)
}

/// Migrates data from the legacy app directory to the new location.
/// This handles the transition from "scout-for-lol" to "com.shepherdjerred.scout-for-lol".
/// Call this after `init()` and `ensure_directories()`.
pub fn migrate_from_legacy() {
    let legacy_dir = legacy_app_data_dir();
    let new_dir = app_data_dir();

    // If legacy directory doesn't exist, nothing to migrate
    if !legacy_dir.exists() {
        return;
    }

    info!(
        "Found legacy data directory at {}, checking for data to migrate...",
        legacy_dir.display()
    );

    // Files to potentially migrate
    let files_to_migrate = ["config.json", "sound-pack.json"];

    for filename in &files_to_migrate {
        let legacy_file = legacy_dir.join(filename);
        let new_file = new_dir.join(filename);

        // Only migrate if legacy file exists and new file doesn't
        if legacy_file.exists() && !new_file.exists() {
            info!(
                "Migrating {} from legacy location to {}",
                filename,
                new_file.display()
            );

            match std::fs::copy(&legacy_file, &new_file) {
                Ok(_) => {
                    info!("Successfully migrated {}", filename);
                }
                Err(err) => {
                    warn!(
                        "Failed to migrate {} from legacy location: {}",
                        filename, err
                    );
                }
            }
        }
    }

    // Optionally warn the user about the old directory
    warn!(
        "Legacy data directory exists at {}. You may safely delete this directory after verifying your data has been migrated.",
        legacy_dir.display()
    );
}

/// Computes the Roaming app data directory path (Windows only).
/// Tauri uses %APPDATA% (Roaming) by default, but we use %LOCALAPPDATA% (Local).
/// This function helps migrate any data that might have been written to Roaming.
#[cfg(target_os = "windows")]
#[must_use]
fn roaming_app_data_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join(APP_IDENTIFIER))
}

/// Migrates data from the Roaming AppData directory to Local (Windows only).
/// This handles the case where Tauri or plugins may have written to %APPDATA%
/// instead of our preferred %LOCALAPPDATA%.
/// Call this after `init()` and `ensure_directories()`.
#[cfg(target_os = "windows")]
pub fn migrate_from_roaming() {
    let Some(roaming_dir) = roaming_app_data_dir() else {
        return;
    };
    let local_dir = app_data_dir();

    // If roaming directory doesn't exist, nothing to migrate
    if !roaming_dir.exists() {
        return;
    }

    // Don't migrate if roaming and local are the same path
    if roaming_dir == *local_dir {
        return;
    }

    info!(
        "Found Roaming data directory at {}, checking for data to migrate to Local...",
        roaming_dir.display()
    );

    // Files to potentially migrate
    let files_to_migrate = ["config.json", "sound-pack.json"];

    for filename in &files_to_migrate {
        let roaming_file = roaming_dir.join(filename);
        let local_file = local_dir.join(filename);

        // Only migrate if roaming file exists and local file doesn't
        if roaming_file.exists() && !local_file.exists() {
            info!(
                "Migrating {} from Roaming to Local: {}",
                filename,
                local_file.display()
            );

            match std::fs::copy(&roaming_file, &local_file) {
                Ok(_) => {
                    info!("Successfully migrated {} from Roaming to Local", filename);
                }
                Err(err) => {
                    warn!(
                        "Failed to migrate {} from Roaming to Local: {}",
                        filename, err
                    );
                }
            }
        }
    }

    // Migrate logs directory if it exists in Roaming
    let roaming_logs = roaming_dir.join("logs");
    let local_logs = logs_dir();
    if roaming_logs.exists() && roaming_logs.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&roaming_logs) {
            for entry in entries.flatten() {
                let roaming_log = entry.path();
                if roaming_log.is_file() {
                    if let Some(filename) = roaming_log.file_name() {
                        let local_log = local_logs.join(filename);
                        if !local_log.exists() {
                            if let Err(err) = std::fs::copy(&roaming_log, &local_log) {
                                warn!(
                                    "Failed to migrate log file {:?} from Roaming to Local: {}",
                                    filename, err
                                );
                            } else {
                                info!("Migrated log file {:?} from Roaming to Local", filename);
                            }
                        }
                    }
                }
            }
        }
    }

    warn!(
        "Roaming data directory exists at {}. You may safely delete this directory after verifying your data has been migrated to {}.",
        roaming_dir.display(),
        local_dir.display()
    );
}

/// No-op on non-Windows platforms (Roaming/Local split is Windows-specific)
#[cfg(not(target_os = "windows"))]
pub fn migrate_from_roaming() {
    // Roaming vs Local AppData is a Windows-specific concern
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: These tests use a different initialization approach since
    // OnceLock can only be set once per process

    #[test]
    fn test_path_structure() {
        // Test that path building works correctly without relying on global state
        let base = PathBuf::from("/test/app/data");

        assert_eq!(
            base.join("config.json"),
            PathBuf::from("/test/app/data/config.json")
        );
        assert_eq!(base.join("logs"), PathBuf::from("/test/app/data/logs"));
        assert_eq!(
            base.join("logs").join("scout-debug.log"),
            PathBuf::from("/test/app/data/logs/scout-debug.log")
        );
        assert_eq!(
            base.join("cache").join("sounds").join("base-beep.wav"),
            PathBuf::from("/test/app/data/cache/sounds/base-beep.wav")
        );
        assert_eq!(
            base.join("cache").join("youtube-audio"),
            PathBuf::from("/test/app/data/cache/youtube-audio")
        );
    }
}
