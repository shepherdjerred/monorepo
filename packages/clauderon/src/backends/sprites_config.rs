use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::{debug, info, warn};

/// Lifecycle configuration for sprites
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct SpritesLifecycle {
    /// Automatically destroy sprite on session deletion
    /// If false, sprite persists for reuse (incurs storage costs)
    #[serde(default)]
    pub auto_destroy: bool,

    /// Automatically checkpoint sprite before hibernation
    /// Enables faster cold starts (~300ms) at cost of storage
    #[serde(default)]
    pub auto_checkpoint: bool,
}

/// Git repository configuration for sprites
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpritesGit {
    /// Use shallow clone (--depth 1) for faster cloning
    /// Shallow clones are faster but may break git describe, rebasing, etc.
    #[serde(default = "default_shallow_clone")]
    pub shallow_clone: bool,
}

fn default_shallow_clone() -> bool {
    true
}

impl Default for SpritesGit {
    fn default() -> Self {
        Self {
            shallow_clone: default_shallow_clone(),
        }
    }
}

/// Complete sprites.dev backend configuration
///
/// Note: The sprites CLI handles authentication via `sprite login` or the
/// SPRITES_TOKEN environment variable. Resource allocation (CPU, memory)
/// and image selection are not configurable - sprites use a fixed environment
/// of Ubuntu 24.04 with 8 vCPUs, 8GB RAM, and 100GB storage.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct SpritesConfig {
    /// Lifecycle management
    #[serde(default)]
    pub lifecycle: SpritesLifecycle,

    /// Git repository configuration
    #[serde(default)]
    pub git: SpritesGit,
}

impl SpritesConfig {
    /// Load Sprites configuration from `~/.clauderon/sprites-config.toml`.
    ///
    /// Returns an error if the file exists but cannot be parsed.
    /// Returns `Ok(None)` if the file doesn't exist.
    pub fn load() -> anyhow::Result<Option<Self>> {
        let config_path = Self::config_path()?;

        if !config_path.exists() {
            debug!(
                path = %config_path.display(),
                "Sprites config file not found, will use defaults"
            );
            return Ok(None);
        }

        info!(
            path = %config_path.display(),
            "Loading Sprites configuration"
        );

        let contents = std::fs::read_to_string(&config_path).map_err(|e| {
            anyhow::anyhow!(
                "Failed to read Sprites config file at {}: {}",
                config_path.display(),
                e
            )
        })?;

        let config: Self = toml::from_str(&contents).map_err(|e| {
            anyhow::anyhow!(
                "Failed to parse Sprites config file at {}: {}",
                config_path.display(),
                e
            )
        })?;

        info!(
            auto_destroy = config.lifecycle.auto_destroy,
            shallow_clone = config.git.shallow_clone,
            "Sprites configuration loaded successfully"
        );

        Ok(Some(config))
    }

    /// Load configuration from file, or return default if file doesn't exist.
    ///
    /// This is the recommended method for most use cases.
    /// Returns an error only if the file exists but is invalid.
    #[must_use]
    pub fn load_or_default() -> Self {
        match Self::load() {
            Ok(Some(config)) => config,
            Ok(None) => {
                debug!("Using default Sprites configuration");
                Self::default()
            }
            Err(e) => {
                warn!(
                    error = %e,
                    "Failed to load Sprites config, using defaults"
                );
                Self::default()
            }
        }
    }

    /// Get the path to the Sprites configuration file.
    ///
    /// Returns `~/.clauderon/sprites-config.toml`
    pub fn config_path() -> anyhow::Result<PathBuf> {
        let home = dirs::home_dir()
            .ok_or_else(|| anyhow::anyhow!("Failed to determine home directory"))?;
        Ok(home.join(".clauderon").join("sprites-config.toml"))
    }

    /// Check if Sprites is available for use in the UI.
    ///
    /// Sprites is a cloud service and is always available for selection.
    /// Actual credential connectivity (proxy vs dangerous_copy_creds) is
    /// checked during session creation.
    #[must_use]
    pub fn is_connected_mode(&self) -> bool {
        // Sprites is always available to show in the picker
        // The create flow handles credential configuration
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_path() {
        let path = SpritesConfig::config_path().unwrap();
        assert!(path.ends_with(".clauderon/sprites-config.toml"));
    }

    #[test]
    fn test_load_nonexistent_returns_none() {
        // This test assumes the file doesn't exist in the test environment
        let result = SpritesConfig::load();
        assert!(result.is_ok());
    }

    #[test]
    fn test_load_or_default_returns_default() {
        let config = SpritesConfig::load_or_default();
        // Should return a valid config (either loaded or default)
        assert!(config.git.shallow_clone); // default is true
    }

    #[test]
    fn test_default_config() {
        let config = SpritesConfig::default();
        assert!(!config.lifecycle.auto_destroy);
        assert!(!config.lifecycle.auto_checkpoint);
        assert!(config.git.shallow_clone);
    }

    #[test]
    fn test_toml_serialization() {
        let config = SpritesConfig {
            lifecycle: SpritesLifecycle {
                auto_destroy: true,
                auto_checkpoint: true,
            },
            git: SpritesGit {
                shallow_clone: false,
            },
        };

        let toml = toml::to_string(&config).unwrap();
        let deserialized: SpritesConfig = toml::from_str(&toml).unwrap();

        assert_eq!(deserialized.lifecycle, config.lifecycle);
        assert_eq!(deserialized.git, config.git);
    }

    #[test]
    fn test_toml_deserialization_with_defaults() {
        // Test that missing fields use defaults
        let toml = r"
[lifecycle]
auto_destroy = true
";
        let config: SpritesConfig = toml::from_str(toml).unwrap();
        assert!(config.lifecycle.auto_destroy);
        assert!(!config.lifecycle.auto_checkpoint); // default
        assert!(config.git.shallow_clone); // default
    }
}
