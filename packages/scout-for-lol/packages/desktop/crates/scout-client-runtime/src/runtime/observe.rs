//! Reading LCU endpoints into outbox observations.

use scout_client_core::diagnostics::DiagnosticCategory;
use scout_client_core::diagnostics::DiagnosticEvent;
use scout_client_core::diagnostics::DiagnosticLevel;
use scout_client_core::diagnostics::DiagnosticOutcome;
use scout_client_core::diagnostics::Diagnostics;
use scout_client_core::lcu::LcuClient;
use scout_client_core::lcu::LcuEndpoint;
use scout_client_core::lcu::LcuError;
use scout_client_core::outbox::ObservationOutbox;
use scout_client_core::protocol::ObservationEnvelope;
use scout_client_core::protocol::ObservationKind;
use serde_json::Value;
use std::collections::HashMap;

use super::history;

pub(super) fn record_post_game_read(
    diagnostics: &Diagnostics,
    outcome: DiagnosticOutcome,
    detail: &str,
) {
    let level = if outcome == DiagnosticOutcome::Failed {
        DiagnosticLevel::Warn
    } else {
        DiagnosticLevel::Info
    };
    diagnostics.record(
        DiagnosticEvent::new(
            level,
            DiagnosticCategory::Protocol,
            "read_post_game",
            outcome,
        )
        .with_detail(detail),
    );
}

/// The League client's end-of-game block.
///
/// It and the game client's block both travel as `post_game`, but each needs
/// its own change-detection key. With one shared key, every pass where this
/// block was absent cleared the key and the game client's block looked new,
/// so it was sent again every two seconds — 366 copies of one Arena game.
pub(super) const END_OF_GAME_SLOT: ObservationSlot<'static> = ObservationSlot {
    cache_key: "post_game_end_of_game",
    resource: "post_game",
    kind: ObservationKind::PostGame,
};

/// The game client's own end-of-game block, read when the League client's
/// is absent. See [`END_OF_GAME_SLOT`].
pub(super) const GAME_CLIENT_END_OF_GAME_SLOT: ObservationSlot<'static> = ObservationSlot {
    cache_key: "post_game_game_client",
    resource: "post_game",
    kind: ObservationKind::PostGame,
};

/// What a collected payload is filed as.
///
/// These three always travel together — the loops below already group them as
/// a tuple — so naming them keeps the call signatures within budget.
#[derive(Clone, Copy)]
pub(super) struct ObservationSlot<'a> {
    /// Key used to detect that a payload changed.
    pub(super) cache_key: &'a str,
    /// Resource name carried on the wire.
    pub(super) resource: &'a str,
    pub(super) kind: ObservationKind,
}

impl<'a> ObservationSlot<'a> {
    /// A slot whose cache key and resource name are the same.
    pub(super) const fn named(name: &'a str, kind: ObservationKind) -> Self {
        Self {
            cache_key: name,
            resource: name,
            kind,
        }
    }
}

pub(super) async fn observe_endpoint(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    endpoint: LcuEndpoint,
    slot: ObservationSlot<'_>,
    local_puuid: Option<&str>,
    diagnostics: &Diagnostics,
) -> Result<Option<Value>, String> {
    let payload = noted_lcu_read(client.get(endpoint).await, diagnostics, slot.cache_key)
        .map_err(|error| error.to_string())?;
    record_endpoint_payload(
        outbox,
        payloads,
        slot,
        payload.as_ref(),
        local_puuid,
        diagnostics,
    )?;
    Ok(payload)
}

/// `read`, with a failure recorded under `name`.
pub(super) fn noted_lcu_read<T>(
    read: Result<T, LcuError>,
    diagnostics: &Diagnostics,
    name: &str,
) -> Result<T, LcuError> {
    if let Err(error) = &read {
        record_lcu_read_failure(diagnostics, name, error);
    }
    read
}

/// Record a League client read that failed.
///
/// The League client is the other half of every observation, and a failure
/// to read it used to be invisible: the typed `LcuError` was flattened to a
/// string and never recorded, so a client that had quietly stopped seeing
/// games looked identical to one with nothing to report.
pub(super) fn record_lcu_read_failure(diagnostics: &Diagnostics, name: &str, error: &LcuError) {
    diagnostics.counters().lcu_error();
    diagnostics.record(
        DiagnosticEvent::new(
            DiagnosticLevel::Warn,
            DiagnosticCategory::Lcu,
            "lcu_read",
            DiagnosticOutcome::Failed,
        )
        // The name travels in the detail rather than the operation because a
        // slot borrows it; both are bounded text.
        .with_detail(format!("{name}: {error}")),
    );
}

