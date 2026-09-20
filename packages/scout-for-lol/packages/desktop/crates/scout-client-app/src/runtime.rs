//! Background League observation, pairing, and upload runtime.

use std::collections::{HashMap, HashSet};
use std::io::Read as _;
use std::path::Path;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use directories::ProjectDirs;
use scout_client_core::backend::ScoutBackendClient;
use scout_client_core::credentials::DeviceCredential;
use scout_client_core::lcu::{LcuClient, LcuEndpoint, LiveClient, discover_lockfile};
use scout_client_core::outbox::ObservationOutbox;
use scout_client_core::protocol::{
    CreatePairingRequest, ExchangePairingResponse, ObservationBatch, ObservationEnvelope,
    ObservationKind,
};
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use tokio::runtime::Runtime;
use tokio::sync::{mpsc, watch};
use tracing::{error, info};
use uuid::Uuid;

use crate::startup;

/// Snapshot rendered by egui. It contains no bearer, LCU credential, PUUID, or raw payload.
#[derive(Debug, Clone, Default)]
pub struct RuntimeState {
    /// Whether a League lockfile is currently reachable.
    pub league_connected: bool,
    /// Current gameflow phase.
    pub gameflow_phase: Option<String>,
    /// Redacted current account label.
    pub account_label: Option<String>,
    /// Whether the device has a credential in the OS store.
    pub paired: bool,
    /// Whether Scout Client is registered to start for the current user.
    pub start_at_login: bool,
    /// Human-readable pairing state.
    pub pairing_status: Option<String>,
    /// Browser approval URL while pairing is pending.
    pub approval_url: Option<String>,
    /// Pending durable observations.
    pub pending_observations: usize,
    /// Last successful upload time.
    pub last_upload_at: Option<String>,
    /// Last typed boundary error.
    pub last_error: Option<String>,
}

enum RuntimeCommand {
    StartPairing,
    Disconnect,
    SetStartAtLogin(bool),
}

struct PendingPairing {
    id: Uuid,
    secret: String,
}

/// Handle owned by the egui application.
pub struct ClientRuntime {
    /// Latest immutable UI snapshot.
    pub state: Arc<RwLock<RuntimeState>>,
    commands: mpsc::UnboundedSender<RuntimeCommand>,
    shutdown: watch::Sender<bool>,
    _thread: std::thread::JoinHandle<()>,
}

impl ClientRuntime {
    /// Spawn the async collector on a dedicated thread.
    #[must_use]
    pub fn start(backend_origin: String) -> Self {
        let state = Arc::new(RwLock::new(RuntimeState::default()));
        let (shutdown, shutdown_receiver) = watch::channel(false);
        let (commands, command_receiver) = mpsc::unbounded_channel();
        let worker_state = Arc::clone(&state);
        let thread = std::thread::spawn(move || {
            let runtime = match Runtime::new() {
                Ok(runtime) => runtime,
                Err(error) => {
                    set_error(
                        &worker_state,
                        format!("Could not start background runtime: {error}"),
                    );
                    return;
                }
            };
            runtime.block_on(run_collector(
                worker_state,
                shutdown_receiver,
                command_receiver,
                backend_origin,
            ));
        });
        Self {
            state,
            commands,
            shutdown,
            _thread: thread,
        }
    }

    /// Begin a new browser pairing request.
    pub fn start_pairing(&self) {
        if self.commands.send(RuntimeCommand::StartPairing).is_err() {
            info!("Scout Client collector had already stopped");
        }
    }

    /// Delete the local credential and stop uploading until re-paired.
    pub fn disconnect(&self) {
        if self.commands.send(RuntimeCommand::Disconnect).is_err() {
            info!("Scout Client collector had already stopped");
        }
    }

    /// Change the current-user start-at-login registration.
    pub fn set_start_at_login(&self, enabled: bool) {
        if self
            .commands
            .send(RuntimeCommand::SetStartAtLogin(enabled))
            .is_err()
        {
            info!("Scout Client collector had already stopped");
        }
    }

