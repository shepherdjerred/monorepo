//! Configuration management module for persisting app settings

use log::{error, info};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

/// Application configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// Unique client ID for this desktop instance
    pub client_id: String,
    /// API token for authenticating with the backend
    pub api_token: Option<String>,
    /// Backend server URL (e.g., "https://api.scoutforlol.com")
    pub backend_url: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            // Generate a unique client ID for this installation
            client_id: Uuid::new_v4().to_string(),
            api_token: None,
            backend_url: None,
        }
    }
}

impl Config {
    /// Load config from the app's data directory
    pub fn load(config_path: &PathBuf) -> Self {
        match fs::read_to_string(config_path) {
            Ok(contents) => match serde_json::from_str(&contents) {
                Ok(config) => {
                    info!("Loaded config from {}", config_path.display());
                    config
                }
                Err(e) => {
                    error!("Failed to parse config file: {}", e);
                    Self::default()
                }
            },
            Err(e) => {
                info!("No existing config file found ({}), using defaults", e);
                Self::default()
            }
        }
    }

    /// Save config to the app's data directory
    pub fn save(&self, config_path: &PathBuf) -> Result<(), String> {
        // Ensure parent directory exists
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {e}"))?;
        }

        let json = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize config: {e}"))?;

        fs::write(config_path, json).map_err(|e| format!("Failed to write config file: {e}"))?;

        info!("Saved config to {}", config_path.display());
        Ok(())
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn test_config_serialization() {
        let config = Config {
            client_id: "test-client-id".to_string(),
            api_token: Some("test-api-token".to_string()),
            backend_url: Some("https://api.example.com".to_string()),
        };

        let json = serde_json::to_string(&config).expect("test should serialize");
        assert!(json.contains("clientId"));
        assert!(json.contains("apiToken"));
        assert!(json.contains("backendUrl"));
        assert!(json.contains("test-client-id"));
        assert!(json.contains("test-api-token"));
        assert!(json.contains("https://api.example.com"));
    }

    #[test]
    fn test_config_deserialization() {
        let json = r#"{"clientId":"client-123","apiToken":"token-456","backendUrl":"https://example.com"}"#;
        let config: Config = serde_json::from_str(json).expect("test should deserialize");

        assert_eq!(config.client_id, "client-123");
        assert_eq!(config.api_token, Some("token-456".to_string()));
        assert_eq!(config.backend_url, Some("https://example.com".to_string()));
    }

    #[test]
    fn test_config_default() {
        let config = Config::default();
        // client_id should be a valid UUID
        assert!(!config.client_id.is_empty());
        assert!(Uuid::parse_str(&config.client_id).is_ok());
        assert!(config.api_token.is_none());
        assert!(config.backend_url.is_none());
    }

    #[test]
    fn test_config_save_load() {
        let temp_dir = env::temp_dir();
        let config_path = temp_dir.join("scout-test-config.json");

        // Clean up any existing test file
        let _ = fs::remove_file(&config_path);

        let config = Config {
            client_id: "save-test-client".to_string(),
            api_token: Some("save-test-token".to_string()),
            backend_url: Some("https://api.test.com".to_string()),
        };

        // Save
        config.save(&config_path).expect("test should save");

        // Load
        let loaded = Config::load(&config_path);
        assert_eq!(loaded.client_id, config.client_id);
        assert_eq!(loaded.api_token, config.api_token);
        assert_eq!(loaded.backend_url, config.backend_url);

        // Clean up
        let _ = fs::remove_file(&config_path);
    }

    #[test]
    fn test_config_load_missing_file() {
        let config_path = PathBuf::from("/nonexistent/path/config.json");
        let config = Config::load(&config_path);

        // Should return default config when file doesn't exist
        // Default generates a new client_id
        assert!(!config.client_id.is_empty());
        assert!(config.api_token.is_none());
        assert!(config.backend_url.is_none());
    }
}
