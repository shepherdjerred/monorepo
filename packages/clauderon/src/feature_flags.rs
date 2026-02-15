use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use typeshare::typeshare;

/// Feature flags configuration for the daemon.
/// Flags are loaded at startup and require daemon restart to change.
#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
#[expect(clippy::struct_excessive_bools, reason = "feature flags are naturally boolean fields")]
pub struct FeatureFlags {
    /// Enable experimental WebAuthn passwordless authentication
    pub enable_webauthn_auth: bool,

    /// Enable AI-powered session metadata generation
    pub enable_ai_metadata: bool,

    /// Enable automatic session reconciliation on startup
    pub enable_auto_reconcile: bool,

    /// Enable session proxy port reuse (experimental)
    pub enable_proxy_port_reuse: bool,

    /// Enable Claude usage tracking via API
    pub enable_usage_tracking: bool,

    /// Enable Kubernetes backend (experimental, disabled by default)
    pub enable_kubernetes_backend: bool,

    /// Enable experimental AI models (Codex, Gemini)
    pub enable_experimental_models: bool,

    /// Enable read-only mode (experimental, security issues #424, #205)
    pub enable_readonly_mode: bool,
}

impl Default for FeatureFlags {
    fn default() -> Self {
        Self {
            enable_webauthn_auth: false,
            enable_ai_metadata: true,
            enable_auto_reconcile: true,
            enable_proxy_port_reuse: false,
            enable_usage_tracking: false,
            enable_kubernetes_backend: false,
            enable_experimental_models: false,
            enable_readonly_mode: false,
        }
    }
}

impl FeatureFlags {
    /// Load feature flags with priority: CLI args → env vars → TOML → defaults
    ///
    /// TODO: Wire up feature flags to actual feature toggles:
    /// - enable_webauthn_auth: WebAuthn authentication flow
    /// - enable_ai_metadata: AI-powered session metadata generation
    /// - enable_auto_reconcile: Automatic session reconciliation on startup
    /// - enable_proxy_port_reuse: Session proxy port reuse behavior
    /// - enable_usage_tracking: Claude usage tracking via API
    /// - enable_readonly_mode: Read-only mode access restrictions
    ///
    /// # Errors
    /// Returns an error if the TOML config file exists but cannot be parsed
    pub fn load(cli_overrides: Option<CliFeatureFlags>) -> anyhow::Result<Self> {
        // 1. Start with defaults
        let mut flags = Self::default();

        // 2. Override from TOML config file (~/.clauderon/config.toml)
        if let Some(toml_flags) = Self::load_from_toml()? {
            flags.merge(toml_flags);
        }

        // 3. Override from environment variables (highest priority after CLI)
        let env_flags = Self::load_from_env();
        flags.merge_from_env(&env_flags);

        // 4. Override from CLI arguments (highest priority)
        if let Some(cli_flags) = cli_overrides {
            flags.merge_from_cli(cli_flags);
        }

        Ok(flags)
    }

    /// Load feature flags from TOML config file
    fn load_from_toml() -> anyhow::Result<Option<Self>> {
        let config_path = match config_path() {
            Some(path) => path,
            None => {
                // No home directory available, skip TOML loading
                return Ok(None);
            }
        };

        if !config_path.exists() {
            return Ok(None);
        }

        let content = std::fs::read_to_string(&config_path)
            .with_context(|| format!("Failed to read config file at {}", config_path.display()))?;

        let config: ConfigFile = toml::from_str(&content)
            .with_context(|| format!("Failed to parse config file at {}", config_path.display()))?;

        Ok(config.feature_flags)
    }

    /// Load feature flags from environment variables
    /// Pattern: CLAUDERON_FEATURE_<FLAG_NAME>=true/false
    /// Returns Option<bool> for each field - None means not set, Some means explicitly set
    fn load_from_env() -> EnvFeatureFlags {
        EnvFeatureFlags {
            enable_webauthn_auth: parse_env_bool_option("CLAUDERON_FEATURE_ENABLE_WEBAUTHN_AUTH"),
            enable_ai_metadata: parse_env_bool_option("CLAUDERON_FEATURE_ENABLE_AI_METADATA"),
            enable_auto_reconcile: parse_env_bool_option("CLAUDERON_FEATURE_ENABLE_AUTO_RECONCILE"),
            enable_proxy_port_reuse: parse_env_bool_option(
                "CLAUDERON_FEATURE_ENABLE_PROXY_PORT_REUSE",
            ),
            enable_usage_tracking: parse_env_bool_option("CLAUDERON_FEATURE_ENABLE_USAGE_TRACKING"),
            enable_kubernetes_backend: parse_env_bool_option(
                "CLAUDERON_FEATURE_ENABLE_KUBERNETES_BACKEND",
            ),
            enable_experimental_models: parse_env_bool_option(
                "CLAUDERON_FEATURE_ENABLE_EXPERIMENTAL_MODELS",
            ),
            enable_readonly_mode: parse_env_bool_option("CLAUDERON_FEATURE_ENABLE_READONLY_MODE"),
        }
    }

