//! The client's local settings, and the gates that make them binding.
//!
//! Two switches decide what may leave this machine besides gameplay
//! observations: "Send error reports" and "Send usage data". Both default on
//! and both are opt-out. A UI checkbox is only a way to flip them; what makes
//! "off" mean off is that the two sending layers — [`crate::reporting`] and
//! [`crate::telemetry`] — each hold a [`SendGate`] and refuse to send while it
//! is closed.
//!
//! Settings are one small JSON file in the per-user data directory, beside but
//! apart from the outbox: the outbox file is scoped to a backend and device
//! and is recreated on pairing, which must not reset a privacy choice.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// The file name inside the data directory.
pub const SETTINGS_FILE_NAME: &str = "settings.json";

/// Whether one kind of outbound data may be sent right now.
///
/// Cloned into every sender of that kind. It is a shared flag, so flipping it
/// takes effect for in-flight work on the next send, with no restart.
#[derive(Debug, Clone, Default)]
pub struct SendGate(Arc<AtomicBool>);

impl SendGate {
    /// A gate that starts open or closed.
    #[must_use]
    pub fn new(open: bool) -> Self {
        Self(Arc::new(AtomicBool::new(open)))
    }

    /// Whether sending is allowed right now.
    #[must_use]
    pub fn allows(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    /// Open or close the gate.
    pub fn set(&self, open: bool) {
        self.0.store(open, Ordering::SeqCst);
    }
}

/// The two privacy switches. Both default on; both are opt-out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PrivacySettings {
    /// Crash and error reports to Bugsink.
    pub send_error_reports: bool,
    /// Product events (`app_started` and the rest) to the Scout backend.
    pub send_usage_data: bool,
}

impl Default for PrivacySettings {
    fn default() -> Self {
        Self {
            send_error_reports: true,
            send_usage_data: true,
        }
    }
}

impl PrivacySettings {
    /// Everything off. Used when the stored file cannot be trusted: failing
    /// closed means a damaged file never sends something the user turned off.
    #[must_use]
    pub const fn all_off() -> Self {
        Self {
            send_error_reports: false,
            send_usage_data: false,
        }
    }
}

/// Both gates, driven from one [`PrivacySettings`].
#[derive(Debug, Clone, Default)]
pub struct PrivacyGates {
    /// Guards crash and error reports.
    pub error_reports: SendGate,
    /// Guards product events.
    pub usage_data: SendGate,
}

impl PrivacyGates {
    /// Gates that match `settings`.
    #[must_use]
    pub fn new(settings: PrivacySettings) -> Self {
        Self {
            error_reports: SendGate::new(settings.send_error_reports),
            usage_data: SendGate::new(settings.send_usage_data),
        }
    }

    /// Make the gates match `settings`.
    pub fn apply(&self, settings: PrivacySettings) {
        self.error_reports.set(settings.send_error_reports);
        self.usage_data.set(settings.send_usage_data);
    }
}

/// What is on disk: the privacy switches and the last version that ran, which
/// is how an applied update is noticed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSettings {
    #[serde(flatten)]
    privacy: PrivacySettings,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_run_version: Option<String>,
}

/// Why settings could not be read or written.
#[derive(Debug, Error)]
pub enum SettingsError {
    /// The file could not be read or written.
    #[error("settings file: {0}")]
    Io(#[from] std::io::Error),
    /// The file is not valid settings JSON.
    #[error("settings file is not valid: {0}")]
    Invalid(#[from] serde_json::Error),
}

/// The settings file.
#[derive(Debug, Clone)]
pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    /// A store backed by `path`.
    #[must_use]
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// A store in `directory`, under the standard file name.
    #[must_use]
    pub fn in_directory(directory: &Path) -> Self {
        Self::new(directory.join(SETTINGS_FILE_NAME))
    }

    fn read(&self) -> Result<StoredSettings, SettingsError> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) => Ok(serde_json::from_str(&text)?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(StoredSettings {
                privacy: PrivacySettings::default(),
                last_run_version: None,
            }),
            Err(error) => Err(error.into()),
        }
    }

    fn write(&self, stored: &StoredSettings) -> Result<(), SettingsError> {
        let temporary = self.path.with_extension("json.tmp");
        std::fs::write(&temporary, serde_json::to_vec_pretty(stored)?)?;
        std::fs::rename(&temporary, &self.path)?;
        Ok(())
    }

    /// The privacy switches. A missing file is the defaults (both on).
    ///
    /// # Errors
    ///
    /// Returns an error for an unreadable or malformed file; callers decide
    /// what to do about it, and the runtime fails closed.
    pub fn load(&self) -> Result<PrivacySettings, SettingsError> {
        Ok(self.read()?.privacy)
    }

    /// Persist the privacy switches, keeping everything else in the file.
    ///
    /// # Errors
    ///
    /// Returns an error when the file cannot be written.
    pub fn save(&self, settings: PrivacySettings) -> Result<(), SettingsError> {
        let mut stored = self.read().unwrap_or(StoredSettings {
            privacy: settings,
            last_run_version: None,
        });
        stored.privacy = settings;
        self.write(&stored)
    }

    /// Record the running version and return the previous one, when it
    /// differs: that difference is an applied update.
    ///
    /// # Errors
    ///
    /// Returns an error when the file cannot be read or written.
    pub fn note_run_version(&self, version: &str) -> Result<Option<String>, SettingsError> {
        let mut stored = self.read()?;
        let previous = stored.last_run_version.replace(version.to_owned());
        if previous.as_deref() == Some(version) {
            return Ok(None);
        }
        self.write(&stored)?;
        Ok(previous)
    }
}

