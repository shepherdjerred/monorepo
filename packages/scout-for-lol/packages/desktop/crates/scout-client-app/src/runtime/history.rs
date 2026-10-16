//! Account-scoped discovery and independently retryable postgame artifacts.

use scout_client_core::diagnostics::{DiagnosticOutcome, Diagnostics};
use scout_client_core::lcu::{GameId, LcuClient, LcuEndpoint, LcuResource};
use scout_client_core::outbox::{ObservationOutbox, PendingGameTiming, RecoveryGame};
use scout_client_core::protocol::{ObservationKind, without_credentials};
use serde_json::{Value, json};
use std::collections::HashMap;

use super::{ObservationSlot, enqueue_resource_if_changed, record_post_game_read};

pub(super) async fn collect_recent_matches(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    local_puuid: Option<&str>,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    let Some(observer) = local_puuid else {
        return Ok(());
    };
    let now = chrono::Utc::now().timestamp_millis();
    resolve_game_hints(client, outbox, observer, diagnostics, now).await?;
    match client.get(LcuEndpoint::MatchHistoryRecent).await {
        Ok(Some(history)) => {
            if history_games(&history).is_none() {
                record_post_game_read(
                    diagnostics,
                    DiagnosticOutcome::Deferred,
                    "malformed history head; pending artifacts still recover",
                );
            } else {
                discover_page(outbox, payloads, observer, &history, diagnostics)?;
            }
        }
        Ok(None) => {}
        Err(_) => record_post_game_read(
            diagnostics,
            DiagnosticOutcome::Deferred,
            "history head unavailable; pending games still recover",
        ),
    }
    if let Some(index) = outbox
        .history_page(observer, now)
        .map_err(|error| error.to_string())?
    {
        match client
            .get_resource(LcuResource::MatchHistoryPage(index))
            .await
        {
            Ok(Some(history)) => {
                if history_games(&history).is_none() {
                    record_post_game_read(
                        diagnostics,
                        DiagnosticOutcome::Deferred,
                        "malformed history page; scan checkpoint retained",
                    );
                } else {
                    let count = discover_page(outbox, payloads, observer, &history, diagnostics)?;
                    outbox
                        .checkpoint_history(observer, index, count < 20, now)
                        .map_err(|error| error.to_string())?;
                }
            }
            Ok(None) => {}
            Err(_) => record_post_game_read(
                diagnostics,
                DiagnosticOutcome::Deferred,
                "history page unavailable; scan checkpoint retained",
            ),
        }
    }
    for game in outbox
        .recovery_games(observer, now, 4)
        .map_err(|error| error.to_string())?
    {
        if collect_game(client, outbox, payloads, observer, &game, diagnostics, now)
            .await
            .is_err()
        {
            record_post_game_read(
                diagnostics,
                DiagnosticOutcome::Failed,
                "game recovery failed; other games remain eligible",
            );
            outbox
                .checkpoint_game(observer, &game, None, false, false, now)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

pub(super) fn remember_game_references(
    outbox: &ObservationOutbox,
    observer: &str,
    value: &Value,
) -> Result<(), String> {
    match value {
        Value::Array(items) => {
            for item in items {
                remember_game_references(outbox, observer, item)?;
            }
        }
        Value::Object(fields) => {
            for (key, value) in fields {
                if key == "gameId"
                    && let Some(id) =
                        super::scalar_id(value).filter(|id| GameId::parse(id).is_some())
                {
                    outbox
                        .remember_game_hint(observer, &id)
                        .map_err(|error| error.to_string())?;
                }
                if key == "gameIds"
                    && let Some(ids) = value.as_array()
                {
                    for id in ids {
                        if let Some(id) =
                            super::scalar_id(id).filter(|id| GameId::parse(id).is_some())
                        {
                            outbox
                                .remember_game_hint(observer, &id)
                                .map_err(|error| error.to_string())?;
                        }
                    }
                }
                remember_game_references(outbox, observer, value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

async fn resolve_game_hints(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    observer: &str,
    diagnostics: &Diagnostics,
    now: i64,
) -> Result<(), String> {
    for id in outbox
        .game_hints(observer, now)
        .map_err(|error| error.to_string())?
    {
        let game_id =
            GameId::parse(&id).ok_or_else(|| "Invalid persisted game reference".to_owned())?;
        let game = if let Ok(game) = client
            .get_resource(LcuResource::MatchHistoryGame(game_id))
            .await
        {
            game
        } else {
            record_post_game_read(
                diagnostics,
                DiagnosticOutcome::Deferred,
                "referenced game unavailable; discovery remains pending",
            );
            None
        };
        let mut resolved = false;
        if let Some(game) = game
            && let Some(platform) = game
                .get("platformId")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
        {
            let pending = RecoveryGame {
                platform: platform.to_uppercase(),
                game_id: id.clone(),
                live: false,
                result_queued: false,
                timeline_queued: false,
                full_game: None,
            };
            if identity_agrees(&game, &pending, observer) {
                let live = outbox
                    .pending_end_of_game(observer, &id)
                    .map_err(|error| error.to_string())?
                    .is_some()
                    && outbox
                        .pending_game_timing(observer, &id)
                        .map_err(|error| error.to_string())?
                        .is_some();
                outbox
                    .discover_game(observer, &pending.platform, &id, live)
                    .map_err(|error| error.to_string())?;
                resolved = true;
            }
        }
        outbox
            .checkpoint_game_hint(observer, &id, resolved, now)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn history_games(history: &Value) -> Option<&Vec<Value>> {
    history
        .get("games")
        .and_then(|games| games.get("games"))
        .and_then(Value::as_array)
}

fn discover_page(
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    observer: &str,
    history: &Value,
    diagnostics: &Diagnostics,
) -> Result<usize, String> {
    let games = history_games(history)
        .ok_or_else(|| "League match history has no games array".to_owned())?;
    for game in games {
        let Some(game_id) = game
            .get("gameId")
            .and_then(super::scalar_id)
            .filter(|id| GameId::parse(id).is_some())
        else {
            continue;
        };
        let Some(platform) = game
            .get("platformId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let live = outbox
            .pending_end_of_game(observer, &game_id)
            .map_err(|error| error.to_string())?
            .is_some()
            && outbox
                .pending_game_timing(observer, &game_id)
                .map_err(|error| error.to_string())?
                .is_some();
        outbox
            .discover_game(observer, &platform.to_uppercase(), &game_id, live)
            .map_err(|error| error.to_string())?;
        let pending = RecoveryGame {
            platform: platform.to_uppercase(),
            game_id: game_id.clone(),
            live,
            result_queued: false,
            timeline_queued: false,
            full_game: None,
        };
        // The first row can already describe a result. Give it the same
        // witnessed-completion context as the full game before it is uploaded;
        // server admission is permanent and cannot be upgraded by a later row.
        let bundle = result_bundle(outbox, &pending, observer, game)?;
        enqueue_result(
            outbox,
            payloads,
            &pending,
            observer,
            &bundle,
            diagnostics,
            "history_row",
        )?;
    }
    Ok(games.len())
}

async fn read_recovery_game(
    client: &LcuClient,
    pending: &RecoveryGame,
    diagnostics: &Diagnostics,
) -> Result<Option<Value>, String> {
    if let Some(body) = &pending.full_game {
        return serde_json::from_slice(body)
            .map(Some)
            .map_err(|error| error.to_string());
    }
    let game_id = GameId::parse(&pending.game_id)
        .ok_or_else(|| "Recovery game has an invalid identity".to_owned())?;
    if let Ok(game) = client
        .get_resource(LcuResource::MatchHistoryGame(game_id))
        .await
    {
        Ok(game)
    } else {
        record_post_game_read(
            diagnostics,
            DiagnosticOutcome::Deferred,
            "full game read failed; recovery remains pending",
        );
        Ok(None)
    }
}

async fn collect_game(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    observer: &str,
    pending: &RecoveryGame,
    diagnostics: &Diagnostics,
    now: i64,
) -> Result<(), String> {
    let game_id = GameId::parse(&pending.game_id)
        .ok_or_else(|| "Recovery game has an invalid identity".to_owned())?;
    let game = read_recovery_game(client, pending, diagnostics).await?;
    let Some(game) = game else {
        outbox
            .checkpoint_game(observer, pending, None, false, false, now)
            .map_err(|error| error.to_string())?;
        return Ok(());
    };
    if !identity_agrees(&game, pending, observer) {
        return Err("Full game identity does not agree with its recovery request".to_owned());
    }
    let game = without_credentials(game);
    let body = serde_json::to_vec(&game).map_err(|error| error.to_string())?;
    outbox
        .cache_recovery_game(observer, pending, &body)
        .map_err(|error| error.to_string())?;
    if !pending.result_queued {
        let bundle = result_bundle(outbox, pending, observer, &game)?;
        enqueue_result(
            outbox,
            payloads,
            pending,
            observer,
            &bundle,
            diagnostics,
            "result",
        )?;
    }
    let timeline = if pending.timeline_queued {
        None
    } else if let Ok(timeline) = client
        .get_resource(LcuResource::MatchTimeline(game_id))
        .await
    {
        timeline
    } else {
        record_post_game_read(
            diagnostics,
            DiagnosticOutcome::Deferred,
            "timeline read failed; result collection is independent",
        );
        None
    };
    if let Some(timeline) = &timeline {
        let mut enriched = result_bundle(outbox, pending, observer, &game)?;
        enriched["timeline"] = timeline.clone();
        enqueue_result(
            outbox,
            payloads,
            pending,
            observer,
            &enriched,
            diagnostics,
            "result_with_timeline",
        )?;
        enqueue_resource_if_changed(
            outbox,
            payloads,
            ObservationSlot {
                cache_key: &format!("timeline:{}:{}", pending.platform, pending.game_id),
                resource: "post_game_timeline",
                kind: ObservationKind::PostGame,
            },
            &json!({ "matchHistory": game, "timeline": timeline }),
            Some(observer),
            diagnostics,
        )?;
    }
    outbox
        .checkpoint_game(
            observer,
            pending,
            Some(&body),
            true,
            timeline.is_some(),
            now,
        )
        .map_err(|error| error.to_string())?;
    record_post_game_read(
        diagnostics,
        DiagnosticOutcome::Succeeded,
        "full game durable; missing artifacts remain independently retryable",
    );
    Ok(())
}

fn identity_agrees(game: &Value, pending: &RecoveryGame, observer: &str) -> bool {
    game.get("gameId").and_then(super::scalar_id).as_deref() == Some(pending.game_id.as_str())
        && game
            .get("platformId")
            .and_then(Value::as_str)
            .map(str::to_uppercase)
            .as_deref()
            == Some(pending.platform.as_str())
        && game
            .get("participantIdentities")
            .and_then(Value::as_array)
            .is_some_and(|identities| {
                identities.iter().any(|identity| {
                    identity.pointer("/player/puuid").and_then(Value::as_str) == Some(observer)
                })
            })
}

fn result_bundle(
    outbox: &ObservationOutbox,
    pending: &RecoveryGame,
    observer: &str,
    game: &Value,
) -> Result<Value, String> {
    let mut bundle = json!({ "matchHistory": game });
    if pending.live
        && let Some(eog) = outbox
            .pending_end_of_game(observer, &pending.game_id)
            .map_err(|error| error.to_string())?
        && let Some(timing) = outbox
            .pending_game_timing(observer, &pending.game_id)
            .map_err(|error| error.to_string())?
    {
        let eog: Value = serde_json::from_slice(&eog).map_err(|error| error.to_string())?;
        if contains_observer(&eog, observer) && context_agrees(&eog, game, pending, &timing) {
            bundle["endOfGame"] = without_credentials(eog);
            bundle["timing"] = json!({ "gameStartTimestamp": timing.started_at_millis, "gameEndTimestamp": timing.ended_at_millis });
        }
    }
    Ok(bundle)
}

fn context_agrees(
    eog: &Value,
    game: &Value,
    pending: &RecoveryGame,
    timing: &PendingGameTiming,
) -> bool {
    let Some(creation) = game.get("gameCreation").and_then(Value::as_i64) else {
        return false;
    };
    let platform_agrees = eog
        .get("platformId")
        .and_then(Value::as_str)
        .is_none_or(|platform| platform.eq_ignore_ascii_case(&pending.platform));
    platform_agrees
        && timing.started_at_millis.abs_diff(creation) <= 15 * 60 * 1000
        && timing.ended_at_millis > creation
}

fn enqueue_result(
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    pending: &RecoveryGame,
    observer: &str,
    bundle: &Value,
    diagnostics: &Diagnostics,
    artifact: &str,
) -> Result<(), String> {
    let resource = if bundle.get("endOfGame").is_some() {
        "post_game".to_owned()
    } else {
        format!("match_history_game:{}", pending.game_id)
    };
    enqueue_resource_if_changed(
        outbox,
        payloads,
        ObservationSlot {
            cache_key: &format!("{artifact}:{}:{}", pending.platform, pending.game_id),
            resource: &resource,
            kind: ObservationKind::PostGame,
        },
        bundle,
        Some(observer),
        diagnostics,
    )
}

fn contains_observer(value: &Value, observer: &str) -> bool {
    match value {
        Value::Array(items) => items.iter().any(|item| contains_observer(item, observer)),
        Value::Object(fields) => fields.iter().any(|(key, value)| {
            ((key == "puuid" || key == "PUUID" || key == "summonerPuuid")
                && value.as_str() == Some(observer))
                || contains_observer(value, observer)
        }),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ObservationOutbox, PendingGameTiming, RecoveryGame, context_agrees, discover_page,
        history_games, remember_game_references,
    };
    use scout_client_core::diagnostics::Diagnostics;
    use scout_client_core::protocol::ObservationEnvelope;
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn malformed_history_is_distinct_from_a_valid_empty_page() {
        assert!(history_games(&json!({"games": {"games": []}})).is_some());
        for payload in [
            json!({}),
            json!({"games": []}),
            json!({"games": {"games": null}}),
        ] {
            assert!(history_games(&payload).is_none());
        }
    }

    #[test]
    fn first_history_snapshot_preserves_valid_witnessed_completion()
    -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!(
            "scout-history-live-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let outbox = ObservationOutbox::open(&path)?;
        let creation = 1_800_000_000_000_i64;
        for (id, start) in [("123", creation), ("456", creation - 3_600_000)] {
            outbox.remember_game_start("owner", id, start)?;
            outbox.remember_game_end("owner", id, start + 1_800_000)?;
            outbox.remember_end_of_game(
                "owner",
                id,
                &serde_json::to_vec(&json!({"gameId": id, "platformId": "NA1", "puuid": "owner"}))?,
            )?;
        }
        let rows = json!({"games": {"games": [
            {"gameId": 123, "platformId": "NA1", "gameCreation": creation},
            {"gameId": 456, "platformId": "NA1", "gameCreation": creation},
            {"gameId": 789, "platformId": "NA1", "gameCreation": creation}
        ]}});
        discover_page(
            &outbox,
            &mut HashMap::new(),
            "owner",
            &rows,
            &Diagnostics::in_memory(),
        )?;
        drop(outbox);
        let reopened = ObservationOutbox::open(&path)?;
        let snapshots = reopened
            .pending(100)?
            .into_iter()
            .map(|row| serde_json::from_slice::<ObservationEnvelope>(&row.body))
            .collect::<Result<Vec<_>, _>>()?;
        assert_eq!(snapshots.len(), 3);
        assert_eq!(snapshots[0].payload["resource"], "post_game");
        assert_eq!(
            snapshots[0].payload["data"]["matchHistory"],
            rows["games"]["games"][0]
        );
        assert_eq!(snapshots[0].payload["data"]["endOfGame"]["puuid"], "owner");
        assert_eq!(
            snapshots[0].payload["data"]["timing"]["gameStartTimestamp"],
            creation
        );
        assert_eq!(snapshots[1].payload["resource"], "match_history_game:456");
        assert!(snapshots[1].payload["data"].get("endOfGame").is_none());
        assert_eq!(snapshots[2].payload["resource"], "match_history_game:789");
        drop(reopened);
        std::fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn equal_numeric_ids_do_not_join_fragments_from_another_platform_or_time() {
        let pending = RecoveryGame {
            platform: "NA1".to_owned(),
            game_id: "123".to_owned(),
            live: true,
            result_queued: false,
            timeline_queued: false,
            full_game: None,
        };
        let game = json!({ "gameCreation": 1_800_000_000_000_i64 });
        let timing = PendingGameTiming {
            started_at_millis: 1_800_000_005_000,
            ended_at_millis: 1_800_001_805_000,
        };
        assert!(context_agrees(&json!({}), &game, &pending, &timing));
        assert!(!context_agrees(
            &json!({ "platformId": "EUW1" }),
            &game,
            &pending,
            &timing
        ));
        assert!(!context_agrees(
            &json!({}),
            &json!({ "gameCreation": 1_700_000_000_000_i64 }),
            &pending,
            &timing
        ));
    }

    #[test]
    fn clash_game_lists_become_recovery_hints_without_inventing_ids()
    -> Result<(), Box<dyn std::error::Error>> {
        let path =
            std::env::temp_dir().join(format!("scout-clash-hints-{}.sqlite", uuid::Uuid::new_v4()));
        let outbox = ObservationOutbox::open(&path)?;
        remember_game_references(
            &outbox,
            "owner",
            &json!({ "matches": [{ "gameId": "123", "gameIds": [456, "789", "not-an-id"] }], "rosterId": "999" }),
        )?;
        assert_eq!(outbox.game_hints("owner", 0)?, vec!["123", "456", "789"]);
        std::fs::remove_file(path)?;
        Ok(())
    }
}