    /// Request graceful background shutdown.
    pub fn shutdown(&self) {
        if self.shutdown.send(true).is_err() {
            info!("Scout Client collector had already stopped");
        }
    }
}

async fn run_collector(
    state: Arc<RwLock<RuntimeState>>,
    mut shutdown: watch::Receiver<bool>,
    mut commands: mpsc::UnboundedReceiver<RuntimeCommand>,
    backend_origin: String,
) {
    let backend = match ScoutBackendClient::new(&backend_origin) {
        Ok(backend) => backend,
        Err(error) => {
            set_error(&state, error.to_string());
            return;
        }
    };
    let outbox = match ObservationOutbox::open(outbox_path()) {
        Ok(outbox) => outbox,
        Err(error) => {
            set_error(&state, format!("Could not open durable outbox: {error}"));
            return;
        }
    };
    let mut credential = match DeviceCredential::load() {
        Ok(value) => value,
        Err(error) => {
            set_error(&state, error.to_string());
            None
        }
    };
    update_state(&state, |snapshot| snapshot.paired = credential.is_some());
    match startup::is_enabled() {
        Ok(enabled) => update_state(&state, |snapshot| snapshot.start_at_login = enabled),
        Err(error) => set_error(
            &state,
            format!("Could not read start-at-login setting: {error}"),
        ),
    }
    let mut pending_pairing: Option<PendingPairing> = None;
    let mut payloads = HashMap::new();
    let live_client = create_live_client(&state);
    let mut tick_number = 0_u64;
    let mut ticker = tokio::time::interval(Duration::from_secs(2));

    loop {
        tokio::select! {
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() {
                    return;
                }
            }
            command = commands.recv() => {
                if let Some(command) = command {
                    handle_command(
                        command,
                        &state,
                        &backend,
                        &mut credential,
                        &mut pending_pairing,
                    ).await;
                }
            }
            _ = ticker.tick() => {
                tick_number = tick_number.saturating_add(1);
                if let Err(error) = poll_pairing(
                    &state,
                    &backend,
                    &mut credential,
                    &mut pending_pairing,
                ).await {
                    set_error(&state, error);
                }
                if let Err(error) = collect_once(
                    &state,
                    &outbox,
                    &mut payloads,
                    live_client.as_ref(),
                    tick_number,
                ).await {
                    set_error(&state, error);
                }
                if let Some(active_credential) = &credential
                    && let Err(error) = upload_pending(
                        &state,
                        &backend,
                        &outbox,
                        active_credential,
                    ).await
                {
                    set_error(&state, error);
                }
                if tick_number % 15 == 1
                    && let Some(active_credential) = &credential
                    && let Err(error) = upload_new_replays(
                        &backend,
                        &outbox,
                        active_credential,
                    ).await
                {
                    set_error(&state, error);
                }
            }
        }
    }
}

fn create_live_client(state: &Arc<RwLock<RuntimeState>>) -> Option<LiveClient> {
    match LiveClient::new() {
        Ok(client) => Some(client),
        Err(error) => {
            set_error(state, error.to_string());
            None
        }
    }
}

