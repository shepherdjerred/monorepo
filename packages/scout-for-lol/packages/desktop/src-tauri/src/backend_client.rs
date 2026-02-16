//! Backend API client for communicating with the Scout for LoL backend service.
//!
//! This module handles sending game events to the backend via HTTP/tRPC,
//! which then triggers sound playback in Discord voice channels.

use log::{debug, error, info, warn};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Client for communicating with the backend API
#[derive(Clone)]
pub struct BackendClient {
    http_client: Client,
    config: Arc<Mutex<BackendConfig>>,
}

/// Backend configuration
#[derive(Clone)]
pub struct BackendConfig {
    pub api_token: String,
    pub backend_url: String,
    pub client_id: String,
}

/// Status of the backend connection
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStatus {
    pub connected: bool,
    pub backend_url: Option<String>,
    pub last_error: Option<String>,
}

/// Game event to send to the backend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "eventType", rename_all = "camelCase")]
pub enum GameEvent {
    #[serde(rename = "gameStart")]
    GameStart {
        #[serde(rename = "gameMode")]
        game_mode: String,
        #[serde(rename = "mapName")]
        map_name: String,
        #[serde(rename = "localPlayerName")]
        local_player_name: String,
        #[serde(rename = "localPlayerTeam")]
        local_player_team: String,
        players: Vec<PlayerInfo>,
    },
    #[serde(rename = "kill")]
    Kill {
        #[serde(rename = "killerName")]
        killer_name: String,
        #[serde(rename = "victimName")]
        victim_name: String,
        #[serde(rename = "killerChampion")]
        killer_champion: Option<String>,
        #[serde(rename = "victimChampion")]
        victim_champion: Option<String>,
        #[serde(rename = "localPlayerName")]
        local_player_name: String,
        #[serde(rename = "localPlayerTeam")]
        local_player_team: String,
        #[serde(rename = "killerTeam")]
        killer_team: String,
        #[serde(rename = "gameTime")]
        game_time: f64,
        #[serde(rename = "isFirstBlood")]
        is_first_blood: Option<bool>,
    },
    #[serde(rename = "firstBlood")]
    FirstBlood {
        #[serde(rename = "killerName")]
        killer_name: String,
        #[serde(rename = "victimName")]
        victim_name: String,
        #[serde(rename = "killerChampion")]
        killer_champion: Option<String>,
        #[serde(rename = "victimChampion")]
        victim_champion: Option<String>,
        #[serde(rename = "localPlayerName")]
        local_player_name: String,
        #[serde(rename = "localPlayerTeam")]
        local_player_team: String,
        #[serde(rename = "killerTeam")]
        killer_team: String,
        #[serde(rename = "gameTime")]
        game_time: f64,
    },
    #[serde(rename = "multiKill")]
    MultiKill {
        #[serde(rename = "killerName")]
        killer_name: String,
        #[serde(rename = "killerChampion")]
        killer_champion: Option<String>,
        #[serde(rename = "killCount")]
        kill_count: i64,
        #[serde(rename = "localPlayerName")]
        local_player_name: String,
        #[serde(rename = "localPlayerTeam")]
        local_player_team: String,
        #[serde(rename = "killerTeam")]
        killer_team: String,
        #[serde(rename = "gameTime")]
        game_time: f64,
    },
    #[serde(rename = "objective")]
    Objective {
        #[serde(rename = "objectiveType")]
        objective_type: String,
        #[serde(rename = "killerName")]
        killer_name: Option<String>,
        #[serde(rename = "dragonType")]
        dragon_type: Option<String>,
        #[serde(rename = "isStolen")]
        is_stolen: Option<bool>,
        team: String,
        #[serde(rename = "localPlayerName")]
        local_player_name: String,
        #[serde(rename = "gameTime")]
        game_time: f64,
    },
    #[serde(rename = "ace")]
    Ace {
        #[serde(rename = "acingTeam")]
        acing_team: String,
        #[serde(rename = "localPlayerTeam")]
        local_player_team: String,
        #[serde(rename = "gameTime")]
        game_time: f64,
    },
    #[serde(rename = "gameEnd")]
    GameEnd {
        result: String,
        #[serde(rename = "gameDuration")]
        game_duration: f64,
    },
}

/// Player information for game start event
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerInfo {
    pub summoner_name: String,
    pub champion_name: String,
    pub team: String,
}

/// Response from event submission
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventResponse {
    pub sound_played: Option<String>,
    pub rule_name: Option<String>,
    pub volume: Option<f32>,
}

/// tRPC request wrapper
#[derive(Serialize)]
struct TrpcRequest<T> {
    json: T,
}

/// tRPC response wrapper
#[derive(Deserialize)]
struct TrpcResponse<T> {
    result: TrpcResult<T>,
}

#[derive(Deserialize)]
struct TrpcResult<T> {
    data: TrpcData<T>,
}

#[derive(Deserialize)]
struct TrpcData<T> {
    json: T,
}