/// File one endpoint read: queue the payload if it changed since this slot
/// last saw it, or forget the slot when the endpoint has nothing, so a payload
/// that comes back is sent again.
pub(super) fn record_endpoint_payload(
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    slot: ObservationSlot<'_>,
    payload: Option<&Value>,
    local_puuid: Option<&str>,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    if let Some(value) = payload {
        return enqueue_resource_if_changed(
            outbox,
            payloads,
            slot,
            value,
            local_puuid,
            diagnostics,
        );
    }
    payloads.remove(slot.cache_key);
    Ok(())
}

pub(super) fn enqueue_if_changed(
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    key: &str,
    kind: ObservationKind,
    payload: &Value,
    local_puuid: Option<&str>,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    enqueue_resource_if_changed(
        outbox,
        payloads,
        ObservationSlot::named(key, kind),
        payload,
        local_puuid,
        diagnostics,
    )
}

pub(super) fn enqueue_resource_if_changed(
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    slot: ObservationSlot<'_>,
    payload: &Value,
    local_puuid: Option<&str>,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    let (cache_key, resource, kind) = (slot.cache_key, slot.resource, slot.kind);
    let body = serde_json::to_vec(&payload).map_err(|error| error.to_string())?;
    if payloads.get(cache_key) == Some(&body) {
        return Ok(());
    }
    let observation = create_observation(outbox, resource, kind, payload, local_puuid)?;
    let stored = if kind == ObservationKind::LiveGameFrame {
        outbox.enqueue_coalesced(resource, &observation)
    } else {
        outbox.enqueue(&observation)
    };
    if let Err(error) = stored {
        // The outbox is what makes an observation survive a network failure.
        // If the write itself fails the evidence is simply gone, which is the
        // one outbox outcome worth a record of its own.
        diagnostics.record(
            DiagnosticEvent::new(
                DiagnosticLevel::Error,
                DiagnosticCategory::Outbox,
                "enqueue_observation",
                DiagnosticOutcome::Failed,
            )
            .with_detail(error.to_string()),
        );
        return Err(error.to_string());
    }
    payloads.insert(cache_key.to_owned(), body);
    Ok(())
}

pub(super) fn enqueue_coalesced_snapshot(
    outbox: &ObservationOutbox,
    coalesce_key: &str,
    resource: &str,
    kind: ObservationKind,
    payload: &Value,
    local_puuid: Option<&str>,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    let observation = create_observation(outbox, resource, kind, payload, local_puuid)?;
    if let Err(error) = outbox.enqueue_coalesced(coalesce_key, &observation) {
        diagnostics.record(
            DiagnosticEvent::new(
                DiagnosticLevel::Error,
                DiagnosticCategory::Outbox,
                "enqueue_observation",
                DiagnosticOutcome::Failed,
            )
            .with_detail(error.to_string()),
        );
        return Err(error.to_string());
    }
    Ok(())
}

pub(super) fn create_observation(
    outbox: &ObservationOutbox,
    resource: &str,
    kind: ObservationKind,
    payload: &Value,
    local_puuid: Option<&str>,
) -> Result<ObservationEnvelope, String> {
    let sequence = outbox.next_sequence().map_err(|error| error.to_string())?;
    let mut observation = ObservationEnvelope::new(
        sequence,
        kind,
        env!("CARGO_PKG_VERSION"),
        serde_json::json!({ "resource": resource, "data": payload }),
    )
    .map_err(|error| error.to_string())?;
    observation.local_puuid = local_puuid.map(str::to_owned);
    observation.game_id = find_string(&observation.payload, &["gameId"]);
    observation.lobby_id = match find_string(&observation.payload, &["lobbyId", "partyId"]) {
        // The lobby says which party it is; nothing else does. An in-game
        // observation names a game whose lobby only this device witnessed, so
        // fall back to the join recorded when that game started — otherwise the
        // roster and the match it belongs to never meet.
        None => match (local_puuid, observation.game_id.as_deref()) {
            (Some(observer), Some(game_id)) => outbox
                .lobby_for_game(observer, game_id)
                .map_err(|error| error.to_string())?,
            _ => None,
        },
        found => found,
    };
    observation.platform_id = find_string(&observation.payload, &["platformId"]);
    observation.league_patch = find_string(&observation.payload, &["gameVersion"]);
    observation.validate().map_err(|error| error.to_string())?;
    if let Some(observer) = local_puuid {
        history::remember_game_references(outbox, observer, &observation.payload)?;
    }
    Ok(observation)
}