async fn upload_new_replays(
    backend: &ScoutBackendClient,
    outbox: &ObservationOutbox,
    credential: &DeviceCredential,
) -> Result<(), String> {
    let (_, lockfile) = discover_lockfile().map_err(|error| error.to_string())?;
    let client = LcuClient::new(&lockfile).map_err(|error| error.to_string())?;
    let replay_path = client
        .get(LcuEndpoint::ReplayPath)
        .await
        .map_err(|error| error.to_string())?
        .and_then(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .or_else(|| value.get("path")?.as_str().map(str::to_owned))
        });
    let Some(replay_path) = replay_path else {
        return Ok(());
    };
    for entry in std::fs::read_dir(replay_path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("rofl") {
            continue;
        }
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if metadata.len() == 0 || metadata.len() > 512 * 1024 * 1024 {
            continue;
        }
        let is_stable = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age >= Duration::from_secs(30));
        if !is_stable {
            continue;
        }
        let Some(game_id) = replay_game_id(&path) else {
            continue;
        };
        let digest = replay_sha256(path.clone()).await?;
        if outbox
            .replay_uploaded(&digest)
            .map_err(|error| error.to_string())?
        {
            continue;
        }
        backend
            .upload_replay(credential, &game_id, &digest, &path)
            .await
            .map_err(|error| error.to_string())?;
        outbox
            .mark_replay_uploaded(&digest, &game_id)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn replay_game_id(path: &Path) -> Option<String> {
    path.file_stem()?
        .to_str()?
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| part.len() >= 5)
        .max_by_key(|part| part.len())
        .map(str::to_owned)
}

async fn replay_sha256(path: PathBuf) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let mut file = std::fs::File::open(path).map_err(|error| error.to_string())?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
        loop {
            let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
        Ok(format!("{:x}", hasher.finalize()))
    })
    .await
    .map_err(|error| format!("Replay hashing task failed: {error}"))?
}

async fn handle_command(
    command: RuntimeCommand,
    state: &Arc<RwLock<RuntimeState>>,
    backend: &ScoutBackendClient,
    credential: &mut Option<DeviceCredential>,
    pending_pairing: &mut Option<PendingPairing>,
) {
    match command {
        RuntimeCommand::StartPairing => {
            let request = CreatePairingRequest {
                device_name: format!("{} Scout Client", std::env::consts::OS),
                platform: std::env::consts::OS.to_owned(),
                architecture: std::env::consts::ARCH.to_owned(),
                app_version: env!("CARGO_PKG_VERSION").to_owned(),
                protocol_version: scout_client_core::protocol::PROTOCOL_VERSION,
            };
            match backend.create_pairing(&request).await {
                Ok(pairing) => {
                    let url = pairing.approval_url.clone();
                    *pending_pairing = Some(PendingPairing {
                        id: pairing.pairing_id,
                        secret: pairing.pairing_secret,
                    });
                    update_state(state, |snapshot| {
                        snapshot.pairing_status = Some("Waiting for browser approval".to_owned());
                        snapshot.approval_url = Some(url.clone());
                        snapshot.last_error = None;
                    });
                    if let Err(error) = open::that(&url) {
                        set_error(state, format!("Could not open approval page: {error}"));
                    }
                }
                Err(error) => set_error(state, error.to_string()),
            }
        }
        RuntimeCommand::Disconnect => match DeviceCredential::delete() {
            Ok(()) => {
                *credential = None;
                *pending_pairing = None;
                update_state(state, |snapshot| {
                    snapshot.paired = false;
                    snapshot.pairing_status = Some("Disconnected".to_owned());
                    snapshot.approval_url = None;
                    snapshot.last_error = None;
                });
            }
            Err(error) => set_error(state, error.to_string()),
        },
        RuntimeCommand::SetStartAtLogin(enabled) => match startup::set_enabled(enabled) {
            Ok(()) => update_state(state, |snapshot| {
                snapshot.start_at_login = enabled;
                snapshot.last_error = None;
            }),
            Err(error) => set_error(state, format!("Could not change start-at-login: {error}")),
        },
    }
}

