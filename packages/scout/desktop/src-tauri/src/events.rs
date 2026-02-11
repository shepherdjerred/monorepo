//! Game event monitoring and processing module
//!
//! This module polls the League of Legends Live Client Data API and forwards
//! game events to the backend service for sound playback.

use crate::backend_client::{BackendClient, GameEvent};
use crate::lcu::LcuConnection;
use crate::paths;
use futures_util::{SinkExt, StreamExt};
use log::{debug, error, info};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

fn debug_log(msg: &str) {
    eprintln!("[SCOUT] {}", msg);

    let log_path = paths::debug_log_file();

    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let _ = writeln!(file, "{}", msg);
    }
}

#[derive(Debug, Deserialize)]
struct LcuWebSocketMessage {
    #[serde(rename = "eventType")]
    event_type: String,
    uri: String,
    data: Value,
}

/// Tracks game state for detecting special events like first blood and ace
struct GameState {
    /// Whether first blood has occurred
    first_blood_occurred: bool,
    /// Set of player names on the enemy team (for ace detection)
    enemy_players: HashSet<String>,
    /// Map of player names to their champion names
    player_champions: HashMap<String, String>,
    /// Map of player names to their teams
    player_teams: HashMap<String, String>,
    /// Highest EventID we've processed (to only process new events)
    highest_processed_event_id: Option<i64>,
    /// Last time we warned about API unavailability (to throttle warnings)
    last_api_warning: Option<std::time::Instant>,
    /// Local player's summoner name
    local_player_name: Option<String>,
    /// Local player's team
    local_player_team: Option<String>,
    /// Whether we're currently in a game
    in_game: bool,
}

/// Starts monitoring game events and forwarding to the backend
pub async fn start_event_monitoring(
    lcu: Arc<Mutex<Option<LcuConnection>>>,
    backend: Arc<Mutex<Option<BackendClient>>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    info!("Starting event monitoring...");

    let lcu_conn = {
        let guard = lcu.lock().await;
        guard
            .as_ref()
            .ok_or_else(|| "LCU not connected".to_string())?
            .clone()
    };

    let backend_client = {
        let guard = backend.lock().await;
        guard
            .as_ref()
            .ok_or_else(|| "Backend not configured".to_string())?
            .clone()
    };

    // Spawn background tasks for WebSocket monitoring and live game data polling
    let lcu_for_polling = lcu_conn.clone();
    let backend_for_polling = backend_client.clone();
    let app_handle_for_polling = app_handle.clone();

    let app_handle_for_ws = app_handle.clone();
    tokio::spawn(async move {
        if let Err(e) = run_event_loop(lcu_conn, backend_client, app_handle_for_ws).await {
            error!("Event monitoring WebSocket failed: {}", e);
        }
    });

    // Spawn live game data polling task
    tokio::spawn(async move {
        info!("Live game data polling task spawned");
        debug_log("=== POLLING TASK SPAWNED ===");
        let _ = app_handle_for_polling.emit("backend-log", "Polling task started");
        if let Err(e) =
            poll_live_game_data(lcu_for_polling, backend_for_polling, app_handle_for_polling).await
        {
            error!("Live game data polling failed: {}", e);
            debug_log(&format!("POLLING FAILED: {}", e));
        }
    });

    Ok(())
}

async fn run_event_loop(
    lcu: LcuConnection,
    backend: BackendClient,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    info!("Connecting to LCU WebSocket...");

    let ws_url = lcu.get_websocket_url();
    let auth_header = lcu.get_auth_header();

    let mut request = ws_url
        .into_client_request()
        .map_err(|e| format!("Failed to create WebSocket request: {}", e))?;

    request.headers_mut().insert(
        "Authorization",
        auth_header
            .parse()
            .map_err(|e| format!("Failed to parse auth header: {e}"))?,
    );

    let (ws_stream, _) = connect_async(request)
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))?;

    info!("Connected to LCU WebSocket");

    let (mut write, mut read) = ws_stream.split();

    // Subscribe to game events
    let subscriptions = vec![
        json_message(5, "/lol-gameflow/v1/gameflow-phase"),
        json_message(5, "/lol-champ-select/v1/session"),
        json_message(5, "/lol-end-of-game/v1/eog-stats-block"),
    ];

    for sub in subscriptions {
        write
            .send(Message::Text(sub.into()))
            .await
            .map_err(|e| format!("Failed to subscribe: {}", e))?;
    }

    info!("Subscribed to game events");

    while let Some(message) = read.next().await {
        match message {
            Ok(Message::Text(text)) => {
                debug!("Received WebSocket message: {}", text);

                if let Ok(ws_msg) = serde_json::from_str::<LcuWebSocketMessage>(&text) {
                    handle_event(&ws_msg, &backend, &app_handle);
                }
            }
            Ok(Message::Close(_)) => {
                info!("WebSocket closed");
                break;
            }
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }

    Ok(())
}

