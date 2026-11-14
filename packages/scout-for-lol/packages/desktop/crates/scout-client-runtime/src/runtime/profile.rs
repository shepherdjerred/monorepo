//! Account profile snapshot collection.

use scout_client_core::diagnostics::DiagnosticCategory;
use scout_client_core::diagnostics::DiagnosticEvent;
use scout_client_core::diagnostics::DiagnosticLevel;
use scout_client_core::diagnostics::DiagnosticOutcome;
use scout_client_core::diagnostics::Diagnostics;
use scout_client_core::lcu::LcuClient;
use scout_client_core::lcu::LcuEndpoint;
use scout_client_core::outbox::ObservationOutbox;
use scout_client_core::protocol::ObservationKind;
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;
use std::time::Instant;

use super::observe::{ObservationSlot, noted_lcu_read, record_endpoint_payload};

/// The profile resources every pass reads: (endpoint, cache key, kind).
pub(super) const PROFILE_SNAPSHOT_ENDPOINTS: &[(LcuEndpoint, &str, ObservationKind)] = &[
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
];

pub(super) async fn collect_profile_snapshots(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    local_puuid: Option<&str>,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    let deadline = Instant::now() + PROFILE_PASS_BUDGET;
    let mut first_failure = None;
    let mut any_payload = false;
    for &(endpoint, key, kind) in PROFILE_SNAPSHOT_ENDPOINTS {
        if kind == ObservationKind::Clash {
            continue;
        }
        if out_of_budget(deadline, diagnostics) {
            return first_failure.filter(|_| !any_payload).map_or(Ok(()), Err);
        }
        // One endpoint failing — Clash's are off outside a tournament window —
        // must not cost the rest. Failing to keep what was read is another
        // matter, and ends the pass.
        match noted_lcu_read(client.get(endpoint).await, diagnostics, key) {
            Ok(payload) => {
                any_payload |= payload.is_some();
                record_endpoint_payload(
                    outbox,
                    payloads,
                    ObservationSlot::named(key, kind),
                    payload.as_ref(),
                    local_puuid,
                    diagnostics,
                )?;
            }
            Err(error) => {
                first_failure.get_or_insert(error.to_string());
            }
        }
    }
    // Only a pass where nothing was read is a failed tick; a 404 is no read.
    first_failure.filter(|_| !any_payload).map_or(Ok(()), Err)
}

/// How long one profile pass may spend reading. A League client that stalls
/// rather than refusing costs each read its full five-second timeout; past
/// this budget the remaining reads wait for the next pass.
pub(super) const PROFILE_PASS_BUDGET: Duration = Duration::from_secs(20);

/// Whether the pass's read budget is spent, recording it when it is.
pub(super) fn out_of_budget(deadline: Instant, diagnostics: &Diagnostics) -> bool {
    let spent = Instant::now() >= deadline;
    if spent {
        diagnostics.record(
            DiagnosticEvent::new(
                DiagnosticLevel::Warn,
                DiagnosticCategory::Lcu,
                "profile_pass",
                DiagnosticOutcome::Deferred,
            )
            .with_detail("read budget spent; remaining reads wait for the next pass"),
        );
    }
    spent
}

/// Every value of `keys` in the cached payloads named `sources`, plus any
/// scalar a source holds as a bare list (the League client answers some ID
/// lists as `[123, 456]`). Deduplicated, in the order found.
pub(super) fn ids_from(
    payloads: &HashMap<String, Vec<u8>>,
    sources: &[&str],
    keys: &[&str],
) -> Vec<String> {
    let mut found = Vec::new();
    for source in sources {
        let Some(value) = payloads
            .get(*source)
            .and_then(|body| serde_json::from_slice::<Value>(body).ok())
        else {
            continue;
        };
        if let Value::Array(items) = &value {
            found.extend(items.iter().filter_map(scalar_id));
        }
        collect_values(&value, keys, &mut found);
    }
    let mut seen = std::collections::HashSet::new();
    found.retain(|id| seen.insert(id.clone()));
    found
}

pub(super) fn scalar_id(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.is_empty() => Some(text.clone()),
        Value::Number(number) => number.as_u64().map(|id| id.to_string()),
        _ => None,
    }
}

/// Every non-empty value of `keys`, searched depth-first.
pub(super) fn collect_values(value: &Value, keys: &[&str], found: &mut Vec<String>) {
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                if keys.contains(&key.as_str())
                    && let Some(id) = scalar_id(child)
                {
                    found.push(id);
                }
                collect_values(child, keys, found);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_values(item, keys, found);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn clash_ids_come_from_the_payloads_already_read() -> Result<(), serde_json::Error> {
        let mut payloads = HashMap::new();
        payloads.insert(
            "clash_player".to_owned(),
            serde_json::to_vec(&json!({
                "summonerId": 1,
                "rosterId": "f1c2a7d0-4b9e-4a17-9c3e-2d8f6a5b1c0e",
            }))?,
        );
        payloads.insert(
            "clash_current_tournament_ids".to_owned(),
            serde_json::to_vec(&json!([3021, 3022, 3021]))?,
        );
        payloads.insert(
            "clash_roster".to_owned(),
            serde_json::to_vec(&json!({ "members": [], "bracketId": 18276 }))?,
        );
        payloads.insert(
            "lobby".to_owned(),
            serde_json::to_vec(&json!({ "rosterId": "not-from-a-clash-source" }))?,
        );

        assert_eq!(
            ids_from(&payloads, &["clash_player"], &["rosterId"]),
            vec!["f1c2a7d0-4b9e-4a17-9c3e-2d8f6a5b1c0e".to_owned()]
        );
        assert_eq!(
            ids_from(&payloads, &["clash_current_tournament_ids"], &["id"]),
            vec!["3021".to_owned(), "3022".to_owned()]
        );
        assert_eq!(
            ids_from(&payloads, &["clash_roster"], &["bracketId"]),
            vec!["18276".to_owned()]
        );
        Ok(())
    }
}