    /// Merge another FeatureFlags struct into this one (non-default values override)
    fn merge(&mut self, other: Self) {
        // Only merge fields that differ from defaults
        let defaults = Self::default();

        if other.enable_webauthn_auth != defaults.enable_webauthn_auth {
            self.enable_webauthn_auth = other.enable_webauthn_auth;
        }
        if other.enable_ai_metadata != defaults.enable_ai_metadata {
            self.enable_ai_metadata = other.enable_ai_metadata;
        }
        if other.enable_auto_reconcile != defaults.enable_auto_reconcile {
            self.enable_auto_reconcile = other.enable_auto_reconcile;
        }
        if other.enable_proxy_port_reuse != defaults.enable_proxy_port_reuse {
            self.enable_proxy_port_reuse = other.enable_proxy_port_reuse;
        }
        if other.enable_usage_tracking != defaults.enable_usage_tracking {
            self.enable_usage_tracking = other.enable_usage_tracking;
        }
        if other.enable_kubernetes_backend != defaults.enable_kubernetes_backend {
            self.enable_kubernetes_backend = other.enable_kubernetes_backend;
        }
        if other.enable_experimental_models != defaults.enable_experimental_models {
            self.enable_experimental_models = other.enable_experimental_models;
        }
        if other.enable_readonly_mode != defaults.enable_readonly_mode {
            self.enable_readonly_mode = other.enable_readonly_mode;
        }
    }

    /// Merge environment variable overrides (which are Option<bool> to distinguish "not set")
    fn merge_from_env(&mut self, env: &EnvFeatureFlags) {
        if let Some(val) = env.enable_webauthn_auth {
            self.enable_webauthn_auth = val;
        }
        if let Some(val) = env.enable_ai_metadata {
            self.enable_ai_metadata = val;
        }
        if let Some(val) = env.enable_auto_reconcile {
            self.enable_auto_reconcile = val;
        }
        if let Some(val) = env.enable_proxy_port_reuse {
            self.enable_proxy_port_reuse = val;
        }
        if let Some(val) = env.enable_usage_tracking {
            self.enable_usage_tracking = val;
        }
        if let Some(val) = env.enable_kubernetes_backend {
            self.enable_kubernetes_backend = val;
        }
        if let Some(val) = env.enable_experimental_models {
            self.enable_experimental_models = val;
        }
        if let Some(val) = env.enable_readonly_mode {
            self.enable_readonly_mode = val;
        }
    }

    /// Merge CLI overrides (which are Option<bool> to distinguish "not set")
    fn merge_from_cli(&mut self, cli: CliFeatureFlags) {
        if let Some(val) = cli.enable_webauthn_auth {
            self.enable_webauthn_auth = val;
        }
        if let Some(val) = cli.enable_ai_metadata {
            self.enable_ai_metadata = val;
        }
        if let Some(val) = cli.enable_auto_reconcile {
            self.enable_auto_reconcile = val;
        }
        if let Some(val) = cli.enable_proxy_port_reuse {
            self.enable_proxy_port_reuse = val;
        }
        if let Some(val) = cli.enable_usage_tracking {
            self.enable_usage_tracking = val;
        }
        if let Some(val) = cli.enable_kubernetes_backend {
            self.enable_kubernetes_backend = val;
        }
        if let Some(val) = cli.enable_experimental_models {
            self.enable_experimental_models = val;
        }
        if let Some(val) = cli.enable_readonly_mode {
            self.enable_readonly_mode = val;
        }
    }