impl BackendClient {
    /// Create a new backend client
    #[allow(clippy::expect_used)]
    pub fn new(api_token: String, backend_url: String, client_id: String) -> Self {
        Self {
            // Using expect here is acceptable as failing to create an HTTP client
            // is an unrecoverable initialization error
            http_client: Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("Failed to create HTTP client"),
            config: Arc::new(Mutex::new(BackendConfig {
                api_token,
                backend_url,
                client_id,
            })),
        }
    }

    /// Get current status
    pub fn get_status(&self) -> BackendStatus {
        // For now, just return configured status
        // In the future, this could check actual connectivity
        let config = self.config.blocking_lock();
        BackendStatus {
            connected: !config.api_token.is_empty() && !config.backend_url.is_empty(),
            backend_url: Some(config.backend_url.clone()),
            last_error: None,
        }
    }

    /// Submit a game event to the backend
    pub async fn submit_event(&self, event: GameEvent) -> Result<EventResponse, String> {
        let config = self.config.lock().await;
        let url = format!("{}/trpc/event.submit", config.backend_url);

        debug!("Submitting event to backend: {:?}", event);

        let response = self
            .http_client
            .post(&url)
            .header("Authorization", format!("Bearer {}", config.api_token))
            .header("Content-Type", "application/json")
            .json(&TrpcRequest { json: &event })
            .send()
            .await
            .map_err(|e| format!("Failed to send event to backend: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            error!("Backend returned error: {} - {}", status, body);
            return Err(format!("Backend error: {} - {}", status, body));
        }

        let trpc_response: TrpcResponse<EventResponse> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse backend response: {}", e))?;

        info!(
            "Event submitted successfully. Sound played: {:?}",
            trpc_response.result.data.json.sound_played
        );

        Ok(trpc_response.result.data.json)
    }

    /// Send heartbeat to backend
    #[allow(clippy::items_after_statements)]
    pub async fn heartbeat(&self, in_game: bool, game_id: Option<String>) -> Result<(), String> {
        let config = self.config.lock().await;
        let url = format!("{}/trpc/event.heartbeat", config.backend_url);

        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct HeartbeatInput {
            client_id: String,
            in_game: bool,
            #[serde(skip_serializing_if = "Option::is_none")]
            game_id: Option<String>,
        }

        let input = HeartbeatInput {
            client_id: config.client_id.clone(),
            in_game,
            game_id,
        };

        let response = self
            .http_client
            .post(&url)
            .header("Authorization", format!("Bearer {}", config.api_token))
            .header("Content-Type", "application/json")
            .json(&TrpcRequest { json: &input })
            .send()
            .await
            .map_err(|e| format!("Failed to send heartbeat: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            warn!("Heartbeat failed: {} - {}", status, body);
            return Err(format!("Heartbeat failed: {} - {}", status, body));
        }

        debug!("Heartbeat sent successfully");
        Ok(())
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn test_game_event_kill_serialization() {
        let event = GameEvent::Kill {
            killer_name: "Yasuo".to_string(),
            victim_name: "Zed".to_string(),
            killer_champion: Some("Yasuo".to_string()),
            victim_champion: Some("Zed".to_string()),
            local_player_name: "Yasuo".to_string(),
            local_player_team: "ORDER".to_string(),
            killer_team: "ORDER".to_string(),
            game_time: 125.5,
            is_first_blood: Some(false),
        };

        let json = serde_json::to_string(&event).expect("should serialize");
        assert!(json.contains("\"eventType\":\"kill\""));
        assert!(json.contains("\"killerName\":\"Yasuo\""));
        assert!(json.contains("\"victimName\":\"Zed\""));
    }

    #[test]
    fn test_game_event_multikill_serialization() {
        let event = GameEvent::MultiKill {
            killer_name: "Katarina".to_string(),
            killer_champion: Some("Katarina".to_string()),
            kill_count: 3,
            local_player_name: "Katarina".to_string(),
            local_player_team: "ORDER".to_string(),
            killer_team: "ORDER".to_string(),
            game_time: 300.0,
        };

        let json = serde_json::to_string(&event).expect("should serialize");
        assert!(json.contains("\"eventType\":\"multiKill\""));
        assert!(json.contains("\"killCount\":3"));
    }

    #[test]
    fn test_game_event_objective_serialization() {
        let event = GameEvent::Objective {
            objective_type: "dragon".to_string(),
            killer_name: Some("Jungler".to_string()),
            dragon_type: Some("infernal".to_string()),
            is_stolen: Some(false),
            team: "ally".to_string(),
            local_player_name: "Player".to_string(),
            game_time: 600.0,
        };

        let json = serde_json::to_string(&event).expect("should serialize");
        assert!(json.contains("\"eventType\":\"objective\""));
        assert!(json.contains("\"objectiveType\":\"dragon\""));
        assert!(json.contains("\"dragonType\":\"infernal\""));
    }

    #[test]
    fn test_backend_status() {
        let client = BackendClient::new(
            "test-token".to_string(),
            "https://api.example.com".to_string(),
            "test-client-id".to_string(),
        );

        let status = client.get_status();
        assert!(status.connected);
        assert_eq!(
            status.backend_url,
            Some("https://api.example.com".to_string())
        );
    }
}
