//! Container configuration file generation.
//!
//! Generates kubeconfig and talosconfig files that point to the host proxy,
//! so containers can access Kubernetes and Talos without credentials.

use anyhow::Context;
use std::path::{Path, PathBuf};

use crate::plugins::PluginManifest;
use crate::proxy::{dummy_auth_json_string, dummy_config_toml};

/// Generate all container configuration files.
pub fn generate_container_configs(
    clauderon_dir: &Path,
    talos_gateway_port: u16,
    kubectl_proxy_port: u16,
) -> anyhow::Result<()> {
    generate_talosconfig(clauderon_dir, talos_gateway_port)?;
    generate_kubeconfig(clauderon_dir, kubectl_proxy_port)?;
    Ok(())
}

/// Generate Codex dummy auth/config files for containers.
pub fn generate_codex_config(clauderon_dir: &Path, account_id: Option<&str>) -> anyhow::Result<()> {
    let codex_dir = clauderon_dir.join("codex");
    std::fs::create_dir_all(&codex_dir)?;

    let auth_json_path = codex_dir.join("auth.json");
    let config_toml_path = codex_dir.join("config.toml");

    std::fs::write(auth_json_path, dummy_auth_json_string(account_id)?)?;
    std::fs::write(config_toml_path, dummy_config_toml())?;
    Ok(())
}

/// Generate plugin configuration for containers.
///
/// Creates a known_marketplaces.json file with container-adjusted paths that point to
/// the mounted plugin directories. Plugin files themselves are mounted read-only from
/// the host, so this only generates the configuration metadata.
pub fn generate_plugin_config(
    clauderon_dir: &Path,
    plugin_manifest: &PluginManifest,
) -> anyhow::Result<()> {
    let plugins_dir = clauderon_dir.join("plugins");
    std::fs::create_dir_all(&plugins_dir).context("Failed to create plugins directory")?;

    // Transform marketplace paths from host to container paths
    let container_marketplaces =
        transform_marketplace_paths_for_container(&plugin_manifest.marketplace_configs);

    // Write known_marketplaces.json with container paths
    let marketplaces_path = plugins_dir.join("known_marketplaces.json");
    std::fs::write(
        &marketplaces_path,
        serde_json::to_string_pretty(&container_marketplaces)?,
    )
    .with_context(|| {
        format!(
            "Failed to write known_marketplaces.json to {}",
            marketplaces_path.display()
        )
    })?;

    tracing::debug!(
        "Generated plugin config at {} with {} marketplaces",
        marketplaces_path.display(),
        plugin_manifest.installed_plugins.len()
    );

    Ok(())
}

/// Transform marketplace configuration paths from host to container paths.
///
/// Replaces host-specific paths (e.g., /Users/foo/.claude/plugins/...) with container
/// paths (e.g., /workspace/.claude/plugins/...) since HOME=/workspace in containers.
fn transform_marketplace_paths_for_container(host_config: &serde_json::Value) -> serde_json::Value {
    let mut container_config = host_config.clone();

    if let Some(obj) = container_config.as_object_mut() {
        for (_marketplace_name, marketplace_data) in obj.iter_mut() {
            if let Some(install_location) = marketplace_data.get_mut("installLocation") {
                if let Some(path_str) = install_location.as_str() {
                    // Transform the path to container location
                    // The plugins will be mounted at /workspace/.claude/plugins/marketplaces
                    // regardless of where they are on the host
                    if path_str.contains(".claude/plugins/marketplaces") {
                        // Extract just the marketplace-specific portion
                        if let Some(idx) = path_str.find(".claude/plugins/marketplaces") {
                            let marketplace_relative = &path_str[idx..];
                            let container_path = format!("/workspace/{}", marketplace_relative);
                            *install_location = serde_json::Value::String(container_path);
                        }
                    }
                }
            }
        }
    }

    container_config
}

/// Generate talosconfig for containers.
///
/// This talosconfig points to the Talos TLS gateway running on the host.
/// IMPORTANT: This config intentionally omits ca, crt, and key fields for zero-credential access.
/// The gateway terminates TLS using the proxy's CA, then establishes mTLS to real Talos
/// with the host's credentials. Container never needs private keys.
fn generate_talosconfig(clauderon_dir: &Path, port: u16) -> anyhow::Result<()> {
    let talos_dir = clauderon_dir.join("talos");
    std::fs::create_dir_all(&talos_dir)?;

    // Generate minimal talosconfig with NO certificates (zero-credential access)
    // talosctl will use TLS to connect to the gateway at host.docker.internal:port
    // Gateway terminates TLS and re-establishes mTLS to real Talos with host's cert
    let config = format!(
        r"context: clauderon-proxied
contexts:
    clauderon-proxied:
        endpoints:
            - host.docker.internal:{port}
        nodes:
            - host.docker.internal:{port}
"
    );

    let config_path = talos_dir.join("config");
    std::fs::write(&config_path, config)?;

    tracing::info!("Generated container talosconfig at {:?}", config_path);
    Ok(())
}

