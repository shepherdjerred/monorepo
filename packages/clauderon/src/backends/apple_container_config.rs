use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::warn;

use super::container_config::ResourceLimits;

/// Configuration for the Apple Container backend
///
/// This config can be loaded from `~/.clauderon/apple-container-config.toml`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppleContainerConfig {
    /// Custom container image to use (default: ghcr.io/anthropics/claude-code)
    pub container_image: Option<String>,

    /// Additional volume mounts in format "host_path:container_path[:ro]"
    #[serde(default)]
    pub additional_volumes: Vec<String>,

    /// Network configuration
    pub network: Option<String>,

    /// DNS nameservers
    #[serde(default)]
    pub dns: Vec<String>,

    /// Resource limits (CPU and memory)
    pub resources: Option<ResourceLimits>,
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
        // Validate container image format if provided
        if let Some(ref image) = self.container_image {
            if image.is_empty() {
                anyhow::bail!("Container image cannot be empty");
            }

            // Basic validation for image format
            if image.len() > 256 {
                anyhow::bail!("Container image name too long (max 256 characters)");
            }

            // Check for dangerous characters that could cause command injection
            let dangerous_chars = ['$', '`', ';', '&', '|', '<', '>', '(', ')', '{', '}'];
            if image.chars().any(|c| dangerous_chars.contains(&c)) {
                anyhow::bail!("Container image contains invalid characters: {}", image);
            }
        }

        // Validate additional volumes format
        for volume in &self.additional_volumes {
            if !volume.contains(':') {
                anyhow::bail!(
                    "Invalid volume format '{}': must be 'host:container' or 'host:container:ro'",
                    volume
                );
            }

            let parts: Vec<&str> = volume.split(':').collect();
            if parts.len() < 2 || parts.len() > 3 {
                anyhow::bail!(
                    "Invalid volume format '{}': must be 'host:container' or 'host:container:ro'",
                    volume
                );
            }

            // Validate readonly flag if present
            if parts.len() == 3 && parts[2] != "ro" {
                anyhow::bail!(
                    "Invalid volume format '{}': third part must be 'ro'",
                    volume
                );
            }
        }

        // Validate DNS addresses
        for dns in &self.dns {
            if dns.is_empty() {
                anyhow::bail!("DNS address cannot be empty");
            }
        }

        Ok(())
    }
}

impl Default for AppleContainerConfig {
    fn default() -> Self {
        Self {
            container_image: None,
            additional_volumes: vec![],
            network: None,
            dns: vec![],
            resources: None,
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
        assert!(config.additional_volumes.is_empty());
        assert!(config.network.is_none());
        assert!(config.dns.is_empty());
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

    #[test]
    fn test_validate_invalid_volume_format() {
        let config = AppleContainerConfig {
            additional_volumes: vec!["invalid_no_colon".to_string()],
            ..Default::default()
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validate_invalid_volume_parts() {
        let config = AppleContainerConfig {
            additional_volumes: vec!["a:b:c:d".to_string()],
            ..Default::default()
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validate_invalid_ro_flag() {
        let config = AppleContainerConfig {
            additional_volumes: vec!["/host:/container:rw".to_string()],
            ..Default::default()
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validate_valid_volumes() {
        let config = AppleContainerConfig {
            additional_volumes: vec![
                "/host:/container".to_string(),
                "/host2:/container2:ro".to_string(),
            ],
            ..Default::default()
        };
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_validate_empty_dns() {
        let config = AppleContainerConfig {
            dns: vec![String::new()],
            ..Default::default()
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validate_valid_dns() {
        let config = AppleContainerConfig {
            dns: vec!["8.8.8.8".to_string(), "1.1.1.1".to_string()],
            ..Default::default()
        };
        assert!(config.validate().is_ok());
    }
}
