use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::{debug, info, warn};

/// Network policy for sprites
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum NetworkPolicy {
    /// Allow all network access
    #[default]
    AllowAll,
    /// Block all network access
    BlockAll,
    /// Allow only specified domains (allowlist)
    AllowList,
}

impl std::fmt::Display for NetworkPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AllowAll => write!(f, "allow-all"),
            Self::BlockAll => write!(f, "block-all"),
            Self::AllowList => write!(f, "allow-list"),
        }
    }
}

/// Resource configuration for sprites
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpritesResources {
    /// Number of CPU cores (1-8)
    #[serde(default)]
    pub cpu: Option<u8>,

    /// Memory in gigabytes (1-16)
    #[serde(default)]
    pub memory: Option<u8>,
}

impl Default for SpritesResources {
    fn default() -> Self {
        Self {
            cpu: Some(2),
            memory: Some(4),
        }
    }
}

impl SpritesResources {
    /// Validate resource limits
    ///
    /// Checks that CPU and memory are within sprites.dev limits.
    pub fn validate(&self) -> anyhow::Result<()> {
        if let Some(cpu) = self.cpu {
            if !(1..=8).contains(&cpu) {
                return Err(anyhow::anyhow!(
                    "CPU must be between 1 and 8 cores, got: {}",
                    cpu
                ));
            }
        }

        if let Some(memory) = self.memory {
            if !(1..=16).contains(&memory) {
                return Err(anyhow::anyhow!(
                    "Memory must be between 1 and 16 GB, got: {}",
                    memory
                ));
            }
        }

        Ok(())
    }
}

/// Lifecycle configuration for sprites
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

impl Default for SpritesLifecycle {
    fn default() -> Self {
        Self {
            auto_destroy: false,
            auto_checkpoint: false,
        }
    }
}

/// Network configuration for sprites
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpritesNetwork {
    /// Default network policy
    #[serde(default)]
    pub default_policy: NetworkPolicy,

    /// Allowed domains when policy is AllowList
    /// Supports wildcards (e.g., "*.github.com")
    #[serde(default = "default_allowed_domains")]
    pub allowed_domains: Vec<String>,
}

fn default_allowed_domains() -> Vec<String> {
    vec![
        "api.anthropic.com".to_string(),
        "github.com".to_string(),
        "*.githubusercontent.com".to_string(),
        "crates.io".to_string(),
        "static.crates.io".to_string(),
        "index.crates.io".to_string(),
    ]
}

impl Default for SpritesNetwork {
    fn default() -> Self {
        Self {
            default_policy: NetworkPolicy::AllowAll,
            allowed_domains: default_allowed_domains(),
        }
    }
}

/// Image configuration for sprites
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpritesImage {
    /// Base image to use for sprites
    /// Default: "ubuntu:22.04" (standard Ubuntu LTS)
    #[serde(default = "default_base_image")]
    pub base_image: String,

    /// Automatically install Claude Code if not present in image
    #[serde(default = "default_install_claude")]
    pub install_claude: bool,

    /// Additional packages to install via apt-get
    /// Example: ["git", "curl", "build-essential"]
    #[serde(default)]
    pub packages: Vec<String>,
}

fn default_base_image() -> String {
    "ubuntu:22.04".to_string()
}

fn default_install_claude() -> bool {
    true
}

impl Default for SpritesImage {
    fn default() -> Self {
        Self {
            base_image: default_base_image(),
            install_claude: default_install_claude(),
            packages: vec![],
        }
    }
}

impl SpritesImage {
    /// Validate image configuration
    pub fn validate(&self) -> anyhow::Result<()> {
        if self.base_image.is_empty() {
            return Err(anyhow::anyhow!("Base image cannot be empty"));
        }

        // Check for dangerous characters in image name
        if self.base_image.contains(';')
            || self.base_image.contains('&')
            || self.base_image.contains('|')
            || self.base_image.contains('\n')
        {
            return Err(anyhow::anyhow!(
                "Base image contains dangerous characters: '{}'",
                self.base_image
            ));
        }

        // Validate package names
        for package in &self.packages {
            if package.is_empty() {
                return Err(anyhow::anyhow!("Package name cannot be empty"));
            }
            if package.contains(';')
                || package.contains('&')
                || package.contains('|')
                || package.contains('\n')
            {
                return Err(anyhow::anyhow!(
                    "Package name contains dangerous characters: '{}'",
                    package
                ));
            }
        }

        Ok(())
    }
}

/// Complete sprites.dev backend configuration
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpritesConfig {
    /// Authentication token (can also be set via SPRITES_TOKEN env var)
    /// Environment variable takes precedence over config file
    #[serde(default)]
    pub token: Option<String>,

    /// Resource limits
    #[serde(default)]
    pub resources: SpritesResources,

    /// Lifecycle management
    #[serde(default)]
    pub lifecycle: SpritesLifecycle,

    /// Network configuration
    #[serde(default)]
    pub network: SpritesNetwork,

    /// Image configuration
    #[serde(default)]
    pub image: SpritesImage,
}

impl Default for SpritesConfig {
    fn default() -> Self {
        Self {
            token: None,
            resources: SpritesResources::default(),
            lifecycle: SpritesLifecycle::default(),
            network: SpritesNetwork::default(),
            image: SpritesImage::default(),
        }
    }
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

        // Validate the loaded configuration
        config.validate()?;

