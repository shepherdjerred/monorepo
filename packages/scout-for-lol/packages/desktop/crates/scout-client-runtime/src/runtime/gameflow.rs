//! One gameflow collection pass and the lobby binding it carries.

use scout_client_core::diagnostics::DiagnosticCategory;
use scout_client_core::diagnostics::DiagnosticEvent;
use scout_client_core::diagnostics::DiagnosticLevel;
use scout_client_core::diagnostics::DiagnosticOutcome;
use scout_client_core::diagnostics::Diagnostics;
use scout_client_core::lcu::LcuClient;
use scout_client_core::lcu::LcuEndpoint;
use scout_client_core::lcu::LcuError;
use scout_client_core::lcu::LeagueLockfile;
use scout_client_core::lcu::LiveClient;
use scout_client_core::lcu::discover_lockfile;
use scout_client_core::outbox::LobbyBinding;
use scout_client_core::outbox::ObservationOutbox;
use scout_client_core::protocol::ObservationKind;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use super::observe::{
    END_OF_GAME_SLOT, GAME_CLIENT_END_OF_GAME_SLOT, ObservationSlot, create_observation,
    enqueue_coalesced_snapshot, enqueue_if_changed, find_string, observe_endpoint,
};
use super::replay::report_replay_inventory;
use super::state::{StateHub, clear_runtime_error, update_state};

