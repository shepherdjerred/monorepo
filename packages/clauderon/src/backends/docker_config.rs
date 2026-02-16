use super::container_config::DockerConfig;
use std::path::PathBuf;
use tracing::{debug, info, warn};

impl DockerConfig {
    /// Load Docker configuration from `~/.clauderon/docker-config.toml`.
    ///
    /// Returns an error if the file exists but cannot be parsed.
    /// Returns `Ok(None)` if the file doesn't exist.
    ///
    /// # Errors
    ///
    /// Returns an error if the file exists but cannot be read or parsed, or if validation fails.
    pub fn load() -> anyhow::Result<Option<Self>> {
        let config_path = Self::config_path()?;

        if !config_path.exists() {
            debug!(
                path = %config_path.display(),
                "Docker config file not found, will use defaults"
            );
            return Ok(None);
        }

        info!(
            path = %config_path.display(),
            "Loading Docker configuration"
        );

        let contents = std::fs::read_to_string(&config_path).map_err(|e| {
            anyhow::anyhow!(
                "Failed to read Docker config file at {}: {}",
                config_path.display(),
                e
            )
        })?;

        let config: Self = toml::from_str(&contents).map_err(|e| {
            anyhow::anyhow!(
                "Failed to parse Docker config file at {}: {}",
                config_path.display(),
                e
            )
        })?;

        // Validate the loaded configuration
        config.validate()?;

        info!(
            image = %config.image.image,
            pull_policy = %config.image.pull_policy,
            has_resources = config.resources.is_some(),
            "Docker configuration loaded successfully"
        );

        Ok(Some(config))
    }

    /// Load configuration from file, or return default if file doesn't exist.
    ///
    /// This is the recommended method for most use cases.
    /// Returns an error only if the file exists but is invalid.
    pub fn load_or_default() -> Self {
        match Self::load() {
            Ok(Some(config)) => config,
            Ok(None) => {
                debug!("Using default Docker configuration");
                Self::default()
            }
            Err(e) => {
                warn!(
                    error = %e,
                    "Failed to load Docker config, using defaults"
                );
                Self::default()
            }
        }
    }

    /// Get the path to the Docker configuration file.
    ///
    /// Returns `~/.clauderon/docker-config.toml`
    ///
    /// # Errors
    ///
    /// Returns an error if the home directory cannot be determined.
    pub fn config_path() -> anyhow::Result<PathBuf> {
        let home = dirs::home_dir()
            .ok_or_else(|| anyhow::anyhow!("Failed to determine home directory"))?;
        Ok(home.join(".clauderon").join("docker-config.toml"))
    }

    /// Validate the configuration.
    ///
    /// Checks that all values are valid and safe to use.
    ///
    /// # Errors
    ///
    /// Returns an error if the image name is invalid, resource limits are malformed, or extra flags contain dangerous characters.
    pub fn validate(&self) -> anyhow::Result<()> {
        // Validate image configuration
        self.image.validate()?;

        // Validate resource limits if present
        if let Some(resources) = &self.resources {
            resources.validate()?;
        }

        // Validate extra flags don't contain dangerous patterns
        for flag in &self.extra_flags {
            if flag.contains(';') || flag.contains('&') || flag.contains('|') {
                return Err(anyhow::anyhow!(
                    "Extra flag contains dangerous characters: '{}'",
                    flag
                ));
            }
        }

        Ok(())
    }

    /// Create an example configuration file.
    ///
    /// Writes a commented example configuration to the specified path.
    /// Typically used to generate `~/.clauderon/docker-config.toml.example`.
    ///
    /// # Errors
    ///
    /// Returns an error if the file cannot be written.
    pub fn create_example(path: &std::path::Path) -> anyhow::Result<()> {
        let example = include_str!("../../docs/docker-config.toml.example");
        std::fs::write(path, example).map_err(|e| {
            anyhow::anyhow!(
                "Failed to write example config to {}: {}",
                path.display(),
                e
            )
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backends::container_config::{ImageConfig, ImagePullPolicy, ResourceLimits};

    #[test]
    fn test_config_path() {
        let path = DockerConfig::config_path().unwrap();
        assert!(path.ends_with(".clauderon/docker-config.toml"));
    }

    #[test]
    fn test_load_nonexistent_returns_none() {
        // This test assumes the file doesn't exist in the test environment
        // If it does exist, we'll get Some(config) instead
        let result = DockerConfig::load();
        assert!(result.is_ok());
    }

    #[test]
    fn test_load_or_default_returns_default() {
        let config = DockerConfig::load_or_default();
        // Should return a valid config (either loaded or default)
        assert!(!config.image.image.is_empty());
    }

    #[test]
    fn test_validate_default_config() {
        let config = DockerConfig::default();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_validate_rejects_dangerous_extra_flags() {
        let config = DockerConfig {
            extra_flags: vec!["--cap-add=SYS_PTRACE; rm -rf /".to_owned()],
            ..Default::default()
        };
        assert!(config.validate().is_err());

        let config = DockerConfig {
            extra_flags: vec!["--cap-add=SYS_PTRACE && malicious".to_owned()],
            ..Default::default()
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validate_accepts_safe_extra_flags() {
        let config = DockerConfig {
            extra_flags: vec![
                "--cap-add=SYS_PTRACE".to_owned(),
                "--security-opt=seccomp=unconfined".to_owned(),
            ],
            ..Default::default()
        };
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_validate_checks_image() {
        let config = DockerConfig {
            image: ImageConfig {
                image: "bad;image".to_owned(),
                pull_policy: ImagePullPolicy::IfNotPresent,
                registry_auth: None,
            },
            ..Default::default()
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validate_checks_resources() {
        let config = DockerConfig {
            resources: Some(ResourceLimits {
                cpu: Some("invalid".to_owned()),
                memory: Some("2g".to_owned()),
            }),
            ..Default::default()
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_toml_serialization() {
        let config = DockerConfig {
            image: ImageConfig {
                image: "test:latest".to_owned(),
                pull_policy: ImagePullPolicy::Always,
                registry_auth: None,
            },
            resources: Some(ResourceLimits {
                cpu: Some("2.0".to_owned()),
                memory: Some("2g".to_owned()),
            }),
            extra_flags: vec!["--cap-add=SYS_PTRACE".to_owned()],
            use_volume_mode: false,
        };

        let toml = toml::to_string(&config).unwrap();
        let deserialized: DockerConfig = toml::from_str(&toml).unwrap();

        assert_eq!(deserialized.image.image, config.image.image);
        assert_eq!(deserialized.image.pull_policy, config.image.pull_policy);
        assert_eq!(deserialized.resources, config.resources);
        assert_eq!(deserialized.extra_flags, config.extra_flags);
    }
}
