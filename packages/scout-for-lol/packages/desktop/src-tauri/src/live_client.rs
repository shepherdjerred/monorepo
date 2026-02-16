//! Live Client Data API module
//!
//! Provides access to the League of Legends Live Client Data API (port 2999).
//! This API is only available during active games and provides real-time game data.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Base URL for the Live Client Data API
const LIVE_CLIENT_BASE_URL: &str = "https://127.0.0.1:2999";

/// Status of the Live Client Data connection
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveClientStatus {
    /// Whether a game is currently in progress
    pub in_game: bool,
    /// The local player's summoner name (if in game)
    pub summoner_name: Option<String>,
    /// The local player's champion (if in game)
    pub champion_name: Option<String>,
}

/// Client for the Live Client Data API
#[derive(Debug, Clone)]
pub struct LiveClientConnection {
    client: reqwest::Client,
    base_url: String,
}

/// Active player data from the API
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivePlayer {
    /// Summoner name of the local player
    pub summoner_name: String,
    /// Riot ID (if available)
    #[serde(default)]
    pub riot_id: Option<String>,
}

/// Player info from the player list
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerInfo {
    /// Summoner name
    pub summoner_name: String,
    /// Champion name
    pub champion_name: String,
    /// Team ("ORDER" or "CHAOS")
    pub team: String,
    /// Whether this player is a bot
    #[serde(default)]
    pub is_bot: bool,
}

/// Game event from the Live Client Data API
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct GameEvent {
    /// Event ID (for deduplication)
    #[serde(rename = "EventID")]
    pub event_id: i64,
    /// Event name (e.g., "ChampionKill", "DragonKill")
    pub event_name: String,
    /// Event time in seconds
    pub event_time: f64,
    /// Additional event data (varies by event type)
    #[serde(flatten)]
    pub data: HashMap<String, serde_json::Value>,
}

/// Events container from the API
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct EventsData {
    /// List of game events
    pub events: Vec<GameEvent>,
}

/// Game stats from the API
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStats {
    /// Game mode (e.g., "CLASSIC", "ARAM")
    pub game_mode: String,
    /// Game time in seconds
    pub game_time: f64,
    /// Map name
    pub map_name: String,
    /// Map number
    pub map_number: i32,
    /// Map terrain (for elemental rift)
    pub map_terrain: String,
}

impl LiveClientConnection {
    /// Creates a new Live Client Data API connection
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            client,
            base_url: LIVE_CLIENT_BASE_URL.to_string(),
        }
    }

    /// Checks if a game is currently in progress
    pub async fn is_game_active(&self) -> bool {
        self.get_active_player().await.is_ok()
    }

    /// Gets the active (local) player's information
    pub async fn get_active_player(&self) -> Result<ActivePlayer, String> {
        let url = format!("{}/liveclientdata/activeplayer", self.base_url);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Live Client Data API: {e}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "Live Client Data API returned status: {}",
                response.status()
            ));
        }

        response
            .json::<ActivePlayer>()
            .await
            .map_err(|e| format!("Failed to parse active player data: {e}"))
    }

    /// Gets the list of all players in the game
    pub async fn get_player_list(&self) -> Result<Vec<PlayerInfo>, String> {
        let url = format!("{}/liveclientdata/playerlist", self.base_url);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Live Client Data API: {e}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "Live Client Data API returned status: {}",
                response.status()
            ));
        }

        response
            .json::<Vec<PlayerInfo>>()
            .await
            .map_err(|e| format!("Failed to parse player list: {e}"))
    }

    /// Gets game events
    pub async fn get_events(&self) -> Result<EventsData, String> {
        let url = format!("{}/liveclientdata/eventdata", self.base_url);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Live Client Data API: {e}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "Live Client Data API returned status: {}",
                response.status()
            ));
        }

        response
            .json::<EventsData>()
            .await
            .map_err(|e| format!("Failed to parse events data: {e}"))
    }

    /// Gets game stats
    pub async fn get_game_stats(&self) -> Result<GameStats, String> {
        let url = format!("{}/liveclientdata/gamestats", self.base_url);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Live Client Data API: {e}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "Live Client Data API returned status: {}",
                response.status()
            ));
        }

        response
            .json::<GameStats>()
            .await
            .map_err(|e| format!("Failed to parse game stats: {e}"))
    }

    /// Gets the current connection status
    pub async fn get_status(&self) -> LiveClientStatus {
        match self.get_active_player().await {
            Ok(player) => LiveClientStatus {
                in_game: true,
                summoner_name: Some(player.summoner_name),
                champion_name: None, // Would need to look up in player list
            },
            Err(_) => LiveClientStatus {
                in_game: false,
                summoner_name: None,
                champion_name: None,
            },
        }
    }
}

