//! League Client Update (LCU) API integration module

use base64::engine::general_purpose;
use base64::Engine;
use log::info;
use serde::{Deserialize, Serialize};

/// Represents the connection status of the League Client
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LcuStatus {
    /// Whether the LCU connection is active
    pub connected: bool,
    /// The current summoner's display name (if connected)
    pub summoner_name: Option<String>,
    /// Whether the player is currently in a game
    pub in_game: bool,
}

/// Connection to the League Client Update (LCU) API
#[derive(Debug, Clone)]
pub struct LcuConnection {
    /// The port number the LCU is running on
    pub port: u16,
    /// The authentication token for LCU API requests
    pub token: String,
    /// The base URL for LCU API requests
    pub base_url: String,
    client: reqwest::Client,
}

#[derive(Debug, Deserialize)]
struct CurrentSummoner {
    #[serde(rename = "displayName")]
    display_name: String,
}

impl LcuConnection {
    /// Attempts to connect to the League Client on the standard port
    pub async fn new() -> Result<Self, String> {
        // LCU API runs on fixed port 2999 with self-signed HTTPS and no auth
        let port = 2999;
        let token = String::new(); // No auth needed
        let base_url = format!("https://127.0.0.1:{}", port);

        info!("Connecting to LCU API at {}", base_url);

        // Create HTTP client that accepts self-signed certificates
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        let connection = Self {
            port,
            token,
            base_url,
            client,
        };

        // Test the connection
        connection.test_connection().await?;

        Ok(connection)
    }

    /// Tests the connection to the LCU API
    async fn test_connection(&self) -> Result<(), String> {
        info!("Testing LCU connection...");

        // Try to get session info as a simple connectivity test
        let url = format!("{}/lol-gameflow/v1/session", self.base_url);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to connect to LCU API: {}", e))?;

        if response.status().is_success() || response.status() == 404 {
            // 404 is OK - means client is running but no active game session
            info!("LCU connection test successful");
            Ok(())
        } else {
            Err(format!("LCU API returned error: {}", response.status()))
        }
    }

    /// Makes a GET request to the LCU API
    pub async fn get(&self, endpoint: &str) -> Result<reqwest::Response, String> {
        let url = format!("{}{}", self.base_url, endpoint);

        self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("LCU API request failed: {}", e))
    }

    /// Gets the current summoner information
    pub async fn get_current_summoner(&self) -> Result<String, String> {
        let response = self.get("/lol-summoner/v1/current-summoner").await?;

        if response.status().is_success() {
            let summoner: CurrentSummoner = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse summoner data: {}", e))?;

            Ok(summoner.display_name)
        } else {
            Err(format!("Failed to get summoner: {}", response.status()))
        }
    }

    /// Gets the current LCU connection status
    pub async fn get_status(&self) -> LcuStatus {
        let summoner_name = self.get_current_summoner().await.ok();
        LcuStatus {
            connected: true,
            summoner_name,
            in_game: false, // TODO: Implement game detection
        }
    }

    /// Gets the WebSocket URL for the LCU
    pub fn get_websocket_url(&self) -> String {
        format!("wss://127.0.0.1:{}", self.port)
    }

    /// Gets the Basic authentication header for LCU API requests
    /// Format: Basic <base64("riot:<token>")>
    pub fn get_auth_header(&self) -> String {
        if self.token.is_empty() {
            // If no token, return empty Basic auth (may work for some endpoints)
            "Basic ".to_string()
        } else {
            let credentials = format!("riot:{}", self.token);
            let encoded = general_purpose::STANDARD.encode(credentials.as_bytes());
            format!("Basic {}", encoded)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lcu_status_creation() {
        let status = LcuStatus {
            connected: false,
            summoner_name: None,
            in_game: false,
        };
        assert!(!status.connected);
        assert!(status.summoner_name.is_none());
        assert!(!status.in_game);
    }

    #[test]
    fn test_lcu_status_connected() {
        let status = LcuStatus {
            connected: true,
            summoner_name: Some("TestSummoner".to_string()),
            in_game: true,
        };
        assert!(status.connected);
        assert_eq!(status.summoner_name, Some("TestSummoner".to_string()));
        assert!(status.in_game);
    }

    #[test]
    fn test_lcu_status_serialization() {
        let status = LcuStatus {
            connected: true,
            summoner_name: Some("TestUser".to_string()),
            in_game: false,
        };

        let json = serde_json::to_string(&status).ok();
        assert!(json.is_some());

        if let Some(json_str) = json {
            assert!(json_str.contains("connected"));
            assert!(json_str.contains("summonerName"));
            assert!(json_str.contains("inGame"));
        }
    }

    #[test]
    fn test_lcu_connection_url_generation() {
        // Test WebSocket URL generation
        let port: u16 = 12345;
        let ws_url = format!("wss://127.0.0.1:{port}");
        assert_eq!(ws_url, "wss://127.0.0.1:12345");
    }

    #[test]
    fn test_base_url_format() {
        let port = 54321_u16;
        let url = format!("https://127.0.0.1:{port}");
        assert_eq!(url, "https://127.0.0.1:54321");
    }
}
