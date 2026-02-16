//! Scout for `LoL` Desktop Application
//!
//! A Tauri-based desktop client for monitoring League of Legends games
//! and forwarding events to the backend service for sound playback.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![warn(missing_docs, clippy::all, clippy::pedantic, clippy::nursery)]
#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args,
    clippy::doc_markdown,
    clippy::cognitive_complexity,
    clippy::too_many_lines,
    clippy::map_unwrap_or,
    clippy::unused_self,
    clippy::significant_drop_tightening,
    clippy::redundant_closure_for_method_calls,
    clippy::useless_format,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::option_if_let_else,
    dead_code,
    clippy::struct_excessive_bools,
    clippy::single_match,
    clippy::single_match_else,
    clippy::missing_const_for_fn,
    clippy::used_underscore_binding
)]

mod backend_client;
mod config;
mod events;
mod lcu;
mod live_client;
mod paths;

#[cfg(test)]
mod tests;

use backend_client::{BackendClient, BackendStatus};
use log::{error, info};
use std::io::Write;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex;

/// Appends a message to the startup log.
fn append_startup_log(message: &str) {
    let path = if let Some(app_dir) = paths::try_app_data_dir() {
        app_dir.join("logs").join("startup-log.txt")
    } else if let Ok(cwd) = std::env::current_dir() {
        cwd.join("startup-log.txt")
    } else {
        return;
    };

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(file, "{}", message);
    }
}

struct AppState {
    lcu_connection: Arc<Mutex<Option<lcu::LcuConnection>>>,
    backend_client: Arc<Mutex<Option<BackendClient>>>,
    is_monitoring: Arc<Mutex<bool>>,
}

// =============================================================================
// LCU Connection Commands
// =============================================================================

#[tauri::command]
async fn get_lcu_status(state: State<'_, AppState>) -> Result<lcu::LcuStatus, String> {
    let connection = state.lcu_connection.lock().await;
    match connection.as_ref() {
        Some(conn) => Ok(conn.get_status().await),
        None => Ok(lcu::LcuStatus {
            connected: false,
            summoner_name: None,
            in_game: false,
        }),
    }
}

#[tauri::command]
async fn connect_lcu(state: State<'_, AppState>) -> Result<(), String> {
    info!("Attempting to connect to League Client...");

    match lcu::LcuConnection::new().await {
        Ok(connection) => {
            info!("Successfully connected to League Client");
            let mut lcu = state.lcu_connection.lock().await;
            *lcu = Some(connection);
            Ok(())
        }
        Err(e) => {
            error!("Failed to connect to League Client: {}", e);
            Err(format!("Failed to connect to League Client: {e}"))
        }
    }
}

#[tauri::command]
async fn disconnect_lcu(state: State<'_, AppState>) -> Result<(), String> {
    info!("Disconnecting from League Client...");
    let mut lcu = state.lcu_connection.lock().await;
    *lcu = None;
    Ok(())
}

// =============================================================================
// Backend Configuration Commands
// =============================================================================

#[tauri::command]
async fn configure_backend(
    api_token: String,
    backend_url: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    info!("Configuring backend client...");

    // Load config to get client_id
    let mut cfg = config::Config::load(&paths::config_file());
    cfg.api_token = Some(api_token.clone());
    cfg.backend_url = Some(backend_url.clone());
    cfg.save(&paths::config_file())?;

    let client = BackendClient::new(api_token, backend_url, cfg.client_id.clone());

    let mut backend = state.backend_client.lock().await;
    *backend = Some(client);

    info!("Backend client configured successfully");
    Ok(())
}

#[tauri::command]
async fn get_backend_status(state: State<'_, AppState>) -> Result<BackendStatus, String> {
    let client = state.backend_client.lock().await;
    Ok(client.as_ref().map_or(
        BackendStatus {
            connected: false,
            backend_url: None,
            last_error: None,
        },
        BackendClient::get_status,
    ))
}

#[tauri::command]
async fn test_backend_connection(state: State<'_, AppState>) -> Result<(), String> {
    let guard = state.backend_client.lock().await;
    let client = guard.as_ref().ok_or("Backend not configured")?;

    // Send a heartbeat to test the connection
    client.heartbeat(false, None).await
}

// =============================================================================
// Monitoring Commands
// =============================================================================

#[tauri::command]
async fn start_monitoring(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    info!("Starting game monitoring...");

    let mut is_monitoring = state.is_monitoring.lock().await;
    if *is_monitoring {
        return Err("Monitoring is already active".to_string());
    }

    if let Err(e) = app_handle.emit("backend-log", "Starting monitoring...") {
        error!("Failed to emit event: {}", e);
    }

    events::start_event_monitoring(
        state.lcu_connection.clone(),
        state.backend_client.clone(),
        app_handle,
    )
    .await?;

    *is_monitoring = true;
    drop(is_monitoring);
    info!("Game monitoring started");
    Ok(())
}

#[tauri::command]
async fn stop_monitoring(state: State<'_, AppState>) -> Result<(), String> {
    info!("Stopping game monitoring...");

    let mut is_monitoring = state.is_monitoring.lock().await;
    if !*is_monitoring {
        return Err("Monitoring is not active".to_string());
    }

    *is_monitoring = false;
    drop(is_monitoring);
    info!("Game monitoring stopped");
    Ok(())
}

#[tauri::command]
async fn get_monitoring_status(state: State<'_, AppState>) -> Result<bool, String> {
    let is_monitoring = state.is_monitoring.lock().await;
    Ok(*is_monitoring)
}

// =============================================================================
// Config Commands
// =============================================================================

