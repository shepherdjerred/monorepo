use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Configuration for the Kubernetes backend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KubernetesConfig {
    /// Kubernetes namespace for clauderon pods
    pub namespace: String,

    /// Container image (same as Docker backend default)
    pub image: String,

    /// CPU request (e.g., "500m")
    pub cpu_request: String,

    /// CPU limit (e.g., "2000m")
    pub cpu_limit: String,

    /// Memory request (e.g., "512Mi")
    pub memory_request: String,

    /// Memory limit (e.g., "2Gi")
    pub memory_limit: String,

    /// Storage class for PVCs (None = cluster default)
    pub storage_class: Option<String>,

    /// Size for cargo cache PVC
    pub cargo_cache_size: String,

    /// Size for sccache PVC
    pub sccache_cache_size: String,

    /// Size for workspace PVC
    pub workspace_pvc_size: String,

    /// Git repository remote URL (for cloning)
    /// If None, will be auto-detected from workdir
    pub git_remote_url: Option<String>,

    /// Git remote name (default: "origin")
    pub git_remote_name: String,

    /// Service account name for pods
    pub service_account: String,
}

impl Default for KubernetesConfig {
    fn default() -> Self {
        Self {
            namespace: "clauderon".to_string(),
            image: "ghcr.io/shepherdjerred/dotfiles".to_string(),
            cpu_request: "500m".to_string(),
            cpu_limit: "2000m".to_string(),
            memory_request: "512Mi".to_string(),
            memory_limit: "2Gi".to_string(),
            storage_class: None, // Use cluster default
            cargo_cache_size: "10Gi".to_string(),
            sccache_cache_size: "20Gi".to_string(),
            workspace_pvc_size: "5Gi".to_string(),
            git_remote_url: None, // Auto-detect
            git_remote_name: "origin".to_string(),
            service_account: "clauderon".to_string(),
        }
    }
}

impl KubernetesConfig {
    /// Load configuration from file
    ///
    /// # Errors
    ///
    /// Returns an error if the config file cannot be read or parsed
    pub fn load() -> anyhow::Result<Self> {
        let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("No home directory"))?;
        let config_path = home.join(".clauderon/k8s-config.toml");

        if config_path.exists() {
            let contents = std::fs::read_to_string(&config_path)?;
            let config: KubernetesConfig = toml::from_str(&contents)?;
            Ok(config)
        } else {
            // Return default config
            Ok(Self::default())
        }
    }

    /// Load configuration from file, or use default if not found
    #[must_use]
    pub fn load_or_default() -> Self {
        Self::load().unwrap_or_default()
    }
}

/// Proxy configuration for Kubernetes pods
#[derive(Debug, Clone, Default)]
pub struct KubernetesProxyConfig {
    /// Enable proxy support
    pub enabled: bool,

    /// HTTP proxy port on host
    pub http_proxy_port: u16,

    /// Clauderon configuration directory (for CA cert, configs)
    pub clauderon_dir: PathBuf,

    /// Session-specific proxy port (overrides global proxy port)
    pub session_proxy_port: Option<u16>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = KubernetesConfig::default();
        assert_eq!(config.namespace, "clauderon");
        assert_eq!(config.image, "ghcr.io/shepherdjerred/dotfiles");
        assert_eq!(config.cpu_request, "500m");
        assert_eq!(config.memory_request, "512Mi");
        assert_eq!(config.git_remote_name, "origin");
    }

    #[test]
    fn test_load_or_default() {
        let config = KubernetesConfig::load_or_default();
        // Should return default since config file likely doesn't exist
        assert!(!config.namespace.is_empty());
    }
}