/// Generate kubeconfig for containers.
///
/// This kubeconfig points to kubectl proxy running on the host.
/// IMPORTANT: No credentials needed - kubectl proxy handles all authentication using the host's kubeconfig.
/// The container connects via HTTP to host-gateway:{port} (or host.docker.internal:{port} for Docker).
fn generate_kubeconfig(clauderon_dir: &PathBuf, port: u16) -> anyhow::Result<()> {
    let kube_dir = clauderon_dir.join("kube");
    std::fs::create_dir_all(&kube_dir)?;

    // Generate minimal kubeconfig pointing to kubectl proxy via host-gateway
    // kubectl proxy runs on host, containers access via host-gateway:{port}
    // No TLS needed - kubectl proxy serves plain HTTP
    let config = format!(
        r"apiVersion: v1
kind: Config
clusters:
- cluster:
    server: http://host-gateway:{port}
  name: clauderon-proxied
contexts:
- context:
    cluster: clauderon-proxied
    user: clauderon-proxied
  name: clauderon-proxied
current-context: clauderon-proxied
users:
- name: clauderon-proxied
"
    );

    let config_path = kube_dir.join("config");
    std::fs::write(&config_path, config)?;

    tracing::info!("Generated container kubeconfig at {:?}", config_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_generate_talosconfig() {
        let dir = tempdir().unwrap();
        let clauderon_dir = dir.path().to_path_buf();

        generate_talosconfig(&clauderon_dir, 18082).unwrap();

        let config_path = clauderon_dir.join("talos/config");
        assert!(config_path.exists());

        let content = std::fs::read_to_string(&config_path).unwrap();
        assert!(content.contains("host.docker.internal:18082"));
    }

    #[test]
    fn test_generate_kubeconfig() {
        let dir = tempdir().unwrap();
        let clauderon_dir = dir.path().to_path_buf();

        generate_kubeconfig(&clauderon_dir, 18081).unwrap();

        let config_path = clauderon_dir.join("kube/config");
        assert!(config_path.exists());

        let content = std::fs::read_to_string(&config_path).unwrap();
        assert!(content.contains("http://host-gateway:18081"));
        assert!(content.contains("apiVersion: v1"));
        assert!(content.contains("kind: Config"));
        assert!(content.contains("clauderon-proxied"));
    }

    #[test]
    fn test_generate_codex_config() {
        let dir = tempdir().unwrap();
        let clauderon_dir = dir.path().to_path_buf();

        generate_codex_config(&clauderon_dir, Some("acct-123")).unwrap();

        let auth_path = clauderon_dir.join("codex/auth.json");
        let config_path = clauderon_dir.join("codex/config.toml");

        assert!(auth_path.exists());
        assert!(config_path.exists());
    }

    #[test]
    fn test_generate_plugin_config() {
        use crate::plugins::{DiscoveredPlugin, PluginManifest};

        let dir = tempdir().unwrap();
        let clauderon_dir = dir.path().to_path_buf();

        let manifest = PluginManifest {
            marketplace_configs: serde_json::json!({
                "test-marketplace": {
                    "installLocation": "/home/user/.claude/plugins/marketplaces/test-marketplace",
                    "source": {
                        "source": "github",
                        "repo": "test/test"
                    }
                }
            }),
            installed_plugins: vec![DiscoveredPlugin {
                name: "test-plugin".to_string(),
                marketplace: "test-marketplace".to_string(),
                path: PathBuf::from(
                    "/home/user/.claude/plugins/marketplaces/test-marketplace/plugins/test-plugin",
                ),
            }],
        };

        generate_plugin_config(&clauderon_dir, &manifest).unwrap();

        let marketplaces_path = clauderon_dir.join("plugins/known_marketplaces.json");
        assert!(marketplaces_path.exists());

        // Verify the content has transformed paths
        let content = std::fs::read_to_string(&marketplaces_path).unwrap();
        assert!(content.contains("/workspace/.claude/plugins/marketplaces"));
    }

    #[test]
    fn test_generate_plugin_config_creates_directory() {
        use crate::plugins::PluginManifest;

        let dir = tempdir().unwrap();
        let clauderon_dir = dir.path().to_path_buf();

        let manifest = PluginManifest::empty();
        generate_plugin_config(&clauderon_dir, &manifest).unwrap();

        assert!(clauderon_dir.join("plugins").exists());
    }

    #[test]
    fn test_transform_marketplace_paths() {
        let host_config = serde_json::json!({
            "official": {
                "installLocation": "/Users/foo/.claude/plugins/marketplaces/official",
                "source": {"source": "github"}
            },
            "custom": {
                "installLocation": "/home/user/.claude/plugins/marketplaces/custom",
                "source": {"source": "local"}
            }
        });

        let container_config = transform_marketplace_paths_for_container(&host_config);

        let official_location = container_config["official"]["installLocation"]
            .as_str()
            .unwrap();
        assert_eq!(
            official_location,
            "/workspace/.claude/plugins/marketplaces/official"
        );

        let custom_location = container_config["custom"]["installLocation"]
            .as_str()
            .unwrap();
        assert_eq!(
            custom_location,
            "/workspace/.claude/plugins/marketplaces/custom"
        );
    }

    #[test]
    fn test_transform_marketplace_paths_no_match() {
        let host_config = serde_json::json!({
            "test": {
                "installLocation": "/some/other/path",
                "source": {"source": "github"}
            }
        });

        let container_config = transform_marketplace_paths_for_container(&host_config);

        // Path should remain unchanged if it doesn't match the expected pattern
        let location = container_config["test"]["installLocation"]
            .as_str()
            .unwrap();
        assert_eq!(location, "/some/other/path");
    }

    #[test]
    fn test_transform_marketplace_paths_empty_config() {
        let host_config = serde_json::json!({});
        let container_config = transform_marketplace_paths_for_container(&host_config);
        assert!(container_config.as_object().unwrap().is_empty());
    }
}