    /// Log the current feature flag state (for observability)
    #[tracing::instrument(skip(self))]
    pub fn log_state(&self) {
        tracing::info!("Feature flags loaded:");
        tracing::info!("  enable_webauthn_auth: {}", self.enable_webauthn_auth);
        tracing::info!("  enable_ai_metadata: {}", self.enable_ai_metadata);
        tracing::info!("  enable_auto_reconcile: {}", self.enable_auto_reconcile);
        tracing::info!(
            "  enable_proxy_port_reuse: {}",
            self.enable_proxy_port_reuse
        );
        tracing::info!("  enable_usage_tracking: {}", self.enable_usage_tracking);
        tracing::info!(
            "  enable_kubernetes_backend: {}",
            self.enable_kubernetes_backend
        );
        tracing::info!(
            "  enable_experimental_models: {}",
            self.enable_experimental_models
        );
        tracing::info!("  enable_readonly_mode: {}", self.enable_readonly_mode);
    }
}

/// CLI feature flag overrides (passed from clap)
#[derive(Debug, Clone, Copy, Default)]
pub struct CliFeatureFlags {
    /// Override WebAuthn authentication flag.
    pub enable_webauthn_auth: Option<bool>,
    /// Override AI metadata generation flag.
    pub enable_ai_metadata: Option<bool>,
    /// Override auto-reconcile flag.
    pub enable_auto_reconcile: Option<bool>,
    /// Override proxy port reuse flag.
    pub enable_proxy_port_reuse: Option<bool>,
    /// Override usage tracking flag.
    pub enable_usage_tracking: Option<bool>,
    /// Override Kubernetes backend flag.
    pub enable_kubernetes_backend: Option<bool>,
    /// Override experimental models flag.
    pub enable_experimental_models: Option<bool>,
    /// Override read-only mode flag.
    pub enable_readonly_mode: Option<bool>,
}

/// Environment variable feature flag overrides (returns Option<bool> to distinguish "not set")
#[derive(Debug, Clone)]
struct EnvFeatureFlags {
    pub enable_webauthn_auth: Option<bool>,
    pub enable_ai_metadata: Option<bool>,
    pub enable_auto_reconcile: Option<bool>,
    pub enable_proxy_port_reuse: Option<bool>,
    pub enable_usage_tracking: Option<bool>,
    pub enable_kubernetes_backend: Option<bool>,
    pub enable_experimental_models: Option<bool>,
    pub enable_readonly_mode: Option<bool>,
}

/// Configuration file structure
#[derive(Debug, Deserialize)]
struct ConfigFile {
    #[serde(default)]
    feature_flags: Option<FeatureFlags>,
    #[serde(default)]
    server: Option<ServerConfig>,
}

/// Server configuration for the daemon.
/// Config is loaded at startup and requires daemon restart to change.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ServerConfig {
    /// HTTP server bind address (default: 127.0.0.1)
    pub bind_addr: Option<String>,

    /// WebAuthn origin URL for authentication
    pub origin: Option<String>,

    /// Disable authentication (dangerous for non-localhost bindings)
    pub disable_auth: Option<bool>,

    /// Anthropic organization ID for Claude API usage tracking
    pub org_id: Option<String>,
}

impl ServerConfig {
    /// Load server config with priority: CLI args (incl. env via clap) → TOML → defaults
    ///
    /// Note: clap's `env` attribute handles env var fallback automatically for CLI args,
    /// so we only need to merge CLI values on top of TOML values.
    ///
    /// # Errors
    /// Returns an error if the TOML config file exists but cannot be parsed
    pub fn load(cli_overrides: &CliServerConfig) -> anyhow::Result<Self> {
        // 1. Start with defaults
        let mut config = Self::default();

        // 2. Override from TOML config file (~/.clauderon/config.toml)
        if let Some(toml_config) = Self::load_from_toml()? {
            config.merge(&toml_config);
        }

        // 3. Override from CLI arguments (which include env vars via clap's `env` attribute)
        config.merge_from_cli(cli_overrides);

        Ok(config)
    }

    /// Load server config from TOML config file
    fn load_from_toml() -> anyhow::Result<Option<Self>> {
        let config_path = match config_path() {
            Some(path) => path,
            None => {
                // No home directory available, skip TOML loading
                return Ok(None);
            }
        };

        if !config_path.exists() {
            return Ok(None);
        }

        let content = std::fs::read_to_string(&config_path)
            .with_context(|| format!("Failed to read config file at {}", config_path.display()))?;

        let config: ConfigFile = toml::from_str(&content)
            .with_context(|| format!("Failed to parse config file at {}", config_path.display()))?;

        Ok(config.server)
    }