/// Context for the current game, built from API data
#[derive(Debug, Clone, Default)]
pub struct GameContext {
    /// Local player's summoner name
    pub local_player_name: String,
    /// Local player's team ("ORDER" or "CHAOS")
    pub local_player_team: String,
    /// Map of summoner name -> player info
    pub players: HashMap<String, PlayerInfo>,
    /// Game mode
    pub game_mode: String,
    /// Map name
    pub map_name: String,
}

impl GameContext {
    /// Build a game context from Live Client Data API
    pub async fn build(client: &LiveClientConnection) -> Result<Self, String> {
        let active_player = client.get_active_player().await?;
        let player_list = client.get_player_list().await?;
        let game_stats = client.get_game_stats().await?;

        let local_player_name = active_player.summoner_name.clone();

        // Find local player's team
        let local_player_team = player_list
            .iter()
            .find(|p| p.summoner_name == local_player_name)
            .map(|p| p.team.clone())
            .unwrap_or_default();

        // Build player map
        let players: HashMap<String, PlayerInfo> = player_list
            .into_iter()
            .map(|p| (p.summoner_name.clone(), p))
            .collect();

        Ok(Self {
            local_player_name,
            local_player_team,
            players,
            game_mode: game_stats.game_mode,
            map_name: game_stats.map_name,
        })
    }

    /// Check if a player is on the local player's team
    pub fn is_ally(&self, summoner_name: &str) -> bool {
        self.players
            .get(summoner_name)
            .is_some_and(|p| p.team == self.local_player_team)
    }

    /// Check if a player is on the enemy team
    pub fn is_enemy(&self, summoner_name: &str) -> bool {
        self.players
            .get(summoner_name)
            .is_some_and(|p| p.team != self.local_player_team)
    }

    /// Check if a summoner name is the local player
    pub fn is_local_player(&self, summoner_name: &str) -> bool {
        summoner_name.eq_ignore_ascii_case(&self.local_player_name)
    }

    /// Get a player's champion name
    pub fn get_champion(&self, summoner_name: &str) -> Option<&str> {
        self.players
            .get(summoner_name)
            .map(|p| p.champion_name.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_live_client_status_default() {
        let status = LiveClientStatus {
            in_game: false,
            summoner_name: None,
            champion_name: None,
        };
        assert!(!status.in_game);
        assert!(status.summoner_name.is_none());
    }

    #[test]
    fn test_game_context_is_local_player() {
        let context = GameContext {
            local_player_name: "TestPlayer".to_string(),
            local_player_team: "ORDER".to_string(),
            players: HashMap::new(),
            game_mode: "CLASSIC".to_string(),
            map_name: "Summoner's Rift".to_string(),
        };

        assert!(context.is_local_player("TestPlayer"));
        assert!(context.is_local_player("testplayer")); // Case insensitive
        assert!(!context.is_local_player("OtherPlayer"));
    }

    #[test]
    fn test_game_context_team_check() {
        let mut players = HashMap::new();
        players.insert(
            "Ally1".to_string(),
            PlayerInfo {
                summoner_name: "Ally1".to_string(),
                champion_name: "Ahri".to_string(),
                team: "ORDER".to_string(),
                is_bot: false,
            },
        );
        players.insert(
            "Enemy1".to_string(),
            PlayerInfo {
                summoner_name: "Enemy1".to_string(),
                champion_name: "Zed".to_string(),
                team: "CHAOS".to_string(),
                is_bot: false,
            },
        );

        let context = GameContext {
            local_player_name: "LocalPlayer".to_string(),
            local_player_team: "ORDER".to_string(),
            players,
            game_mode: "CLASSIC".to_string(),
            map_name: "Summoner's Rift".to_string(),
        };

        assert!(context.is_ally("Ally1"));
        assert!(!context.is_ally("Enemy1"));
        assert!(context.is_enemy("Enemy1"));
        assert!(!context.is_enemy("Ally1"));
    }
}