#[tauri::command]
async fn load_config() -> Result<config::Config, String> {
    let config_path = paths::config_file();
    info!("Loading config from {}", config_path.display());
    Ok(config::Config::load(&config_path))
}

#[tauri::command]
async fn save_config(cfg: config::Config) -> Result<(), String> {
    let config_path = paths::config_file();
    info!("Saving config to {}", config_path.display());
    cfg.save(&config_path)
}

// =============================================================================
// Utility Commands
// =============================================================================

#[derive(serde::Serialize)]
struct LogPaths {
    logs_dir: String,
    debug_log: String,
    startup_log: String,
}

#[tauri::command]
async fn get_log_paths() -> Result<LogPaths, String> {
    Ok(LogPaths {
        logs_dir: paths::logs_dir().to_string_lossy().to_string(),
        debug_log: paths::debug_log_file().to_string_lossy().to_string(),
        startup_log: paths::startup_log_file().to_string_lossy().to_string(),
    })
}

#[derive(serde::Serialize)]
struct DiagnosticInfo {
    gameflow_phase: String,
    live_client_data_available: bool,
    live_client_data_status: Option<u16>,
    error_message: Option<String>,
}

#[tauri::command]
#[allow(clippy::significant_drop_tightening)]
async fn get_diagnostics(state: State<'_, AppState>) -> Result<DiagnosticInfo, String> {
    let lcu_guard = state.lcu_connection.lock().await;
    let lcu = lcu_guard.as_ref().ok_or("LCU not connected")?;

    let phase_response = lcu.get("/lol-gameflow/v1/gameflow-phase").await;
    let gameflow_phase = match phase_response {
        Ok(resp) if resp.status().is_success() => resp
            .text()
            .await
            .unwrap_or_else(|_| "unknown".to_string())
            .trim_matches('"')
            .to_string(),
        _ => "unknown".to_string(),
    };

    let live_client_response = lcu.get("/liveclientdata/allgamedata").await;
    let (live_client_data_available, live_client_data_status) = match live_client_response {
        Ok(resp) => (resp.status().is_success(), Some(resp.status().as_u16())),
        Err(e) => {
            return Ok(DiagnosticInfo {
                gameflow_phase,
                live_client_data_available: false,
                live_client_data_status: None,
                error_message: Some(format!("Failed to reach endpoint: {e}")),
            });
        }
    };

    Ok(DiagnosticInfo {
        gameflow_phase,
        live_client_data_available,
        live_client_data_status,
        error_message: None,
    })
}

/// Champion info returned to the frontend
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ChampionInfo {
    id: String,
    name: String,
}

/// Local player info returned to the frontend
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalPlayerInfo {
    summoner_name: String,
    champion_name: Option<String>,
    team: Option<String>,
}

#[tauri::command]
async fn get_local_player() -> Result<Option<LocalPlayerInfo>, String> {
    let client = live_client::LiveClientConnection::new();

    match client.get_active_player().await {
        Ok(player) => {
            let player_list = client.get_player_list().await.ok();
            let player_info = player_list.as_ref().and_then(|list| {
                list.iter()
                    .find(|p| p.summoner_name == player.summoner_name)
            });

            Ok(Some(LocalPlayerInfo {
                summoner_name: player.summoner_name,
                champion_name: player_info.map(|p| p.champion_name.clone()),
                team: player_info.map(|p| p.team.clone()),
            }))
        }
        Err(_) => Ok(None),
    }
}

// =============================================================================
// Main Application
// =============================================================================

#[allow(clippy::expect_used, clippy::large_stack_frames)]
fn main() {
    // Initialize paths early
    paths::early_init();
    paths::ensure_directories();
    paths::migrate_from_legacy();
    paths::migrate_from_roaming();

    append_startup_log("starting main()");
    std::panic::set_hook(Box::new(|info| {
        append_startup_log(&format!("panic: {info}"));
    }));

    append_startup_log("tracing skipped (using log plugin)");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                        path: paths::logs_dir(),
                        file_name: Some("scout".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .level(log::LevelFilter::Debug)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            // LCU commands
            get_lcu_status,
            connect_lcu,
            disconnect_lcu,
            // Backend commands
            configure_backend,
            get_backend_status,
            test_backend_connection,
            // Monitoring commands
            start_monitoring,
            stop_monitoring,
            get_monitoring_status,
            // Config commands
            load_config,
            save_config,
            // Utility commands
            get_diagnostics,
            get_log_paths,
            get_local_player,
        ])
        .setup(|app| {
            append_startup_log("tauri setup()");

            let tauri_app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");
            paths::init(&tauri_app_data_dir);

            append_startup_log(&format!(
                "tauri app data dir: {}",
                tauri_app_data_dir.display()
            ));
            append_startup_log(&format!(
                "actual app data dir: {}",
                paths::app_data_dir().display()
            ));

            info!("Scout for LoL Desktop starting up...");
            info!("App data directory: {}", paths::app_data_dir().display());
            info!("Config path: {}", paths::config_file().display());
            info!("Logs directory: {}", paths::logs_dir().display());

            // Load existing config and initialize backend client if configured
            let cfg = config::Config::load(&paths::config_file());
            let backend_client =
                if let (Some(token), Some(url)) = (&cfg.api_token, &cfg.backend_url) {
                    Some(BackendClient::new(
                        token.clone(),
                        url.clone(),
                        cfg.client_id.clone(),
                    ))
                } else {
                    None
                };

            let app_state = AppState {
                lcu_connection: Arc::new(Mutex::new(None)),
                backend_client: Arc::new(Mutex::new(backend_client)),
                is_monitoring: Arc::new(Mutex::new(false)),
            };

            app.manage(app_state);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