        info!(
            image = %config.image.base_image,
            cpu = ?config.resources.cpu,
            memory = ?config.resources.memory,
            auto_destroy = config.lifecycle.auto_destroy,
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

    /// Get the authentication token.
    ///
    /// Checks environment variable first (SPRITES_TOKEN), then falls back to config file.
    /// Environment variable takes precedence for security (avoid storing tokens in files).
    pub fn get_token(&self) -> anyhow::Result<String> {
        // Check environment variable first
        if let Ok(token) = std::env::var("SPRITES_TOKEN") {
            if !token.is_empty() {
                debug!("Using SPRITES_TOKEN from environment variable");
                return Ok(token);
            }
        }

        // Fall back to config file
        if let Some(token) = &self.token {
            if !token.is_empty() {
                debug!("Using token from config file");
                return Ok(token.clone());
            }
        }

        Err(anyhow::anyhow!(
            "No Sprites authentication token found. Set SPRITES_TOKEN environment variable or add 'token' to {}",
            Self::config_path()
                .unwrap_or_else(|_| PathBuf::from("~/.clauderon/sprites-config.toml"))
                .display()
        ))
    }

    /// Validate the configuration.
    ///
    /// Checks that all values are valid and safe to use.
    pub fn validate(&self) -> anyhow::Result<()> {
        // Validate resources
        self.resources.validate()?;

        // Validate image configuration
        self.image.validate()?;

        // Validate allowed domains for network policy
        if self.network.default_policy == NetworkPolicy::AllowList
            && self.network.allowed_domains.is_empty()
        {
            return Err(anyhow::anyhow!(
                "Network policy is 'allow-list' but no allowed domains are specified"
            ));
        }

        Ok(())
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
        assert!(!config.image.base_image.is_empty());
    }

    #[test]
    fn test_validate_default_config() {
        let config = SpritesConfig::default();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_validate_rejects_invalid_cpu() {
        let mut config = SpritesConfig::default();
        config.resources.cpu = Some(0); // Too low
        assert!(config.validate().is_err());

        config.resources.cpu = Some(9); // Too high
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validate_rejects_invalid_memory() {
        let mut config = SpritesConfig::default();
        config.resources.memory = Some(0); // Too low
        assert!(config.validate().is_err());

        config.resources.memory = Some(17); // Too high
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validate_accepts_valid_resources() {
        let mut config = SpritesConfig::default();
        config.resources.cpu = Some(4);
        config.resources.memory = Some(8);
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_validate_rejects_dangerous_image_chars() {
        let mut config = SpritesConfig::default();
        config.image.base_image = "bad;image".to_string();
        assert!(config.validate().is_err());

        config.image.base_image = "bad&image".to_string();
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validate_rejects_dangerous_package_chars() {
        let mut config = SpritesConfig::default();
        config.image.packages = vec!["git; rm -rf /".to_string()];
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validate_rejects_empty_image() {
        let mut config = SpritesConfig::default();
        config.image.base_image = String::new();
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_validate_rejects_empty_allowlist() {
        let mut config = SpritesConfig::default();
        config.network.default_policy = NetworkPolicy::AllowList;
        config.network.allowed_domains = vec![];
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_toml_serialization() {
        let config = SpritesConfig {
            token: Some("test_token".to_string()),
            resources: SpritesResources {
                cpu: Some(4),
                memory: Some(8),
            },
            lifecycle: SpritesLifecycle {
                auto_destroy: true,
                auto_checkpoint: true,
            },
            network: SpritesNetwork {
                default_policy: NetworkPolicy::AllowList,
                allowed_domains: vec!["example.com".to_string()],
            },
            image: SpritesImage {
                base_image: "ubuntu:22.04".to_string(),
                install_claude: true,
                packages: vec!["git".to_string()],
            },
        };

        let toml = toml::to_string(&config).unwrap();
        let deserialized: SpritesConfig = toml::from_str(&toml).unwrap();

        assert_eq!(deserialized.token, config.token);
        assert_eq!(deserialized.resources, config.resources);
        assert_eq!(deserialized.lifecycle, config.lifecycle);
        assert_eq!(
            deserialized.network.default_policy,
            config.network.default_policy
        );
        assert_eq!(deserialized.image, config.image);
    }

    #[test]
    #[allow(unsafe_code)]
    fn test_get_token_from_env() {
        // Set environment variable
        unsafe {
            std::env::set_var("SPRITES_TOKEN", "env_token");
        }

        let config = SpritesConfig {
            token: Some("file_token".to_string()),
            ..Default::default()
        };

        // Environment variable should take precedence
        let token = config.get_token().unwrap();
        assert_eq!(token, "env_token");

        // Clean up
        unsafe {
            std::env::remove_var("SPRITES_TOKEN");
        }
    }

    #[test]
    #[allow(unsafe_code)]
    fn test_get_token_from_config() {
        // Ensure env var is not set
        unsafe {
            std::env::remove_var("SPRITES_TOKEN");
        }

        let config = SpritesConfig {
            token: Some("file_token".to_string()),
            ..Default::default()
        };

        let token = config.get_token().unwrap();
        assert_eq!(token, "file_token");
    }

    #[test]
    #[allow(unsafe_code)]
    fn test_get_token_fails_when_missing() {
        // Ensure env var is not set
        unsafe {
            std::env::remove_var("SPRITES_TOKEN");
        }

        let config = SpritesConfig::default();
        assert!(config.get_token().is_err());
    }
}
