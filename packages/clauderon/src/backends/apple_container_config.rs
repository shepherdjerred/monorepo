use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::warn;

use super::container_config::{ImageConfig, ImagePullPolicy, ResourceLimits};

/// Configuration for the Apple Container backend
///
/// This config can be loaded from `~/.clauderon/apple-container-config.toml`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppleContainerConfig {
    /// Custom container image to use (default: ghcr.io/anthropics/claude-code)
    pub container_image: Option<String>,

    /// Resource limits (CPU and memory)
    pub resources: Option<ResourceLimits>,

    /// Extra flags to pass to `container run` command
    ///
    /// Advanced users can add custom flags for specific use cases.
    /// Example: `["--privileged", "--cap-add=SYS_ADMIN"]`
    ///
    /// WARNING: Use with caution. Incorrect flags can break container creation.
    #[serde(default)]
    pub extra_flags: Vec<String>,
}

impl AppleContainerConfig {
    /// Get the path to the config file
    ///
    /// # Errors
    ///
    /// Returns an error if the home directory cannot be determined.
    pub fn config_path() -> anyhow::Result<PathBuf> {
        let home = std::env::var("HOME").context("Failed to get HOME environment variable")?;
        Ok(PathBuf::from(home)
            .join(".clauderon")
            .join("apple-container-config.toml"))
    }

    /// Load the config from the TOML file
    ///
    /// Returns `None` if the file doesn't exist.
    ///
    /// # Errors
    ///
    /// Returns an error if the file exists but cannot be read or parsed.
    pub fn load() -> anyhow::Result<Option<Self>> {
        let config_path = Self::config_path()?;

        if !config_path.exists() {
            return Ok(None);
        }

        let contents = std::fs::read_to_string(&config_path)
            .with_context(|| format!("Failed to read config from {}", config_path.display()))?;

        let config: Self = toml::from_str(&contents).with_context(|| {
            format!(
                "Failed to parse Apple Container config from {}",
                config_path.display()
            )
        })?;

        config.validate()?;

        Ok(Some(config))
    }

    /// Load the config or return default if it doesn't exist or fails to load
    #[must_use]
    pub fn load_or_default() -> Self {
        match Self::load() {
            Ok(Some(config)) => config,
            Ok(None) => {
                tracing::debug!("Apple Container config not found, using defaults");
                Self::default()
            }
            Err(e) => {
                warn!(
                    error = %e,
                    "Failed to load Apple Container config, using defaults"
                );
                Self::default()
            }
        }
    }

    /// Validate the configuration
    ///
    /// # Errors
    ///
    /// Returns an error if any configuration values are invalid.
    pub fn validate(&self) -> anyhow::Result<()> {
        // Validate container image format using ImageConfig validation
        // This ensures consistency with Docker and Kubernetes backends
        if let Some(ref image) = self.container_image {
            let image_config = ImageConfig {
                image: image.clone(),
                pull_policy: ImagePullPolicy::IfNotPresent,
                registry_auth: None,
            };
            image_config
                .validate()
                .context("Invalid container image")?;
        }

        // Validate resource limits if provided
        if let Some(ref resources) = self.resources {
            resources.validate().context("Invalid resource limits")?;
        }

        Ok(())
    }
}

impl Default for AppleContainerConfig {
    fn default() -> Self {
        Self {
            container_image: None,
            resources: None,
            extra_flags: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AppleContainerConfig::default();
        assert!(config.container_image.is_none());
        assert!(config.resources.is_none());
    }

    #[test]
    fn test_validate_empty_image() {
        let config = AppleContainerConfig {
            container_image: Some(String::new()),
            ..Default::default()
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validate_long_image() {
        let config = AppleContainerConfig {
            container_image: Some("a".repeat(300)),
            ..Default::default()
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validate_dangerous_chars_in_image() {
        let dangerous_images = vec![
            "image$injection",
            "image`command`",
            "image;rm -rf /",
            "image&background",
            "image|pipe",
        ];

        for image in dangerous_images {
            let config = AppleContainerConfig {
                container_image: Some(image.to_string()),
                ..Default::default()
            };
            assert!(
                config.validate().is_err(),
                "Should reject image with dangerous char: {}",
                image
            );
        }
    }

    #[test]
    fn test_validate_valid_image() {
        let config = AppleContainerConfig {
            container_image: Some("ghcr.io/anthropics/claude-code:latest".to_string()),
            ..Default::default()
        };
        assert!(config.validate().is_ok());
    }
}