async fn poll_pairing(
    state: &Arc<RwLock<RuntimeState>>,
    backend: &ScoutBackendClient,
    credential: &mut Option<DeviceCredential>,
    pending_pairing: &mut Option<PendingPairing>,
) -> Result<(), String> {
    let Some(pairing) = pending_pairing else {
        return Ok(());
    };
    match backend
        .exchange_pairing(pairing.id, &pairing.secret)
        .await
        .map_err(|error| error.to_string())?
    {
        ExchangePairingResponse::Pending => Ok(()),
        ExchangePairingResponse::Approved { device_id, token } => {
            let issued = DeviceCredential { device_id, token };
            issued.save().map_err(|error| error.to_string())?;
            *credential = Some(issued);
            *pending_pairing = None;
            update_state(state, |snapshot| {
                snapshot.paired = true;
                snapshot.pairing_status = Some("Paired".to_owned());
                snapshot.approval_url = None;
                snapshot.last_error = None;
            });
            Ok(())
        }
        ExchangePairingResponse::Expired | ExchangePairingResponse::Consumed => {
            *pending_pairing = None;
            update_state(state, |snapshot| {
                snapshot.pairing_status = Some("Pairing expired; start again".to_owned());
                snapshot.approval_url = None;
            });
            Ok(())
        }
    }
}

async fn upload_pending(
    state: &Arc<RwLock<RuntimeState>>,
    backend: &ScoutBackendClient,
    outbox: &ObservationOutbox,
    credential: &DeviceCredential,
) -> Result<(), String> {
    let pending = outbox.pending(100).map_err(|error| error.to_string())?;
    if pending.is_empty() {
        return Ok(());
    }
    let observations = pending
        .iter()
        .map(|row| serde_json::from_slice::<ObservationEnvelope>(&row.body))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not decode durable observation: {error}"))?;
    let receipt = backend
        .upload_observations(credential, &ObservationBatch { observations })
        .await
        .map_err(|error| error.to_string())?;
    let submitted: HashSet<Uuid> = pending.iter().map(|row| row.observation_id).collect();
    for item in receipt.receipts {
        if submitted.contains(&item.observation_id) {
            outbox
                .acknowledge(item.observation_id)
                .map_err(|error| error.to_string())?;
        }
    }
    let remaining = outbox.pending(100).map_err(|error| error.to_string())?;
    update_state(state, |snapshot| {
        snapshot.pending_observations = remaining.len();
        snapshot.last_upload_at = Some(chrono::Utc::now().to_rfc3339());
        snapshot.last_error = None;
    });
    Ok(())
}

