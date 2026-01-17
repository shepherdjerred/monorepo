use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use typeshare::typeshare;

/// Feature flags configuration for the daemon.
/// Flags are loaded at startup and require daemon restart to change.
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
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
}

impl Default for FeatureFlags {
    fn default() -> Self {
        Self {
            enable_webauthn_auth: false,
            enable_ai_metadata: true,
            enable_auto_reconcile: true,
            enable_proxy_port_reuse: false,
            enable_usage_tracking: false,
        }
    }
}

impl FeatureFlags {
    /// Load feature flags with priority: CLI args → env vars → TOML → defaults
    pub fn load(cli_overrides: Option<CliFeatureFlags>) -> anyhow::Result<Self> {
        // 1. Start with defaults
        let mut flags = Self::default();

        // 2. Override from TOML config file (~/.clauderon/config.toml)
        if let Some(toml_flags) = Self::load_from_toml()? {
            flags.merge(toml_flags);
        }

        // 3. Override from environment variables
        let env_flags = Self::load_from_env();
        flags.merge(env_flags);

        // 4. Override from CLI arguments (highest priority)
        if let Some(cli_flags) = cli_overrides {
            flags.merge_from_cli(cli_flags);
        }

        Ok(flags)
    }

    /// Load feature flags from TOML config file
    fn load_from_toml() -> anyhow::Result<Option<Self>> {
        let config_path = config_path();

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
    fn load_from_env() -> Self {
        Self {
            enable_webauthn_auth: parse_env_bool("CLAUDERON_FEATURE_ENABLE_WEBAUTHN_AUTH"),
            enable_ai_metadata: parse_env_bool("CLAUDERON_FEATURE_ENABLE_AI_METADATA"),
            enable_auto_reconcile: parse_env_bool("CLAUDERON_FEATURE_ENABLE_AUTO_RECONCILE"),
            enable_proxy_port_reuse: parse_env_bool("CLAUDERON_FEATURE_ENABLE_PROXY_PORT_REUSE"),
            enable_usage_tracking: parse_env_bool("CLAUDERON_FEATURE_ENABLE_USAGE_TRACKING"),
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
    }
}

/// CLI feature flag overrides (passed from clap)
#[derive(Debug, Clone, Default)]
pub struct CliFeatureFlags {
    pub enable_webauthn_auth: Option<bool>,
    pub enable_ai_metadata: Option<bool>,
    pub enable_auto_reconcile: Option<bool>,
    pub enable_proxy_port_reuse: Option<bool>,
    pub enable_usage_tracking: Option<bool>,
}

/// Configuration file structure
#[derive(Debug, Deserialize)]
struct ConfigFile {
    #[serde(default)]
    feature_flags: Option<FeatureFlags>,
}

/// Parse boolean from environment variable
/// Supports: true/false, 1/0, yes/no, on/off (case insensitive)
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

/// Get the config file path (~/.clauderon/config.toml)
fn config_path() -> PathBuf {
    let mut path = dirs::home_dir().expect("Failed to get home directory");
    path.push(".clauderon");
    path.push("config.toml");
    path
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
    fn test_parse_env_bool_true_variants() {
        std::env::set_var("TEST_FLAG_TRUE_1", "true");
        assert!(parse_env_bool("TEST_FLAG_TRUE_1"));

        std::env::set_var("TEST_FLAG_TRUE_2", "TRUE");
        assert!(parse_env_bool("TEST_FLAG_TRUE_2"));

        std::env::set_var("TEST_FLAG_TRUE_3", "1");
        assert!(parse_env_bool("TEST_FLAG_TRUE_3"));

        std::env::set_var("TEST_FLAG_TRUE_4", "yes");
        assert!(parse_env_bool("TEST_FLAG_TRUE_4"));

        std::env::set_var("TEST_FLAG_TRUE_5", "YES");
        assert!(parse_env_bool("TEST_FLAG_TRUE_5"));

        std::env::set_var("TEST_FLAG_TRUE_6", "on");
        assert!(parse_env_bool("TEST_FLAG_TRUE_6"));

        std::env::set_var("TEST_FLAG_TRUE_7", "ON");
        assert!(parse_env_bool("TEST_FLAG_TRUE_7"));

        // Cleanup
        unsafe {
            std::env::remove_var("TEST_FLAG_TRUE_1");
            std::env::remove_var("TEST_FLAG_TRUE_2");
            std::env::remove_var("TEST_FLAG_TRUE_3");
            std::env::remove_var("TEST_FLAG_TRUE_4");
            std::env::remove_var("TEST_FLAG_TRUE_5");
            std::env::remove_var("TEST_FLAG_TRUE_6");
            std::env::remove_var("TEST_FLAG_TRUE_7");
        }
    }

    #[test]
    fn test_parse_env_bool_false_variants() {
        std::env::set_var("TEST_FLAG_FALSE_1", "false");
        assert!(!parse_env_bool("TEST_FLAG_FALSE_1"));

        std::env::set_var("TEST_FLAG_FALSE_2", "FALSE");
        assert!(!parse_env_bool("TEST_FLAG_FALSE_2"));

        std::env::set_var("TEST_FLAG_FALSE_3", "0");
        assert!(!parse_env_bool("TEST_FLAG_FALSE_3"));

        std::env::set_var("TEST_FLAG_FALSE_4", "no");
        assert!(!parse_env_bool("TEST_FLAG_FALSE_4"));

        std::env::set_var("TEST_FLAG_FALSE_5", "NO");
        assert!(!parse_env_bool("TEST_FLAG_FALSE_5"));

        std::env::set_var("TEST_FLAG_FALSE_6", "off");
        assert!(!parse_env_bool("TEST_FLAG_FALSE_6"));

        std::env::set_var("TEST_FLAG_FALSE_7", "OFF");
        assert!(!parse_env_bool("TEST_FLAG_FALSE_7"));

        // Cleanup
        unsafe {
            std::env::remove_var("TEST_FLAG_FALSE_1");
            std::env::remove_var("TEST_FLAG_FALSE_2");
            std::env::remove_var("TEST_FLAG_FALSE_3");
            std::env::remove_var("TEST_FLAG_FALSE_4");
            std::env::remove_var("TEST_FLAG_FALSE_5");
            std::env::remove_var("TEST_FLAG_FALSE_6");
            std::env::remove_var("TEST_FLAG_FALSE_7");
        }
    }

    #[test]
    fn test_parse_env_bool_not_set() {
        // Ensure the var doesn't exist
        unsafe {
            std::env::remove_var("TEST_FLAG_NOT_SET");
        }
        assert!(!parse_env_bool("TEST_FLAG_NOT_SET"));
    }

    #[test]
    fn test_parse_env_bool_invalid() {
        std::env::set_var("TEST_FLAG_INVALID", "invalid");
        assert!(!parse_env_bool("TEST_FLAG_INVALID"));

        unsafe {
            std::env::remove_var("TEST_FLAG_INVALID");
        }
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
    }
}