/// The first non-empty value for any of `keys`, searched depth-first.
///
/// An empty string counts as ABSENT rather than as a value. The League client
/// answers `""` for a field it has no value for yet — `platformId` before a
/// game is assigned, for instance — and every envelope field filled from here
/// is an `Option` that `ObservationEnvelope::validate` is happy to see unset
/// but rejects at length zero. Returning `Some("")` therefore failed the whole
/// observation, and a post-game observation that never validates is one that
/// never reaches Scout at all. Skipping the empty value also lets the search
/// continue into nested objects, where the real value usually is.
pub(super) fn find_string(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(object) => {
            for key in keys {
                if let Some(candidate) = object.get(*key) {
                    if let Some(value) = candidate.as_str() {
                        if !value.is_empty() {
                            return Some(value.to_owned());
                        }
                    } else if let Some(value) = candidate.as_u64() {
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

#[cfg(test)]
mod tests {
    use super::*;
    use scout_client_core::diagnostics::Diagnostics;
    use scout_client_core::outbox::ObservationOutbox;
    use scout_client_core::protocol::ObservationEnvelope;
    use scout_client_core::protocol::ObservationKind;
    use serde_json::json;
    use std::collections::HashMap;

    use uuid::Uuid;

    #[test]
    fn an_unchanged_game_client_end_of_game_block_is_sent_once()
    -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!("scout-runtime-{}.db", Uuid::new_v4()));
        let outbox = ObservationOutbox::open(&path)?;
        let diagnostics = Diagnostics::in_memory();
        let mut payloads = HashMap::new();
        let block = json!({ "gameId": 5_654_767_039_u64, "queueType": "CHERRY" });

        // Each pass after an Arena game: the League client has no end-of-game
        // block, so the game client's is read instead — and it doesn't change.
        for _ in 0..3 {
            record_endpoint_payload(
                &outbox,
                &mut payloads,
                END_OF_GAME_SLOT,
                None,
                Some("puuid"),
                &diagnostics,
            )?;
            record_endpoint_payload(
                &outbox,
                &mut payloads,
                GAME_CLIENT_END_OF_GAME_SLOT,
                Some(&block),
                Some("puuid"),
                &diagnostics,
            )?;
        }

        let pending = outbox.pending(100)?;
        assert_eq!(pending.len(), 1, "an unchanged block is sent once");
        let sent: ObservationEnvelope = serde_json::from_slice(&pending[0].body)?;
        assert_eq!(sent.kind, ObservationKind::PostGame);
        assert_eq!(sent.payload["resource"], "post_game");

        let _ = std::fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn empty_league_strings_are_absent_rather_than_zero_length_values() {
        // The League client answers "" for a field it has no value for yet.
        // Reporting that as Some("") failed envelope validation and dropped the
        // whole observation, so every field filled by find_string is affected.
        for key in ["platformId", "gameId", "lobbyId", "gameVersion"] {
            assert_eq!(find_string(&json!({ key: "" }), &[key]), None, "{key}");
        }
    }

    #[test]
    fn an_empty_value_does_not_hide_a_nested_one() {
        let payload = json!({
            "platformId": "",
            "gameData": { "platformId": "NA1" },
        });
        assert_eq!(
            find_string(&payload, &["platformId"]),
            Some("NA1".to_owned())
        );
    }

    #[test]
    fn present_values_are_still_found_in_either_spelling() {
        assert_eq!(
            find_string(&json!({ "platformId": "EUW1" }), &["platformId"]),
            Some("EUW1".to_owned())
        );
        assert_eq!(
            find_string(&json!({ "gameId": 5_565_990_955_u64 }), &["gameId"]),
            Some("5565990955".to_owned())
        );
        assert_eq!(
            find_string(&json!({ "lobbyId": "abc" }), &["lobbyId", "partyId"]),
            Some("abc".to_owned())
        );
    }

    #[test]
    fn an_empty_post_game_platform_id_still_yields_a_valid_envelope() {
        // The exact shape observed in the field: a post_game payload whose
        // platformId is blank must validate, not be rejected at length zero.
        let constructed = ObservationEnvelope::new(
            1,
            ObservationKind::PostGame,
            "0.1.0",
            json!({ "resource": "end_of_game", "data": { "platformId": "", "gameId": 5_565_990_955_u64 } }),
        );
        let Ok(mut envelope) = constructed else {
            unreachable!("a post_game envelope must construct")
        };
        envelope.platform_id = find_string(&envelope.payload, &["platformId"]);
        envelope.game_id = find_string(&envelope.payload, &["gameId"]);
        assert_eq!(envelope.platform_id, None);
        assert_eq!(envelope.game_id, Some("5565990955".to_owned()));
        assert!(envelope.validate().is_ok());
    }
}