    /// Merge another ServerConfig struct into this one (Some values override None)
    fn merge(&mut self, other: &Self) {
        if other.bind_addr.is_some() {
            self.bind_addr.clone_from(&other.bind_addr);
        }
        if other.origin.is_some() {
            self.origin.clone_from(&other.origin);
        }
        if other.disable_auth.is_some() {
            self.disable_auth = other.disable_auth;
        }
        if other.org_id.is_some() {
            self.org_id.clone_from(&other.org_id);
        }
    }

    /// Merge CLI overrides (which are Option types to distinguish "not set")
    fn merge_from_cli(&mut self, cli: &CliServerConfig) {
        if cli.bind_addr.is_some() {
            self.bind_addr.clone_from(&cli.bind_addr);
        }
        if cli.origin.is_some() {
            self.origin.clone_from(&cli.origin);
        }
        if cli.disable_auth.is_some() {
            self.disable_auth = cli.disable_auth;
        }
        if cli.org_id.is_some() {
            self.org_id.clone_from(&cli.org_id);
        }
    }

    /// Get bind address with default fallback
    #[must_use]
    pub fn bind_addr(&self) -> &str {
        self.bind_addr.as_deref().unwrap_or("127.0.0.1")
    }

    /// Get origin URL (None if not configured)
    #[must_use]
    pub fn origin(&self) -> Option<&str> {
        self.origin.as_deref()
    }

    /// Check if auth is disabled
    #[must_use]
    pub fn is_auth_disabled(&self) -> bool {
        self.disable_auth.unwrap_or(false)
    }

    /// Get organization ID (None if not configured)
    #[must_use]
    pub fn org_id(&self) -> Option<&str> {
        self.org_id.as_deref()
    }

    /// Log the current server config state (for observability)
    #[tracing::instrument(skip(self))]
    pub fn log_state(&self) {
        tracing::info!("Server config loaded:");
        tracing::info!("  bind_addr: {}", self.bind_addr());
        if let Some(origin) = self.origin() {
            tracing::info!("  origin: {}", origin);
        } else {
            tracing::info!("  origin: (not set)");
        }
        tracing::info!("  disable_auth: {}", self.is_auth_disabled());
        if let Some(org_id) = self.org_id() {
            tracing::info!("  org_id: {}", org_id);
        } else {
            tracing::info!("  org_id: (not set)");
        }
    }
}

/// CLI server config overrides (passed from clap)
#[derive(Debug, Clone, Default)]
pub struct CliServerConfig {
    /// Override HTTP server bind address.
    pub bind_addr: Option<String>,
    /// Override WebAuthn origin URL.
    pub origin: Option<String>,
    /// Override auth disable setting.
    pub disable_auth: Option<bool>,
    /// Override Anthropic organization ID.
    pub org_id: Option<String>,
}

/// Parse boolean from environment variable
/// Supports: true/false, 1/0, yes/no, on/off (case insensitive)
/// Note: Kept for test coverage of `parse_env_bool_not_set`
fn parse_env_bool(key: &str) -> bool {
    std::env::var(key)
        .ok()
        .and_then(|val| match val.to_lowercase().as_str() {
            "true" | "1" | "yes" | "on" => Some(true),
            "false" | "0" | "no" | "off" => Some(false),
            _ => {
                tracing::warn!(
                    key = %key,
                    value = %val,
                    "Invalid boolean value for environment variable, defaulting to false"
                );
                None
            }
        })
        .unwrap_or(false)
}

/// Parse boolean from environment variable, returning None if not set
/// Supports: true/false, 1/0, yes/no, on/off (case insensitive)
/// Returns None if environment variable is not set
fn parse_env_bool_option(key: &str) -> Option<bool> {
    std::env::var(key)
        .ok()
        .and_then(|val| match val.to_lowercase().as_str() {
            "true" | "1" | "yes" | "on" => Some(true),
            "false" | "0" | "no" | "off" => Some(false),
            _ => {
                tracing::warn!(
                    key = %key,
                    value = %val,
                    "Invalid boolean value for environment variable"
                );
                None
            }
        })
}