async fn collect_once(
    state: &Arc<RwLock<RuntimeState>>,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    live_client: Option<&LiveClient>,
    tick_number: u64,
) -> Result<(), String> {
    let Ok((_, lockfile)) = discover_lockfile() else {
        update_state(state, |snapshot| {
            snapshot.league_connected = false;
            snapshot.gameflow_phase = None;
            snapshot.account_label = None;
            snapshot.pending_observations = outbox.pending(100).map_or(0, |pending| pending.len());
        });
        return Ok(());
    };
    let client = LcuClient::new(&lockfile).map_err(|error| error.to_string())?;
    let account = client
        .get(LcuEndpoint::CurrentSummoner)
        .await
        .map_err(|error| error.to_string())?;
    let local_puuid = account
        .as_ref()
        .and_then(|value| value.get("puuid"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    let account_label = account.as_ref().and_then(|value| {
        let game_name = value.get("gameName")?.as_str()?;
        let tag_line = value.get("tagLine")?.as_str()?;
        Some(format!("{game_name}#{tag_line}"))
    });

    if let Some(payload) = account {
        enqueue_if_changed(
            outbox,
            payloads,
            "account_profile",
            ObservationKind::AccountProfile,
            &payload,
            local_puuid.as_deref(),
        )?;
    }

    let phase = observe_endpoint(
        &client,
        outbox,
        payloads,
        LcuEndpoint::GameflowPhase,
        "gameflow_phase",
        ObservationKind::Gameflow,
        local_puuid.as_deref(),
    )
    .await?;
    for (endpoint, key, kind) in [
        (
            LcuEndpoint::GameflowSession,
            "gameflow_session",
            ObservationKind::Gameflow,
        ),
        (LcuEndpoint::Lobby, "lobby", ObservationKind::Lobby),
        (
            LcuEndpoint::ChampSelect,
            "champ_select",
            ObservationKind::ChampSelect,
        ),
        (
            LcuEndpoint::EndOfGame,
            "post_game",
            ObservationKind::PostGame,
        ),
    ] {
        observe_endpoint(
            &client,
            outbox,
            payloads,
            endpoint,
            key,
            kind,
            local_puuid.as_deref(),
        )
        .await?;
    }

    collect_live_frame(live_client, outbox, payloads, local_puuid.as_deref()).await?;

    if tick_number % 15 == 1 {
        collect_profile_snapshots(&client, outbox, payloads, local_puuid.as_deref()).await?;
        collect_recent_matches(&client, outbox, payloads, local_puuid.as_deref()).await?;
    }

    let phase_label = phase
        .as_ref()
        .and_then(Value::as_str)
        .unwrap_or("None")
        .to_owned();
    let pending = outbox.pending(100).map_err(|error| error.to_string())?;
    update_state(state, |snapshot| {
        snapshot.league_connected = true;
        snapshot.gameflow_phase = Some(phase_label);
        snapshot.account_label = account_label;
        snapshot.pending_observations = pending.len();
        snapshot.last_error = None;
    });
    Ok(())
}

async fn collect_live_frame(
    live_client: Option<&LiveClient>,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    local_puuid: Option<&str>,
) -> Result<(), String> {
    let Some(live_client) = live_client else {
        return Ok(());
    };
    if let Some(payload) = live_client
        .all_game_data()
        .await
        .map_err(|error| error.to_string())?
    {
        enqueue_if_changed(
            outbox,
            payloads,
            "live_game_frame",
            ObservationKind::LiveGameFrame,
            &payload,
            local_puuid,
        )?;
    } else {
        payloads.remove("live_game_frame");
    }
    Ok(())
}

async fn collect_profile_snapshots(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    local_puuid: Option<&str>,
) -> Result<(), String> {
    for (endpoint, key, kind) in [
        (
            LcuEndpoint::ChampionMastery,
            "champion_mastery",
            ObservationKind::ChampionMastery,
        ),
        (
            LcuEndpoint::ChampionMasteryMilestones,
            "champion_mastery_milestones",
            ObservationKind::ChampionMastery,
        ),
        (
            LcuEndpoint::Challenges,
            "challenges",
            ObservationKind::Challenges,
        ),
        (
            LcuEndpoint::ChallengeSummary,
            "challenge_summary",
            ObservationKind::Challenges,
        ),
        (
            LcuEndpoint::ClashPlayer,
            "clash_player",
            ObservationKind::Clash,
        ),
        (
            LcuEndpoint::ClashTournaments,
            "clash_tournaments",
            ObservationKind::Clash,
        ),
        (
            LcuEndpoint::ClashSummary,
            "clash_summary",
            ObservationKind::Clash,
        ),
        (
            LcuEndpoint::ClashCheckinAllowed,
            "clash_checkin_allowed",
            ObservationKind::Clash,
        ),
        (
            LcuEndpoint::ClashCurrentTournamentIds,
            "clash_current_tournament_ids",
            ObservationKind::Clash,
        ),
        (
            LcuEndpoint::ClashHistoryAndWinners,
            "clash_history_and_winners",
            ObservationKind::Clash,
        ),
        (
            LcuEndpoint::ClashPlayerHistory,
            "clash_player_history",
            ObservationKind::Clash,
        ),
        (
            LcuEndpoint::ClashRewards,
            "clash_rewards",
            ObservationKind::Clash,
        ),
        (
            LcuEndpoint::ClashStateFlags,
            "clash_state_flags",
            ObservationKind::Clash,
        ),
        (
            LcuEndpoint::ClashTournamentState,
            "clash_tournament_state",
            ObservationKind::Clash,
        ),
        (
            LcuEndpoint::ClashInvitedRosters,
            "clash_invited_rosters",
            ObservationKind::Clash,
        ),
    ] {
        observe_endpoint(client, outbox, payloads, endpoint, key, kind, local_puuid).await?;
    }
    Ok(())
}

async fn collect_recent_matches(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    local_puuid: Option<&str>,
) -> Result<(), String> {
    let Some(history) = client
        .get(LcuEndpoint::MatchHistoryRecent)
        .await
        .map_err(|error| error.to_string())?
    else {
        return Ok(());
    };
    let Some(games) = history
        .get("games")
        .and_then(|value| value.get("games"))
        .and_then(Value::as_array)
    else {
        return Ok(());
    };
    for game in games {
        let Some(game_id) = find_string(game, &["gameId"]) else {
            continue;
        };
        let key = format!("match_history_game:{game_id}");
        enqueue_if_changed(
            outbox,
            payloads,
            &key,
            ObservationKind::PostGame,
            game,
            local_puuid,
        )?;
    }
    Ok(())
}

async fn observe_endpoint(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    endpoint: LcuEndpoint,
    key: &'static str,
    kind: ObservationKind,
    local_puuid: Option<&str>,
) -> Result<Option<Value>, String> {
    let payload = client
        .get(endpoint)
        .await
        .map_err(|error| error.to_string())?;
    if let Some(value) = &payload {
        enqueue_if_changed(outbox, payloads, key, kind, value, local_puuid)?;
    } else {
        payloads.remove(key);
    }
    Ok(payload)
}

fn enqueue_if_changed(
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    key: &str,
    kind: ObservationKind,
    payload: &Value,
    local_puuid: Option<&str>,
) -> Result<(), String> {
    let body = serde_json::to_vec(&payload).map_err(|error| error.to_string())?;
    if payloads.get(key) == Some(&body) {
        return Ok(());
    }
    let sequence = outbox.next_sequence().map_err(|error| error.to_string())?;
    let mut observation = ObservationEnvelope::new(
        sequence,
        kind,
        env!("CARGO_PKG_VERSION"),
        serde_json::json!({ "resource": key, "data": payload }),
    )
    .map_err(|error| error.to_string())?;
    observation.local_puuid = local_puuid.map(str::to_owned);
    observation.game_id = find_string(&observation.payload, &["gameId"]);
    observation.lobby_id = find_string(&observation.payload, &["lobbyId", "partyId"]);
    observation.platform_id = find_string(&observation.payload, &["platformId"]);
    observation.league_patch = find_string(&observation.payload, &["gameVersion"]);
    observation.validate().map_err(|error| error.to_string())?;
    outbox
        .enqueue(&observation)
        .map_err(|error| error.to_string())?;
    payloads.insert(key.to_owned(), body);
    Ok(())
}

fn find_string(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(object) => {
            for key in keys {
                if let Some(candidate) = object.get(*key) {
                    if let Some(value) = candidate.as_str() {
                        return Some(value.to_owned());
                    }
                    if let Some(value) = candidate.as_u64() {
                        return Some(value.to_string());
                    }
                }
            }
            object.values().find_map(|item| find_string(item, keys))
        }
        Value::Array(items) => items.iter().find_map(|item| find_string(item, keys)),
        _ => None,
    }
}

fn outbox_path() -> PathBuf {
    if let Some(project) = ProjectDirs::from("com", "Scout", "Scout Client") {
        let directory = project.data_local_dir();
        if let Err(error) = std::fs::create_dir_all(directory) {
            error!(%error, "could not create Scout Client data directory");
        }
        return directory.join("outbox.db");
    }
    std::env::temp_dir().join("scout-client-outbox.db")
}

fn set_error(state: &Arc<RwLock<RuntimeState>>, message: String) {
    update_state(state, |snapshot| snapshot.last_error = Some(message));
}

fn update_state(state: &Arc<RwLock<RuntimeState>>, update: impl FnOnce(&mut RuntimeState)) {
    match state.write() {
        Ok(mut snapshot) => update(&mut snapshot),
        Err(error) => error!(%error, "Scout Client UI state lock was poisoned"),
    }
}
