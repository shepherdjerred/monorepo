//! Plugin discovery and configuration for clauderon sessions.
//!
//! This module handles discovering Claude Code plugins from the host system
//! and generating appropriate configuration files for containerized sessions.

use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tracing::{debug, info, instrument, warn};

/// Plugin discovery handler for reading host plugin configuration.
pub struct PluginDiscovery {
    host_claude_dir: PathBuf,
}

/// Discovered plugin information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredPlugin {
    pub name: String,
    pub marketplace: String,
    pub path: PathBuf,
}

/// Complete plugin manifest including marketplace configuration.
#[derive(Debug, Clone)]
pub struct PluginManifest {
    pub marketplace_configs: serde_json::Value,
    pub installed_plugins: Vec<DiscoveredPlugin>,
}

impl PluginManifest {
    /// Create an empty plugin manifest (used for graceful degradation).
    #[must_use] 
    pub fn empty() -> Self {
        Self {
            marketplace_configs: serde_json::json!({}),
            installed_plugins: Vec::new(),
        }
    }
}

impl PluginDiscovery {
    /// Create a new plugin discovery instance.
    ///
    /// # Arguments
    ///
    /// * `host_claude_dir` - Path to the host's .claude directory (typically ~/.claude)
    #[must_use] 
    pub fn new(host_claude_dir: PathBuf) -> Self {
        Self { host_claude_dir }
    }

    /// Discover all installed plugins from the host system.
    ///
    /// Returns an empty manifest if the plugin directory doesn't exist (graceful degradation).
    /// Logs warnings for individual plugins that fail to parse but continues processing others.
    #[instrument(skip(self), fields(host_claude_dir = %self.host_claude_dir.display()))]
    pub fn discover_plugins(&self) -> anyhow::Result<PluginManifest> {
        info!("Starting plugin discovery");

        let marketplace_path = self.host_claude_dir.join("plugins/marketplaces");
        if !marketplace_path.exists() {
            warn!(
                "Plugin directory does not exist at {}, skipping plugin inheritance",
                marketplace_path.display()
            );
            return Ok(PluginManifest::empty());
        }

        debug!("Reading marketplace config");
        let marketplace_config = self.read_marketplace_config().unwrap_or_else(|e| {
            warn!("Failed to read marketplace config: {}", e);
            serde_json::json!({})
        });

        debug!("Scanning plugin directories");
        let plugins = self
            .scan_marketplace_plugins(&marketplace_path)
            .unwrap_or_else(|e| {
                warn!("Failed to scan marketplace plugins: {}", e);
                Vec::new()
            });

        info!(
            plugin_count = plugins.len(),
            "Plugin discovery completed successfully"
        );

        Ok(PluginManifest {
            marketplace_configs: marketplace_config,
            installed_plugins: plugins,
        })
    }

    /// Read the marketplace configuration file (known_marketplaces.json).
    #[instrument(skip(self))]
    fn read_marketplace_config(&self) -> anyhow::Result<serde_json::Value> {
        let config_path = self.host_claude_dir.join("plugins/known_marketplaces.json");

        if !config_path.exists() {
            debug!(
                "Marketplace config does not exist at {}",
                config_path.display()
            );
            return Ok(serde_json::json!({}));
        }

        debug!("Reading marketplace config from {}", config_path.display());
        let content = std::fs::read_to_string(&config_path)
            .context("Failed to read known_marketplaces.json")?;

        let config: serde_json::Value =
            serde_json::from_str(&content).context("Failed to parse known_marketplaces.json")?;

        Ok(config)
    }

