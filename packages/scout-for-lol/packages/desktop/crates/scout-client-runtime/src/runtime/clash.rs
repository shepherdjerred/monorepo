//! Fair, entity-aware collection of the player's observable Clash graph.

use scout_client_core::diagnostics::Diagnostics;
use scout_client_core::lcu::{
    ClashBracketId, ClashRosterId, ClashTournamentId, LcuClient, LcuResource,
};
use scout_client_core::outbox::ObservationOutbox;
use scout_client_core::protocol::ObservationKind;
use std::collections::{HashMap, HashSet};
use std::time::Instant;

use super::{
    ObservationSlot, PROFILE_PASS_BUDGET, PROFILE_SNAPSHOT_ENDPOINTS, ids_from, noted_lcu_read,
    out_of_budget, record_endpoint_payload,
};

pub(super) async fn collect_snapshots(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    observer: Option<&str>,
    diagnostics: &Diagnostics,
    tick: u64,
) -> Result<(), String> {
    let endpoints: Vec<_> = PROFILE_SNAPSHOT_ENDPOINTS
        .iter()
        .copied()
        .filter(|(_, _, kind)| *kind == ObservationKind::Clash)
        .collect();
    let deadline = Instant::now() + PROFILE_PASS_BUDGET;
    let offset = usize::try_from(tick / 5).unwrap_or_default() % endpoints.len();
    for (endpoint, key, kind) in endpoints
        .iter()
        .cycle()
        .skip(offset)
        .take(endpoints.len())
        .copied()
    {
        if out_of_budget(deadline, diagnostics) {
            break;
        }
        if let Ok(payload) = noted_lcu_read(client.get(endpoint).await, diagnostics, key) {
            record_endpoint_payload(
                outbox,
                payloads,
                ObservationSlot::named(key, kind),
                payload.as_ref(),
                observer,
                diagnostics,
            )?;
        }
    }
    // A separate budget guarantees entity reads even if overview endpoints stall.
    collect_entities(client, outbox, payloads, observer, diagnostics, tick).await
}

async fn collect_entities(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    observer: Option<&str>,
    diagnostics: &Diagnostics,
    tick: u64,
) -> Result<(), String> {
    let own = ids_from(payloads, &["clash_player"], &["rosterId"]);
    let source_keys: Vec<_> = payloads
        .keys()
        .filter(|key| key.starts_with("clash_"))
        .cloned()
        .collect();
    let sources: Vec<_> = source_keys.iter().map(String::as_str).collect();
    let mut roster_ids = ids_from(payloads, &sources, &["rosterId", "rosterId1", "rosterId2"]);
    roster_ids.extend(ids_from(
        payloads,
        &["clash_invited_rosters"],
        &["rosterId"],
    ));
    roster_ids.extend(own.iter().cloned());
    let mut reads = Vec::new();
    let mut seen = HashSet::new();
    for id in roster_ids {
        if let Some(roster) = ClashRosterId::parse(&id)
            && seen.insert(format!("roster:{id}"))
        {
            reads.push((
                LcuResource::ClashRoster(roster),
                "clash_roster",
                id.clone(),
                own.contains(&id),
            ));
            reads.push((
                LcuResource::ClashRosterStats(roster),
                "clash_roster_stats",
                id,
                false,
            ));
        }
    }
    for id in ids_from(payloads, &sources, &["bracketId"]) {
        if let Some(bracket) = ClashBracketId::parse(&id)
            && seen.insert(format!("bracket:{id}"))
        {
            reads.push((
                LcuResource::ClashBracket(bracket),
                "clash_bracket",
                id,
                false,
            ));
        }
    }
    let mut tournaments = ids_from(payloads, &sources, &["tournamentId"]);
    tournaments.extend(ids_from(
        payloads,
        &["clash_current_tournament_ids"],
        &["tournamentId"],
    ));
    for id in tournaments {
        if let Some(tournament) = ClashTournamentId::parse(&id)
            && seen.insert(format!("tournament:{id}"))
        {
            reads.push((
                LcuResource::ClashTournament(tournament),
                "clash_tournament",
                id,
                false,
            ));
        }
    }
    reads.sort_by(|left, right| (left.1, &left.2).cmp(&(right.1, &right.2)));
    if reads.is_empty() {
        return Ok(());
    }
    let offset = usize::try_from(tick / 5).unwrap_or_default() % reads.len();
    let deadline = Instant::now() + PROFILE_PASS_BUDGET;
    for (resource, name, id, primary) in reads.iter().cycle().skip(offset).take(reads.len()) {
        if out_of_budget(deadline, diagnostics) {
            break;
        }
        if let Ok(payload) = noted_lcu_read(client.get_resource(*resource).await, diagnostics, name)
        {
            let key = if *primary {
                (*name).to_owned()
            } else {
                format!("{name}:{id}")
            };
            record_endpoint_payload(
                outbox,
                payloads,
                ObservationSlot::named(&key, ObservationKind::Clash),
                payload.as_ref(),
                observer,
                diagnostics,
            )?;
        }
    }
    Ok(())
}
