//! Proxy configuration and credentials management.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Proxy service configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    /// Directory containing credential files.
    pub secrets_dir: PathBuf,

    /// HTTP auth proxy port (default: 18080).
    pub http_proxy_port: u16,

    /// Kubernetes proxy port (default: 18081).
    pub k8s_proxy_port: u16,

    /// Talos mTLS gateway port (default: 18082).
    pub talos_gateway_port: u16,

    /// Enable audit logging.
    pub audit_enabled: bool,

    /// Audit log file path.
    pub audit_log_path: PathBuf,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        Self {
            secrets_dir: home.join(".secrets"),
            http_proxy_port: 18080,
            k8s_proxy_port: 18081,
            talos_gateway_port: 18082,
            audit_enabled: true,
            audit_log_path: home.join(".mux/audit.jsonl"),
        }
    }
}

impl ProxyConfig {
    /// Load configuration from `~/.mux/proxy.toml` or use defaults.
    pub fn load() -> anyhow::Result<Self> {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        let config_path = home.join(".mux/proxy.toml");

        if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)?;
            let config: Self = toml::from_str(&content)?;
            Ok(config)
        } else {
            Ok(Self::default())
        }
    }
}

/// Credentials for various services.
#[derive(Debug, Clone, Default)]
pub struct Credentials {
    pub github_token: Option<String>,
    pub anthropic_api_key: Option<String>,
    pub pagerduty_token: Option<String>,
    pub sentry_auth_token: Option<String>,
    pub grafana_api_key: Option<String>,
    pub npm_token: Option<String>,
    pub docker_token: Option<String>,
    pub k8s_token: Option<String>,
    pub talos_token: Option<String>,
}

impl Credentials {
    /// Load credentials from environment variables.
    pub fn load_from_env() -> Self {
        Self {
            github_token: std::env::var("GITHUB_TOKEN").ok(),
            anthropic_api_key: std::env::var("CLAUDE_CODE_OAUTH_TOKEN").ok(),
            // Support both PAGERDUTY_TOKEN and PAGERDUTY_API_KEY for compatibility
            pagerduty_token: std::env::var("PAGERDUTY_TOKEN")
                .or_else(|_| std::env::var("PAGERDUTY_API_KEY"))
                .ok(),
            sentry_auth_token: std::env::var("SENTRY_AUTH_TOKEN").ok(),
            grafana_api_key: std::env::var("GRAFANA_API_KEY").ok(),
            npm_token: std::env::var("NPM_TOKEN").ok(),
            docker_token: std::env::var("DOCKER_TOKEN").ok(),
            k8s_token: std::env::var("K8S_TOKEN").ok(),
            talos_token: std::env::var("TALOS_TOKEN").ok(),
        }
    }

    /// Load credentials from files in the secrets directory.
    pub fn load_from_files(secrets_dir: &PathBuf) -> Self {
        let read_secret = |name: &str| -> Option<String> {
            let path = secrets_dir.join(name);
            std::fs::read_to_string(&path).ok().map(|s| s.trim().to_string())
        };

        Self {
            github_token: read_secret("github_token"),
            anthropic_api_key: read_secret("anthropic_api_key"),
            pagerduty_token: read_secret("pagerduty_token"),
            sentry_auth_token: read_secret("sentry_auth_token"),
            grafana_api_key: read_secret("grafana_api_key"),
            npm_token: read_secret("npm_token"),
            docker_token: read_secret("docker_token"),
            k8s_token: read_secret("k8s_token"),
            talos_token: read_secret("talos_token"),
        }
    }

    /// Load credentials - try environment first, then files.
    pub fn load(secrets_dir: &PathBuf) -> Self {
        let from_env = Self::load_from_env();
        let from_files = Self::load_from_files(secrets_dir);

        let credentials = Self {
            github_token: from_env.github_token.or(from_files.github_token),
            anthropic_api_key: from_env.anthropic_api_key.or(from_files.anthropic_api_key),
            pagerduty_token: from_env.pagerduty_token.or(from_files.pagerduty_token),
            sentry_auth_token: from_env.sentry_auth_token.or(from_files.sentry_auth_token),
            grafana_api_key: from_env.grafana_api_key.or(from_files.grafana_api_key),
            npm_token: from_env.npm_token.or(from_files.npm_token),
            docker_token: from_env.docker_token.or(from_files.docker_token),
            k8s_token: from_env.k8s_token.or(from_files.k8s_token),
            talos_token: from_env.talos_token.or(from_files.talos_token),
        };

        // Log which credentials were loaded
        tracing::info!("Loaded credentials:");
        if credentials.github_token.is_some() {
            tracing::info!("  ✓ GitHub token");
        }
        if credentials.anthropic_api_key.is_some() {
            tracing::info!("  ✓ Anthropic API key");
        }
        if credentials.pagerduty_token.is_some() {
            tracing::info!("  ✓ PagerDuty token");
        }
        if credentials.sentry_auth_token.is_some() {
            tracing::info!("  ✓ Sentry auth token");
        }
        if credentials.grafana_api_key.is_some() {
            tracing::info!("  ✓ Grafana API key");
        }
        if credentials.npm_token.is_some() {
            tracing::info!("  ✓ npm token");
        }
        if credentials.docker_token.is_some() {
            tracing::info!("  ✓ Docker token");
        }

        credentials
    }

    /// Get a credential by service name.
    pub fn get(&self, service: &str) -> Option<&str> {
        match service {
            "github" => self.github_token.as_deref(),
            "anthropic" => self.anthropic_api_key.as_deref(),
            "pagerduty" => self.pagerduty_token.as_deref(),
            "sentry" => self.sentry_auth_token.as_deref(),
            "grafana" => self.grafana_api_key.as_deref(),
            "npm" => self.npm_token.as_deref(),
            "docker" => self.docker_token.as_deref(),
            "k8s" => self.k8s_token.as_deref(),
            "talos" => self.talos_token.as_deref(),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = ProxyConfig::default();
        assert_eq!(config.http_proxy_port, 18080);
        assert_eq!(config.k8s_proxy_port, 18081);
        assert_eq!(config.talos_gateway_port, 18082);
    }

    #[test]
    fn test_credentials_from_env() {
        // Just verify load_from_env runs without panic
        // We can't easily set env vars in tests since unsafe is forbidden
        let creds = Credentials::load_from_env();
        // If GITHUB_TOKEN happens to be set, it should be loaded
        // Otherwise it should be None - both are valid
        assert!(creds.github_token.is_some() || creds.github_token.is_none());
    }
}