fn json_message(opcode: u8, path: &str) -> String {
    format!(r#"[{}, "{}"]"#, opcode, path)
}

/// Polls the live game data endpoint for real-time events
async fn poll_live_game_data(
    _lcu: LcuConnection,
    backend: BackendClient,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let game_state = Arc::new(Mutex::new(GameState {
        first_blood_occurred: false,
        enemy_players: HashSet::new(),
        player_champions: HashMap::new(),
        player_teams: HashMap::new(),
        highest_processed_event_id: None,
        last_api_warning: None,
        local_player_name: None,
        local_player_team: None,
        in_game: false,
    }));

    info!("Starting live game data polling loop...");
    debug_log("Starting polling loop");

    loop {
        sleep(Duration::from_secs(2)).await;
        debug!("Polling cycle started...");

        match process_live_game_data(&backend, &game_state, &app_handle).await {
            Ok(()) => {
                debug!("Process succeeded");
            }
            Err(e) => {
                debug_log(&format!("Live Client Data API error: {}", e));

                let mut state = game_state.lock().await;
                let should_warn = state
                    .last_api_warning
                    .map(|t| t.elapsed().as_secs() > 60)
                    .unwrap_or(true);

                if should_warn {
                    debug_log(&format!(
                        "No active game - Live Client Data API not available: {}",
                        e
                    ));
                    state.last_api_warning = Some(std::time::Instant::now());
                }
            }
        }
    }
}

/// Processes live game data and forwards events to backend
async fn process_live_game_data(
    backend: &BackendClient,
    game_state: &Arc<Mutex<GameState>>,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    debug_log("process_live_game_data called");

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let base_url = "https://127.0.0.1:2999";

    // Try the dedicated events endpoint first
    let response = match client
        .get(format!("{}/liveclientdata/eventdata", base_url))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => resp,
        _ => {
            match client
                .get(format!("{}/liveclientdata/allgamedata", base_url))
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    return Err(format!("Live Client Data API not available: {}", e));
                }
            }
        }
    };

    if !response.status().is_success() {
        return Ok(());
    }

    let data: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse live game data: {}", e))?;

    // Initialize game state from API data
    {
        let mut state = game_state.lock().await;

        // Extract local player name
        if state.local_player_name.is_none() {
            if let Some(summoner_name) = data
                .get("activePlayer")
                .and_then(|p| p.get("summonerName"))
                .and_then(|v| v.as_str())
            {
                info!("Local player identified: {}", summoner_name);
                state.local_player_name = Some(summoner_name.to_string());
            }
        }

        // Initialize player data
        if state.player_champions.is_empty() {
            if let Some(players) = data.get("allPlayers").and_then(|v| v.as_array()) {
                let local_name = state.local_player_name.clone();

                for player in players {
                    if let (Some(name), Some(champion), Some(team)) = (
                        player.get("summonerName").and_then(|v| v.as_str()),
                        player.get("championName").and_then(|v| v.as_str()),
                        player.get("team").and_then(|v| v.as_str()),
                    ) {
                        state
                            .player_champions
                            .insert(name.to_string(), champion.to_string());
                        state
                            .player_teams
                            .insert(name.to_string(), team.to_string());

                        if Some(name.to_string()) == local_name {
                            state.local_player_team = Some(team.to_string());
                        } else if state.local_player_team.as_deref() != Some(team) {
                            state.enemy_players.insert(name.to_string());
                        }
                    }
                }
            }
        }
    }

    // Process events
    let events_array = data
        .get("events")
        .and_then(|v| v.as_object())
        .and_then(|obj| obj.get("Events"))
        .and_then(|v| v.as_array())
        .or_else(|| data.get("Events").and_then(|v| v.as_array()));

    if let Some(events_array) = events_array {
        let highest_processed = {
            let state = game_state.lock().await;
            state.highest_processed_event_id
        };

        let mut new_highest_id = highest_processed;

        for event in events_array {
            let event_id = event.get("EventID").and_then(|v| v.as_i64());
            if let Some(id) = event_id {
                if let Some(highest) = highest_processed {
                    if id <= highest {
                        continue;
                    }
                }
                new_highest_id = Some(new_highest_id.map(|h| h.max(id)).unwrap_or(id));

                let _ = app_handle.emit("backend-log", format!("🆕 New event ID: {}", id));
            } else {
                continue;
            }

            if let Some(event_type) = event.get("EventName").and_then(|v| v.as_str()) {
                if let Err(e) =
                    forward_event_to_backend(event, event_type, backend, game_state, app_handle)
                        .await
                {
                    error!("Failed to forward event to backend: {}", e);
                    let _ =
                        app_handle.emit("backend-log", format!("❌ Event forward failed: {}", e));
                }
            }
        }

        // Update highest processed event ID
        if let Some(new_highest) = new_highest_id {
            let mut state = game_state.lock().await;
            state.highest_processed_event_id = Some(new_highest);
        }
    }

    Ok(())
}