#[cfg(test)]
mod tests {
    use super::{PrivacyGates, PrivacySettings, SettingsStore};

    fn store() -> Result<(tempdir::Dir, SettingsStore), Box<dyn std::error::Error>> {
        let directory = tempdir::Dir::new()?;
        let store = SettingsStore::in_directory(directory.path());
        Ok((directory, store))
    }

    /// A throwaway directory, removed on drop, without a new dependency.
    mod tempdir {
        use std::path::{Path, PathBuf};

        pub struct Dir(PathBuf);

        impl Dir {
            pub fn new() -> std::io::Result<Self> {
                let path =
                    std::env::temp_dir().join(format!("scout-settings-{}", uuid::Uuid::new_v4()));
                std::fs::create_dir_all(&path)?;
                Ok(Self(path))
            }

            pub fn path(&self) -> &Path {
                &self.0
            }
        }

        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    #[test]
    fn both_switches_default_on_when_nothing_is_stored() -> Result<(), Box<dyn std::error::Error>> {
        let (_directory, store) = store()?;
        let loaded = store.load()?;
        assert!(loaded.send_error_reports);
        assert!(loaded.send_usage_data);
        Ok(())
    }

    #[test]
    fn a_choice_survives_a_restart() -> Result<(), Box<dyn std::error::Error>> {
        let (directory, store) = store()?;
        store.save(PrivacySettings {
            send_error_reports: false,
            send_usage_data: true,
        })?;
        let reopened = SettingsStore::in_directory(directory.path());
        assert_eq!(
            reopened.load()?,
            PrivacySettings {
                send_error_reports: false,
                send_usage_data: true,
            }
        );
        Ok(())
    }

    #[test]
    fn a_damaged_file_is_an_error_not_silent_defaults() -> Result<(), Box<dyn std::error::Error>> {
        let (directory, store) = store()?;
        std::fs::write(directory.path().join("settings.json"), "{not json")?;
        assert!(store.load().is_err());
        Ok(())
    }

    #[test]
    fn an_applied_update_is_noticed_once() -> Result<(), Box<dyn std::error::Error>> {
        let (_directory, store) = store()?;
        // First run ever: nothing to compare against, but the version is kept.
        assert_eq!(store.note_run_version("0.1.0")?, None);
        assert_eq!(store.note_run_version("0.1.0")?, None);
        assert_eq!(store.note_run_version("0.2.0")?.as_deref(), Some("0.1.0"));
        assert_eq!(store.note_run_version("0.2.0")?, None);
        Ok(())
    }

    #[test]
    fn saving_privacy_keeps_the_recorded_version() -> Result<(), Box<dyn std::error::Error>> {
        let (_directory, store) = store()?;
        store.note_run_version("0.1.0")?;
        store.save(PrivacySettings::all_off())?;
        assert_eq!(store.note_run_version("0.2.0")?.as_deref(), Some("0.1.0"));
        Ok(())
    }

    #[test]
    fn gates_follow_the_settings() {
        let gates = PrivacyGates::new(PrivacySettings::default());
        assert!(gates.error_reports.allows() && gates.usage_data.allows());
        gates.apply(PrivacySettings {
            send_error_reports: true,
            send_usage_data: false,
        });
        assert!(gates.error_reports.allows());
        assert!(!gates.usage_data.allows());
    }
}