    /// Scan marketplace directories for installed plugins.
    #[instrument(skip(self))]
    fn scan_marketplace_plugins(
        &self,
        marketplace_path: &Path,
    ) -> anyhow::Result<Vec<DiscoveredPlugin>> {
        let mut plugins = Vec::new();

        let entries = std::fs::read_dir(marketplace_path).with_context(|| {
            format!(
                "Failed to read marketplace directory: {}",
                marketplace_path.display()
            )
        })?;

        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    warn!("Failed to read marketplace entry: {}", e);
                    continue;
                }
            };

            let marketplace_dir = entry.path();
            if !marketplace_dir.is_dir() {
                continue;
            }

            let marketplace_name = marketplace_dir
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();

            debug!(
                "Scanning marketplace: {} at {}",
                marketplace_name,
                marketplace_dir.display()
            );

            // Look for plugins directory within the marketplace
            let plugins_dir = marketplace_dir.join("plugins");
            if !plugins_dir.exists() {
                debug!(
                    "No plugins directory found in marketplace {}",
                    marketplace_name
                );
                continue;
            }

            // Scan for individual plugins
            let plugin_entries = match std::fs::read_dir(&plugins_dir) {
                Ok(entries) => entries,
                Err(e) => {
                    warn!(
                        "Failed to read plugins directory in marketplace {}: {}",
                        marketplace_name, e
                    );
                    continue;
                }
            };

            for plugin_entry in plugin_entries {
                let plugin_entry = match plugin_entry {
                    Ok(e) => e,
                    Err(e) => {
                        warn!("Failed to read plugin entry: {}", e);
                        continue;
                    }
                };

                let plugin_path = plugin_entry.path();
                if !plugin_path.is_dir() {
                    continue;
                }

                let plugin_name = plugin_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("unknown")
                    .to_string();

                // Verify this is a valid plugin by checking for manifest
                let manifest_path = plugin_path.join(".claude-plugin/plugin.json");
                if !manifest_path.exists() {
                    debug!(
                        "Skipping {} - no plugin manifest found at {}",
                        plugin_name,
                        manifest_path.display()
                    );
                    continue;
                }

                debug!(
                    "Found plugin: {} in marketplace {}",
                    plugin_name, marketplace_name
                );

                plugins.push(DiscoveredPlugin {
                    name: plugin_name,
                    marketplace: marketplace_name.clone(),
                    path: plugin_path,
                });
            }
        }

        Ok(plugins)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_discover_plugins_empty_dir() {
        let temp_dir = tempdir().unwrap();
        let claude_dir = temp_dir.path().join(".claude");

        let discovery = PluginDiscovery::new(claude_dir);
        let manifest = discovery.discover_plugins().unwrap();

        assert!(manifest.installed_plugins.is_empty());
        assert_eq!(manifest.marketplace_configs, serde_json::json!({}));
    }

    #[test]
    fn test_discover_plugins_with_valid_plugins() {
        let temp_dir = tempdir().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let marketplace_dir = claude_dir.join("plugins/marketplaces/test-marketplace/plugins");
        fs::create_dir_all(&marketplace_dir).unwrap();

        // Create a valid plugin structure
        let plugin_dir = marketplace_dir.join("test-plugin");
        let manifest_dir = plugin_dir.join(".claude-plugin");
        fs::create_dir_all(&manifest_dir).unwrap();

        let manifest_path = manifest_dir.join("plugin.json");
        fs::write(
            &manifest_path,
            r#"{"name": "test-plugin", "version": "1.0.0"}"#,
        )
        .unwrap();

        // Create known_marketplaces.json
        let plugins_root = claude_dir.join("plugins");
        let marketplaces_config = plugins_root.join("known_marketplaces.json");
        fs::write(
            &marketplaces_config,
            r#"{"test-marketplace": {"installLocation": "/path/to/marketplace"}}"#,
        )
        .unwrap();

        let discovery = PluginDiscovery::new(claude_dir);
        let manifest = discovery.discover_plugins().unwrap();

        assert_eq!(manifest.installed_plugins.len(), 1);
        assert_eq!(manifest.installed_plugins[0].name, "test-plugin");
        assert_eq!(
            manifest.installed_plugins[0].marketplace,
            "test-marketplace"
        );
        assert!(manifest.marketplace_configs.is_object());
    }

    #[test]
    fn test_discover_plugins_with_invalid_json() {
        let temp_dir = tempdir().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let marketplace_dir = claude_dir.join("plugins/marketplaces/test-marketplace/plugins");
        fs::create_dir_all(&marketplace_dir).unwrap();

        // Create a plugin with valid manifest
        let plugin_dir = marketplace_dir.join("valid-plugin");
        let manifest_dir = plugin_dir.join(".claude-plugin");
        fs::create_dir_all(&manifest_dir).unwrap();
        fs::write(
            manifest_dir.join("plugin.json"),
            r#"{"name": "valid-plugin"}"#,
        )
        .unwrap();

        // Create known_marketplaces.json with invalid JSON
        let plugins_root = claude_dir.join("plugins");
        let marketplaces_config = plugins_root.join("known_marketplaces.json");
        fs::write(&marketplaces_config, "invalid json{").unwrap();

        let discovery = PluginDiscovery::new(claude_dir);
        let manifest = discovery.discover_plugins().unwrap();

        // Should still discover plugins even with corrupted marketplace config
        assert_eq!(manifest.installed_plugins.len(), 1);
        assert_eq!(manifest.marketplace_configs, serde_json::json!({}));
    }

    #[test]
    fn test_discover_plugins_without_manifest() {
        let temp_dir = tempdir().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        let marketplace_dir = claude_dir.join("plugins/marketplaces/test-marketplace/plugins");
        fs::create_dir_all(&marketplace_dir).unwrap();

        // Create a directory without plugin manifest
        let not_plugin_dir = marketplace_dir.join("not-a-plugin");
        fs::create_dir_all(&not_plugin_dir).unwrap();

        let discovery = PluginDiscovery::new(claude_dir);
        let manifest = discovery.discover_plugins().unwrap();

        // Should skip directories without manifests
        assert!(manifest.installed_plugins.is_empty());
    }
}