pub(super) fn optional_lockfile(
    discovered: Result<(PathBuf, LeagueLockfile), LcuError>,
) -> Result<Option<LeagueLockfile>, String> {
    match discovered {
        Ok((_, lockfile)) => Ok(Some(lockfile)),
        Err(LcuError::NotRunning) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub(super) async fn collect_once(
    state: &StateHub,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    live_client: Option<&LiveClient>,
    tick_number: u64,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    let Some(lockfile) = optional_lockfile(discover_lockfile())? else {
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

    let Some(local_puuid) = local_puuid else {
        let pending = outbox.pending(100).map_err(|error| error.to_string())?;
        update_state(state, |snapshot| {
            snapshot.league_connected = true;
            snapshot.gameflow_phase = None;
            snapshot.account_label = account_label;
            snapshot.pending_observations = pending.len();
            clear_runtime_error(snapshot);
        });
        return Ok(());
    };

    if payloads.get("observer").map(Vec::as_slice) != Some(local_puuid.as_bytes()) {
        payloads.clear();
        payloads.insert("observer".to_owned(), local_puuid.as_bytes().to_vec());
    }

    if let Some(payload) = account {
        enqueue_if_changed(
            outbox,
            payloads,
            "account_profile",
            ObservationKind::AccountProfile,
            &payload,
            Some(&local_puuid),
            diagnostics,
        )?;
    }

    // A live roster is also a heartbeat. Server-side freshness must not depend
    // on somebody changing a field after the loading screen.
    if tick_number % 15 == 1 {
        payloads.remove("gameflow_session");
    }
    let phase = observe_endpoint(
        &client,
        outbox,
        payloads,
        LcuEndpoint::GameflowPhase,
        ObservationSlot::named("gameflow_phase", ObservationKind::Gameflow),
        Some(&local_puuid),
        diagnostics,
    )
    .await?;
    collect_match_state(
        &client,
        outbox,
        payloads,
        Some(&local_puuid),
        tick_number,
        diagnostics,
    )
    .await?;

    collect_live_frame(live_client, outbox, payloads, Some(&local_puuid)).await?;
    bind_observed_lobby(outbox, payloads, Some(&local_puuid), diagnostics)?;
    remember_game_start(outbox, payloads, &local_puuid)?;

    if tick_number % 15 == 1 {
        // Preserve the post-game bundle before querying optional profile
        // surfaces: one unavailable mastery, Challenge, or Clash endpoint must
        // not let a Riot-invisible match age out of recent history.
        report_replay_inventory(outbox, payloads, Some(&local_puuid), diagnostics)?;
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
        clear_runtime_error(snapshot);
    });
    Ok(())
}

pub(super) async fn collect_match_state(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    local_puuid: Option<&str>,
    tick_number: u64,
    diagnostics: &Diagnostics,
) -> Result<Option<Value>, String> {
    for (endpoint, key, kind) in [
        (
            LcuEndpoint::GameflowSession,
            "gameflow_session",
            ObservationKind::Gameflow,
        ),
        (
            LcuEndpoint::ChampSelect,
            "champ_select",
            ObservationKind::ChampSelect,
        ),
    ] {
        observe_endpoint(
            client,
            outbox,
            payloads,
            endpoint,
            ObservationSlot::named(key, kind),
            local_puuid,
            diagnostics,
        )
        .await?;
    }
    let previous_lobby = payloads.get("lobby").cloned();
    let lobby = observe_endpoint(
        client,
        outbox,
        payloads,
        LcuEndpoint::Lobby,
        ObservationSlot::named("lobby", ObservationKind::Lobby),
        local_puuid,
        diagnostics,
    )
    .await?;
    if let Some(lobby) = &lobby {
        let body = serde_json::to_vec(lobby).map_err(|error| error.to_string())?;
        if should_refresh_lobby(previous_lobby.as_deref(), &body, tick_number) {
            enqueue_coalesced_snapshot(
                outbox,
                "lobby_refresh",
                "lobby",
                ObservationKind::Lobby,
                lobby,
                local_puuid,
                diagnostics,
            )?;
        }
    }
    let end_of_game = observe_endpoint(
        client,
        outbox,
        payloads,
        LcuEndpoint::EndOfGame,
        END_OF_GAME_SLOT,
        local_puuid,
        diagnostics,
    )
    .await?;
    if let Some(payload) = &end_of_game {
        remember_end_of_game(outbox, payload, local_puuid)?;
        return Ok(end_of_game);
    }
    let end_of_game = observe_endpoint(
        client,
        outbox,
        payloads,
        LcuEndpoint::GameClientEndOfGame,
        GAME_CLIENT_END_OF_GAME_SLOT,
        local_puuid,
        diagnostics,
    )
    .await?;
    if let Some(payload) = &end_of_game {
        remember_end_of_game(outbox, payload, local_puuid)?;
    }
    Ok(end_of_game)
}

pub(super) fn remember_end_of_game(
    outbox: &ObservationOutbox,
    payload: &Value,
    observer: Option<&str>,
) -> Result<(), String> {
    let Some(observer) = observer else {
        return Ok(());
    };
    let Some(game_id) = find_string(payload, &["gameId", "reportGameId"]) else {
        return Ok(());
    };
    let body = serde_json::to_vec(&scout_client_core::protocol::without_credentials(
        payload.clone(),
    ))
    .map_err(|error| error.to_string())?;
    outbox
        .remember_game_end(observer, &game_id, chrono::Utc::now().timestamp_millis())
        .map_err(|error| error.to_string())?;
    outbox
        .remember_end_of_game(observer, &game_id, &body)
        .map_err(|error| error.to_string())
}

/// Record the lobby-to-game join that only this client is in a position to see.
///
/// LCU answers `partyId` on the lobby and a real `gameId` only once the game is
/// in progress, and the in-progress session carries no lobby identity at all —
/// a live capture across all four phases found no field shared between them.
/// So nothing downstream can reconstruct which lobby a game came from, and the
/// lobby is where the full roster lives: bots, custom teams, everyone Riot's
/// spectator API will not report. Remembering the lobby while it is visible and
/// claiming it when a game starts is what lets the server attach that roster to
/// a real match.
///
/// Both sides are durable, so this survives a client restart between champion
/// select and the game.
pub(super) fn bind_observed_lobby(
    outbox: &ObservationOutbox,
    payloads: &HashMap<String, Vec<u8>>,
    local_puuid: Option<&str>,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    let observed_at_millis = chrono::Utc::now().timestamp_millis();
    let Some(observer) = local_puuid else {
        return Ok(());
    };
    remember_current_lobby(outbox, payloads, observer, observed_at_millis)?;
    let Some(session) = payloads.get("gameflow_session") else {
        return Ok(());
    };
    let session = serde_json::from_slice::<Value>(session).map_err(|error| error.to_string())?;
    if find_string(&session, &["phase"]).as_deref() != Some("InProgress") {
        return Ok(());
    }
    let Some(game_id) = find_string(&session, &["gameId"]) else {
        return Ok(());
    };
    // League reports `gameId: 0` for "no game", and the phase can flip before
    // `gameData` is filled in. Binding that would spend this game's one
    // recorded outcome on a placeholder.
    if game_id == "0" {
        return Ok(());
    }
    // `InProgress` is read on every tick for the length of a match. The outbox
    // records one outcome per game so this reports the decision exactly once,
    // rather than repeating it a few hundred times and burying the rest.
    let (outcome, detail) = match outbox
        .bind_game_to_lobby(observer, &game_id, observed_at_millis)
        .map_err(|error| error.to_string())?
    {
        LobbyBinding::AlreadyRecorded => return Ok(()),
        LobbyBinding::Bound(_) => {
            // The in-game session was enqueued earlier this tick, before the
            // join existed, and an unchanged session is never sent again. Send
            // it once more now that `create_observation` can stamp it, or the
            // server would not learn the game's lobby until post-game — after
            // prematch needed it. Keyed per game so an offline client cannot
            // coalesce one game's join away under the next one's.
            enqueue_coalesced_snapshot(
                outbox,
                &format!("lobby_binding:{game_id}"),
                "gameflow_session",
                ObservationKind::Gameflow,
                &session,
                local_puuid,
                diagnostics,
            )?;
            diagnostics.counters().lobby_bound();
            (DiagnosticOutcome::Succeeded, "bound to the observed lobby")
        }
        LobbyBinding::Unwitnessed => (
            DiagnosticOutcome::Skipped,
            "no lobby was observed for this game",
        ),
    };
    diagnostics.record(
        DiagnosticEvent::new(
            DiagnosticLevel::Info,
            DiagnosticCategory::Protocol,
            "bind_lobby",
            outcome,
        )
        // The lobby and game ids are deliberately absent: a diagnostic carries
        // the shape of what happened, never an identity.
        .with_detail(detail),
    );
    Ok(())
}

/// Keep the lobby the player is in, so the next game to start can claim it.
pub(super) fn remember_current_lobby(
    outbox: &ObservationOutbox,
    payloads: &HashMap<String, Vec<u8>>,
    observer: &str,
    observed_at_millis: i64,
) -> Result<(), String> {
    let Some(lobby) = payloads.get("lobby") else {
        return Ok(());
    };
    let lobby = serde_json::from_slice::<Value>(lobby).map_err(|error| error.to_string())?;
    let Some(lobby_id) = find_string(&lobby, &["partyId", "lobbyId"]) else {
        return Ok(());
    };
    outbox
        .remember_observed_lobby(observer, &lobby_id, observed_at_millis)
        .map_err(|error| error.to_string())
}

pub(super) fn remember_game_start(
    outbox: &ObservationOutbox,
    payloads: &HashMap<String, Vec<u8>>,
    observer: &str,
) -> Result<(), String> {
    let (Some(session), Some(frame)) = (
        payloads.get("gameflow_session"),
        payloads.get("live_game_frame"),
    ) else {
        return Ok(());
    };
    let session = serde_json::from_slice::<Value>(session).map_err(|error| error.to_string())?;
    let frame = serde_json::from_slice::<Value>(frame).map_err(|error| error.to_string())?;
    let Some((game_id, started_at_millis)) =
        game_start_evidence(&session, &frame, chrono::Utc::now().timestamp_millis())
    else {
        return Ok(());
    };
    outbox
        .remember_game_start(observer, &game_id, started_at_millis)
        .map_err(|error| error.to_string())
}

pub(super) fn game_start_evidence(
    session: &Value,
    frame: &Value,
    observed_at_millis: i64,
) -> Option<(String, i64)> {
    if find_string(session, &["phase"]).as_deref() != Some("InProgress") {
        return None;
    }
    let game_id = find_string(session, &["gameId"])?;
    let game_time = frame.get("gameData")?.get("gameTime")?.as_f64()?;
    if !game_time.is_finite() || !(0.0..=86_400.0).contains(&game_time) {
        return None;
    }
    let elapsed = Duration::try_from_secs_f64(game_time).ok()?;
    let elapsed_millis = i64::try_from(elapsed.as_millis()).ok()?;
    let started_at_millis = observed_at_millis.checked_sub(elapsed_millis)?;
    (started_at_millis > 0).then_some((game_id, started_at_millis))
}

pub(super) fn should_refresh_lobby(
    previous: Option<&[u8]>,
    current: &[u8],
    tick_number: u64,
) -> bool {
    tick_number % 15 == 1 && previous == Some(current)
}

pub(super) async fn collect_live_frame(
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
        let body = serde_json::to_vec(&payload).map_err(|error| error.to_string())?;
        if should_emit_live_game_frame(payloads.get("live_game_frame").map(Vec::as_slice)) {
            let observation = create_observation(
                outbox,
                "live_game_frame",
                ObservationKind::LiveGameFrame,
                &payload,
                local_puuid,
            )?;
            outbox
                .enqueue_coalesced("live_game_frame", &observation)
                .map_err(|error| error.to_string())?;
        }
        // Keep the newest frame locally for game-start timing without turning
        // continuously advancing gameTime into a durable server observation.
        payloads.insert("live_game_frame".to_owned(), body);
    } else {
        payloads.remove("live_game_frame");
    }
    Ok(())
}

pub(super) fn should_emit_live_game_frame(previous: Option<&[u8]>) -> bool {
    previous.is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    use scout_client_core::diagnostics::Diagnostics;
    use scout_client_core::lcu::LcuError;
    use scout_client_core::outbox::ObservationOutbox;
    use scout_client_core::protocol::ObservationEnvelope;
    use scout_client_core::protocol::ObservationKind;
    use serde_json::json;
    use std::collections::HashMap;

    use uuid::Uuid;

    fn lobby_bindings(diagnostics: &Diagnostics) -> Option<u64> {
        diagnostics
            .counters()
            .readings()
            .into_iter()
            .find_map(|(name, value)| (name == "lobby_bindings").then_some(value))
    }

    fn in_progress_session() -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(&json!({
            "phase": "InProgress",
            "gameData": { "gameId": 5_653_248_720_u64 },
        }))
    }

    #[test]
    fn a_started_game_is_sent_again_carrying_the_lobby_it_came_from()
    -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!("scout-runtime-{}.db", Uuid::new_v4()));
        let outbox = ObservationOutbox::open(&path)?;
        let diagnostics = Diagnostics::in_memory();
        let mut payloads = HashMap::new();

        // Champion select: the lobby is visible, and no game exists yet.
        payloads.insert(
            "lobby".to_owned(),
            serde_json::to_vec(&json!({ "partyId": "party-1" }))?,
        );
        bind_observed_lobby(&outbox, &payloads, Some("puuid"), &diagnostics)?;
        assert_eq!(outbox.pending(100)?.len(), 0);

        // In game: LCU drops the lobby and names the game, with no link back.
        payloads.remove("lobby");
        payloads.insert("gameflow_session".to_owned(), in_progress_session()?);
        bind_observed_lobby(&outbox, &payloads, Some("puuid"), &diagnostics)?;

        let pending = outbox.pending(100)?;
        assert_eq!(pending.len(), 1, "the join must reach the server in-game");
        let sent: ObservationEnvelope = serde_json::from_slice(&pending[0].body)?;
        assert_eq!(sent.kind, ObservationKind::Gameflow);
        assert_eq!(sent.game_id.as_deref(), Some("5653248720"));
        assert_eq!(sent.lobby_id.as_deref(), Some("party-1"));
        assert_eq!(lobby_bindings(&diagnostics), Some(1));

        // Every later tick of the match reads the same session.
        bind_observed_lobby(&outbox, &payloads, Some("puuid"), &diagnostics)?;
        assert_eq!(outbox.pending(100)?.len(), 1);
        assert_eq!(lobby_bindings(&diagnostics), Some(1));

        let _ = std::fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn a_game_with_no_witnessed_lobby_sends_nothing_extra() -> Result<(), Box<dyn std::error::Error>>
    {
        // A client started mid-game never saw the lobby, so it has no join to
        // report; the ordinary session observation is all there is.
        let path = std::env::temp_dir().join(format!("scout-runtime-{}.db", Uuid::new_v4()));
        let outbox = ObservationOutbox::open(&path)?;
        let diagnostics = Diagnostics::in_memory();
        let mut payloads = HashMap::new();
        payloads.insert("gameflow_session".to_owned(), in_progress_session()?);

        bind_observed_lobby(&outbox, &payloads, Some("puuid"), &diagnostics)?;

        assert_eq!(outbox.pending(100)?.len(), 0);
        assert_eq!(lobby_bindings(&diagnostics), Some(0));
        let _ = std::fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn stopped_league_is_not_a_replay_upload_error() {
        assert!(matches!(
            optional_lockfile(Err(LcuError::NotRunning)),
            Ok(None)
        ));
    }

    #[test]
    fn invalid_league_lockfile_remains_an_actionable_error() {
        assert!(matches!(
            optional_lockfile(Err(LcuError::InvalidLockfile)),
            Err(message) if message == "League lockfile is invalid"
        ));
    }

    #[test]
    fn only_unchanged_lobbies_are_periodically_reobserved() {
        assert!(!should_refresh_lobby(Some(&[1]), &[1], 2));
        assert!(should_refresh_lobby(Some(&[1]), &[1], 16));
        assert!(!should_refresh_lobby(Some(&[1]), &[2], 16));
        assert!(!should_refresh_lobby(None, &[1], 16));
    }

    #[test]
    fn emits_one_live_frame_per_live_client_session() {
        assert!(should_emit_live_game_frame(None));
        assert!(!should_emit_live_game_frame(Some(&[1])));
        assert!(!should_emit_live_game_frame(Some(&[2])));
    }

    #[test]
    fn derives_playable_start_from_live_game_time() {
        let session = json!({
            "phase": "InProgress",
            "gameData": { "gameId": 12345 },
        });
        let frame = json!({ "gameData": { "gameTime": 12.5 } });

        assert_eq!(
            game_start_evidence(&session, &frame, 20_000),
            Some(("12345".to_owned(), 7_500))
        );
        assert_eq!(
            game_start_evidence(
                &json!({ "phase": "Lobby", "gameData": { "gameId": 12345 } }),
                &frame,
                20_000,
            ),
            None
        );
    }
}