/// Get the config file path (~/.clauderon/config.toml)
/// Returns None if home directory cannot be determined (e.g., in some container environments)
fn config_path() -> Option<PathBuf> {
    let mut path = dirs::home_dir()?;
    path.push(".clauderon");
    path.push("config.toml");
    Some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_flags() {
        let flags = FeatureFlags::default();
        assert!(!flags.enable_webauthn_auth);
        assert!(flags.enable_ai_metadata);
        assert!(flags.enable_auto_reconcile);
        assert!(!flags.enable_proxy_port_reuse);
        assert!(!flags.enable_usage_tracking);
        assert!(!flags.enable_kubernetes_backend);
        assert!(!flags.enable_experimental_models);
        assert!(!flags.enable_readonly_mode);
    }

    #[test]
    fn test_merge_priority() {
        let mut base = FeatureFlags::default();
        let override_flags = FeatureFlags {
            enable_webauthn_auth: true,
            ..Default::default()
        };

        base.merge(override_flags);
        assert!(base.enable_webauthn_auth);
        // Other flags should remain at default
        assert!(base.enable_ai_metadata);
        assert!(base.enable_auto_reconcile);
    }

    #[test]
    fn test_merge_does_not_override_with_defaults() {
        let mut base = FeatureFlags {
            enable_webauthn_auth: true,
            enable_ai_metadata: false,
            enable_auto_reconcile: false,
            enable_proxy_port_reuse: true,
            enable_usage_tracking: true,
            enable_kubernetes_backend: true,
            enable_experimental_models: false,
            enable_readonly_mode: false,
        };

        // Merge with defaults - should not change anything
        let defaults = FeatureFlags::default();
        base.merge(defaults);

        // Base should remain unchanged since we only merged defaults
        assert!(base.enable_webauthn_auth);
        assert!(!base.enable_ai_metadata);
        assert!(!base.enable_auto_reconcile);
        assert!(base.enable_proxy_port_reuse);
        assert!(base.enable_usage_tracking);
        assert!(base.enable_kubernetes_backend);
    }

    #[test]
    fn test_cli_override() {
        let mut flags = FeatureFlags::default();
        let cli = CliFeatureFlags {
            enable_webauthn_auth: Some(true),
            enable_usage_tracking: Some(true),
            ..Default::default()
        };

        flags.merge_from_cli(cli);
        assert!(flags.enable_webauthn_auth);
        assert!(flags.enable_usage_tracking);
        // Other flags should remain at default
        assert!(flags.enable_ai_metadata);
        assert!(flags.enable_auto_reconcile);
        assert!(!flags.enable_proxy_port_reuse);
    }

    #[test]
    fn test_cli_none_does_not_override() {
        let mut flags = FeatureFlags {
            enable_webauthn_auth: true,
            ..Default::default()
        };

        let cli = CliFeatureFlags {
            enable_webauthn_auth: None, // Not set
            ..Default::default()
        };

        flags.merge_from_cli(cli);
        // Should remain true since CLI didn't provide a value
        assert!(flags.enable_webauthn_auth);
    }

    #[test]
    fn test_parse_env_bool_not_set() {
        // Test with a variable that's extremely unlikely to be set
        assert!(!parse_env_bool("CLAUDERON_DEFINITELY_NOT_SET_XYZABC123"));
    }

    #[test]
    fn test_load_with_cli_overrides() {
        // Test loading with CLI overrides
        let cli = CliFeatureFlags {
            enable_webauthn_auth: Some(true),
            enable_usage_tracking: Some(true),
            ..Default::default()
        };

        let flags = FeatureFlags::load(Some(cli)).expect("Failed to load flags");

        assert!(flags.enable_webauthn_auth);
        assert!(flags.enable_usage_tracking);
        // Defaults should be preserved for non-overridden flags
        assert!(flags.enable_ai_metadata);
        assert!(flags.enable_auto_reconcile);
        assert!(!flags.enable_proxy_port_reuse);
    }

    #[test]
    fn test_load_without_cli_overrides() {
        let flags = FeatureFlags::load(None).expect("Failed to load flags");

        // Should have default values
        assert!(!flags.enable_webauthn_auth);
        assert!(flags.enable_ai_metadata);
        assert!(flags.enable_auto_reconcile);
        assert!(!flags.enable_proxy_port_reuse);
        assert!(!flags.enable_usage_tracking);
        assert!(!flags.enable_readonly_mode);
    }

    #[test]
    fn test_experimental_models_defaults_to_false() {
        let flags = FeatureFlags::default();
        assert!(!flags.enable_experimental_models);
    }

    #[test]
    fn test_experimental_models_cli_override() {
        let cli = CliFeatureFlags {
            enable_experimental_models: Some(true),
            ..Default::default()
        };
        let flags = FeatureFlags::load(Some(cli)).expect("Failed to load flags");
        assert!(flags.enable_experimental_models);
    }
}