/// Forward a game event to the backend
async fn forward_event_to_backend(
    event: &Value,
    event_type: &str,
    backend: &BackendClient,
    game_state: &Arc<Mutex<GameState>>,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let state = game_state.lock().await;
    let local_player_name = state.local_player_name.clone().unwrap_or_default();
    let local_player_team = state.local_player_team.clone().unwrap_or_default();
    let player_champions = state.player_champions.clone();
    let player_teams = state.player_teams.clone();
    drop(state);

    let game_time = event
        .get("EventTime")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    let backend_event = match event_type {
        "ChampionKill" => {
            let killer = event
                .get("KillerName")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let victim = event
                .get("VictimName")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let killer_team = player_teams.get(killer).cloned().unwrap_or_default();

            GameEvent::Kill {
                killer_name: killer.to_string(),
                victim_name: victim.to_string(),
                killer_champion: player_champions.get(killer).cloned(),
                victim_champion: player_champions.get(victim).cloned(),
                local_player_name: local_player_name.clone(),
                local_player_team: local_player_team.clone(),
                killer_team,
                game_time,
                is_first_blood: None,
            }
        }
        "FirstBlood" => {
            let killer = event
                .get("KillerName")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let victim = event
                .get("VictimName")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let killer_team = player_teams.get(killer).cloned().unwrap_or_default();

            GameEvent::FirstBlood {
                killer_name: killer.to_string(),
                victim_name: victim.to_string(),
                killer_champion: player_champions.get(killer).cloned(),
                victim_champion: player_champions.get(victim).cloned(),
                local_player_name: local_player_name.clone(),
                local_player_team: local_player_team.clone(),
                killer_team,
                game_time,
            }
        }
        "Multikill" => {
            let killer = event
                .get("KillerName")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let kill_streak = event
                .get("KillStreak")
                .and_then(|v| v.as_i64())
                .unwrap_or(2);
            let killer_team = player_teams.get(killer).cloned().unwrap_or_default();

            GameEvent::MultiKill {
                killer_name: killer.to_string(),
                killer_champion: player_champions.get(killer).cloned(),
                kill_count: kill_streak,
                local_player_name: local_player_name.clone(),
                local_player_team: local_player_team.clone(),
                killer_team,
                game_time,
            }
        }
        "DragonKill" => {
            let killer = event.get("KillerName").and_then(|v| v.as_str());
            let dragon_type = event.get("DragonType").and_then(|v| v.as_str());
            let stolen = event.get("Stolen").and_then(|v| v.as_str()) == Some("True");
            let team = if player_teams.get(killer.unwrap_or("")) == Some(&local_player_team) {
                "ally"
            } else {
                "enemy"
            };

            GameEvent::Objective {
                objective_type: "dragon".to_string(),
                killer_name: killer.map(|s| s.to_string()),
                dragon_type: dragon_type.map(|s| s.to_lowercase()),
                is_stolen: Some(stolen),
                team: team.to_string(),
                local_player_name: local_player_name.clone(),
                game_time,
            }
        }
        "BaronKill" => {
            let killer = event.get("KillerName").and_then(|v| v.as_str());
            let stolen = event.get("Stolen").and_then(|v| v.as_str()) == Some("True");
            let team = if player_teams.get(killer.unwrap_or("")) == Some(&local_player_team) {
                "ally"
            } else {
                "enemy"
            };

            GameEvent::Objective {
                objective_type: "baron".to_string(),
                killer_name: killer.map(|s| s.to_string()),
                dragon_type: None,
                is_stolen: Some(stolen),
                team: team.to_string(),
                local_player_name: local_player_name.clone(),
                game_time,
            }
        }
        "HeraldKill" => {
            let killer = event.get("KillerName").and_then(|v| v.as_str());
            let stolen = event.get("Stolen").and_then(|v| v.as_str()) == Some("True");
            let team = if player_teams.get(killer.unwrap_or("")) == Some(&local_player_team) {
                "ally"
            } else {
                "enemy"
            };

            GameEvent::Objective {
                objective_type: "herald".to_string(),
                killer_name: killer.map(|s| s.to_string()),
                dragon_type: None,
                is_stolen: Some(stolen),
                team: team.to_string(),
                local_player_name: local_player_name.clone(),
                game_time,
            }
        }
        "TurretKilled" | "FirstBrick" => {
            let killer = event.get("KillerName").and_then(|v| v.as_str());
            let team = if player_teams.get(killer.unwrap_or("")) == Some(&local_player_team) {
                "ally"
            } else {
                "enemy"
            };

            GameEvent::Objective {
                objective_type: "tower".to_string(),
                killer_name: killer.map(|s| s.to_string()),
                dragon_type: None,
                is_stolen: None,
                team: team.to_string(),
                local_player_name: local_player_name.clone(),
                game_time,
            }
        }
        "InhibKilled" => {
            let killer = event.get("KillerName").and_then(|v| v.as_str());
            let team = if player_teams.get(killer.unwrap_or("")) == Some(&local_player_team) {
                "ally"
            } else {
                "enemy"
            };

            GameEvent::Objective {
                objective_type: "inhibitor".to_string(),
                killer_name: killer.map(|s| s.to_string()),
                dragon_type: None,
                is_stolen: None,
                team: team.to_string(),
                local_player_name: local_player_name.clone(),
                game_time,
            }
        }
        "Ace" => {
            let acing_team = event
                .get("AcingTeam")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            GameEvent::Ace {
                acing_team: acing_team.to_string(),
                local_player_team: local_player_team.clone(),
                game_time,
            }
        }
        _ => {
            debug!("Unhandled event type: {}", event_type);
            return Ok(());
        }
    };

    info!("Forwarding {} event to backend", event_type);
    let _ = app_handle.emit(
        "backend-log",
        format!("📤 Sending {} to backend...", event_type),
    );

    match backend.submit_event(backend_event).await {
        Ok(response) => {
            if let Some(sound) = &response.sound_played {
                info!("✅ Backend played sound: {}", sound);
                let _ = app_handle.emit("backend-log", format!("🔊 Sound played: {}", sound));
            } else {
                info!("✅ Event submitted (no sound matched)");
                let _ = app_handle.emit("backend-log", "✅ Event submitted (no sound)".to_string());
            }
            Ok(())
        }
        Err(e) => {
            error!("Failed to submit event to backend: {}", e);
            Err(e)
        }
    }
}

fn handle_event(
    msg: &LcuWebSocketMessage,
    _backend: &BackendClient,
    app_handle: &tauri::AppHandle,
) {
    if msg.uri.contains("/lol-gameflow/v1/gameflow-phase") {
        handle_gameflow_event(&msg.data, app_handle);
    }
}

fn handle_gameflow_event(data: &Value, app_handle: &tauri::AppHandle) {
    if let Some(phase) = data.as_str() {
        match phase {
            "InProgress" => {
                info!("Game started");
                let _ = app_handle.emit("backend-log", "🎮 Game started!".to_string());
                // Game start event will be sent when we get player data from Live Client API
            }
            "EndOfGame" => {
                info!("Game ended");
                let _ = app_handle.emit("backend-log", "🏁 Game ended".to_string());
            }
            _ => {
                debug!("Game phase: {}", phase);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_json_message_format() {
        let message = json_message(5, "/lol-gameflow/v1/gameflow-phase");
        assert_eq!(message, r#"[5, "/lol-gameflow/v1/gameflow-phase"]"#);
    }
}
