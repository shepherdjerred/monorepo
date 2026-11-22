//! Fair, entity-aware collection of the player's observable Clash graph.

use scout_client_core::diagnostics::Diagnostics;
use scout_client_core::lcu::{
    ClashBracketId, ClashRosterId, ClashTournamentId, LcuClient, LcuError, LcuResource,
};
use scout_client_core::outbox::{ObservationOutbox, RefusedClashRead};
use scout_client_core::protocol::ObservationKind;
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::Instant;

use super::observe::{ObservationSlot, noted_lcu_read, record_endpoint_payload};
use super::profile::{
    PROFILE_PASS_BUDGET, PROFILE_SNAPSHOT_ENDPOINTS, collect_values, ids_from, out_of_budget,
    scalar_id,
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

/// One entity read a pass may make.
struct EntityRead {
    resource: LcuResource,
    name: &'static str,
    id: String,
    /// The player's own roster, filed under the bare `clash_roster` key.
    primary: bool,
    /// Fingerprint of every cached payload that names this ID.
    evidence: String,
}

/// Each ID that `keys` names in `sources`, plus the scalars of `list_source`
/// when that payload is a bare ID list (the League client answers
/// `current-tournament-ids` as `[3021]`), with a fingerprint of the payloads
/// that name it. The fingerprint changes when, and only when, one of those
/// payloads does. It is SHA-256, not the standard library's hasher, because it
/// is stored in the outbox and compared by later builds.
///
/// A bare list counts only for its own kind: read as every kind, the
/// tournament list `[3021]` was also asked for as bracket 3021.
fn ids_with_evidence(
    payloads: &HashMap<String, Vec<u8>>,
    sources: &[&str],
    keys: &[&str],
    list_source: Option<&str>,
) -> BTreeMap<String, String> {
    let mut found: BTreeMap<String, Sha256> = BTreeMap::new();
    for source in sources {
        let Some(body) = payloads.get(*source) else {
            continue;
        };
        let Ok(value) = serde_json::from_slice::<Value>(body) else {
            continue;
        };
        let mut ids = Vec::new();
        if Some(*source) == list_source
            && let Value::Array(items) = &value
        {
            ids.extend(items.iter().filter_map(scalar_id));
        }
        collect_values(&value, keys, &mut ids);
        let mut seen = HashSet::new();
        for id in ids.into_iter().filter(|id| seen.insert(id.clone())) {
            let hasher = found.entry(id).or_default();
            // Length-prefixed, so no two source/body splits hash alike.
            for part in [source.as_bytes(), body.as_slice()] {
                hasher.update((part.len() as u64).to_le_bytes());
                hasher.update(part);
            }
        }
    }
    found
        .into_iter()
        .map(|(id, hasher)| (id, hex::encode(hasher.finalize())))
        .collect()
}

/// The status, when the League client refused the read itself rather than
/// failing to answer: a 4xx other than a timeout or rate limit. A 404 never
/// gets here; the client reads it as "nothing there".
fn refusal_status(error: &LcuError) -> Option<u16> {
    match error {
        LcuError::Status(status)
            if status.is_client_error()
                && *status != reqwest::StatusCode::REQUEST_TIMEOUT
                && *status != reqwest::StatusCode::TOO_MANY_REQUESTS =>
        {
            Some(status.as_u16())
        }
        _ => None,
    }
}

/// Every roster, bracket and tournament the cached Clash payloads name, once
/// each, sorted so the pass rotation is stable.
fn entity_reads(payloads: &HashMap<String, Vec<u8>>) -> Vec<EntityRead> {
    let mut source_keys: Vec<_> = payloads
        .keys()
        .filter(|key| key.starts_with("clash_"))
        .map(String::as_str)
        .collect();
    source_keys.sort_unstable();
    let own = ids_from(payloads, &["clash_player"], &["rosterId"]);
    let mut reads = Vec::new();
    for (id, evidence) in ids_with_evidence(
        payloads,
        &source_keys,
        &["rosterId", "rosterId1", "rosterId2"],
        Some("clash_invited_rosters"),
    ) {
        if let Some(roster) = ClashRosterId::parse(&id) {
            reads.push(EntityRead {
                resource: LcuResource::ClashRoster(roster),
                name: "clash_roster",
                id: id.clone(),
                primary: own.contains(&id),
                evidence: evidence.clone(),
            });
            reads.push(EntityRead {
                resource: LcuResource::ClashRosterStats(roster),
                name: "clash_roster_stats",
                id,
                primary: false,
                evidence,
            });
        }
    }
    for (id, evidence) in ids_with_evidence(payloads, &source_keys, &["bracketId"], None) {
        if let Some(bracket) = ClashBracketId::parse(&id) {
            reads.push(EntityRead {
                resource: LcuResource::ClashBracket(bracket),
                name: "clash_bracket",
                id,
                primary: false,
                evidence,
            });
        }
    }
    for (id, evidence) in ids_with_evidence(
        payloads,
        &source_keys,
        &["tournamentId"],
        Some("clash_current_tournament_ids"),
    ) {
        if let Some(tournament) = ClashTournamentId::parse(&id) {
            reads.push(EntityRead {
                resource: LcuResource::ClashTournament(tournament),
                name: "clash_tournament",
                id,
                primary: false,
                evidence,
            });
        }
    }
    reads.sort_by(|left, right| (left.name, &left.id).cmp(&(right.name, &right.id)));
    reads
}

/// Read each entity the Clash payloads name, at most once per pass.
///
/// The player's Clash history names every tournament they ever entered, and
/// the League client answers `400 Bad Request` for each one that is no longer
/// running. Asking again every pass cost about a thousand refused requests a
/// minute, so a refusal is final for that ID until a payload naming it
/// changes. Refusals live in the outbox, so a restart does not ask again
/// either: the League client's answer for a finished tournament does not
/// depend on whether Scout was restarted.
///
/// A refusal for an ID no payload names any more is kept, not pruned: on a
/// fresh start the history may not be read yet, and dropping its refusals
/// then would re-ask every past tournament once it is.
async fn collect_entities(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    observer: Option<&str>,
    diagnostics: &Diagnostics,
    tick: u64,
) -> Result<(), String> {
    let refused: HashMap<(String, String), String> = outbox
        .refused_clash_reads()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|refusal| ((refusal.read, refusal.id), refusal.evidence))
        .collect();
    let refused_for = |read: &EntityRead| refused.get(&(read.name.to_owned(), read.id.clone()));
    let reads: Vec<_> = entity_reads(payloads)
        .into_iter()
        .filter(|read| refused_for(read) != Some(&read.evidence))
        .collect();
    if reads.is_empty() {
        return Ok(());
    }
    let offset = usize::try_from(tick / 5).unwrap_or_default() % reads.len();
    let deadline = Instant::now() + PROFILE_PASS_BUDGET;
    for read in reads.iter().cycle().skip(offset).take(reads.len()) {
        if out_of_budget(deadline, diagnostics) {
            break;
        }
        let payload = match noted_lcu_read(
            client.get_resource(read.resource).await,
            diagnostics,
            read.name,
        ) {
            Ok(payload) => payload,
            Err(error) => {
                if let Some(status_code) = refusal_status(&error) {
                    outbox
                        .remember_refused_clash_read(&RefusedClashRead {
                            read: read.name.to_owned(),
                            id: read.id.clone(),
                            evidence: read.evidence.clone(),
                            status_code,
                        })
                        .map_err(|error| error.to_string())?;
                }
                continue;
            }
        };
        if refused_for(read).is_some() {
            outbox
                .forget_refused_clash_read(read.name, &read.id)
                .map_err(|error| error.to_string())?;
        }
        let key = if read.primary {
            read.name.to_owned()
        } else {
            format!("{}:{}", read.name, read.id)
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::PathBuf;

    use scout_client_core::diagnostics::Diagnostics;
    use scout_client_core::outbox::ObservationOutbox;
    use serde_json::json;
    use uuid::Uuid;

    use super::super::mock_lcu::MockLcu;
    use super::collect_snapshots;

    const OWN_ROSTER: &str = "f1c2a7d0-4b9e-4a17-9c3e-2d8f6a5b1c0e";
    /// How many past tournaments the reporting player's Clash history named.
    const PAST_TOURNAMENTS: u32 = 209;
    const CURRENT: u32 = 3021;

    /// Past tournaments the player's history names; the League client refuses
    /// each with `400 Bad Request`, as it did on a real Windows client.
    fn past() -> Vec<u32> {
        (1001..1001 + PAST_TOURNAMENTS).collect()
    }

    fn tournament(id: u32) -> String {
        format!("/lol-clash/v1/tournament/{id}")
    }

    fn roster_stats() -> String {
        format!("/lol-clash/v1/roster/{OWN_ROSTER}/stats")
    }

    fn history(ids: &[u32]) -> serde_json::Value {
        json!(
            ids.iter()
                .map(|id| json!({ "tournamentId": id, "bracketId": 0 }))
                .collect::<Vec<_>>()
        )
    }

    async fn league() -> Result<MockLcu, Box<dyn std::error::Error>> {
        let lcu = MockLcu::start().await?;
        lcu.answer(
            "/lol-clash/v1/player",
            200,
            &json!({ "rosterId": OWN_ROSTER }),
        );
        lcu.answer(
            "/lol-clash/v1/current-tournament-ids",
            200,
            &json!([CURRENT]),
        );
        lcu.answer("/lol-clash/v1/historyandwinners", 200, &history(&past()));
        for id in past() {
            lcu.answer(&tournament(id), 400, &json!({ "message": "Bad Request" }));
        }
        lcu.answer(&tournament(CURRENT), 200, &json!({ "id": CURRENT }));
        lcu.answer(
            &format!("/lol-clash/v1/roster/{OWN_ROSTER}"),
            200,
            &json!({ "id": OWN_ROSTER, "tournamentId": CURRENT }),
        );
        lcu.answer(&roster_stats(), 400, &json!({ "message": "Bad Request" }));
        Ok(lcu)
    }

    /// Requests the mock received for reads it refuses: every past
    /// tournament, plus the roster stats.
    fn refused_requests(lcu: &MockLcu, tournaments: &[u32]) -> usize {
        tournaments
            .iter()
            .map(|id| lcu.requests(&tournament(*id)))
            .sum::<usize>()
            + lcu.requests(&roster_stats())
    }

    /// One app run's Clash worker: its own payload cache and diagnostics, over
    /// an outbox file that outlives it.
    struct Collector {
        path: PathBuf,
        outbox: ObservationOutbox,
        diagnostics: Diagnostics,
        payloads: HashMap<String, Vec<u8>>,
        tick: u64,
    }

    impl Collector {
        fn new() -> Result<Self, Box<dyn std::error::Error>> {
            Self::open(std::env::temp_dir().join(format!("scout-clash-{}.db", Uuid::new_v4())))
        }

        fn open(path: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
            Ok(Self {
                outbox: ObservationOutbox::open(&path)?,
                path,
                diagnostics: Diagnostics::in_memory(),
                payloads: HashMap::new(),
                tick: 1,
            })
        }

        /// The app restarted: nothing in memory survives, the outbox file does.
        fn restart(self) -> Result<Self, Box<dyn std::error::Error>> {
            Self::open(self.path)
        }

        /// One Clash pass, as the collector runs it every five ticks.
        async fn pass(&mut self, lcu: &MockLcu) -> Result<(), Box<dyn std::error::Error>> {
            collect_snapshots(
                &lcu.client()?,
                &self.outbox,
                &mut self.payloads,
                Some("observer-puuid"),
                &self.diagnostics,
                self.tick,
            )
            .await?;
            self.tick += 5;
            Ok(())
        }

        fn refused_reads_logged(&self) -> usize {
            self.diagnostics
                .events()
                .iter()
                .filter(|event| event.operation == "lcu_read")
                .count()
        }
    }

    #[tokio::test]
    async fn a_refused_clash_read_is_asked_once_until_its_source_changes()
    -> Result<(), Box<dyn std::error::Error>> {
        let lcu = league().await?;
        let mut collector = Collector::new()?;
        let refusable = PAST_TOURNAMENTS as usize + 1;

        // The first pass asks each past tournament and the roster stats once.
        collector.pass(&lcu).await?;
        assert_eq!(refused_requests(&lcu, &past()), refusable);
        assert_eq!(collector.refused_reads_logged(), refusable);

        // Later passes in the same session ask none of them again.
        lcu.reset_requests();
        for _ in 0..3 {
            collector.pass(&lcu).await?;
        }
        assert_eq!(refused_requests(&lcu, &past()), 0);
        // What the League client does answer stays fresh every pass.
        assert_eq!(lcu.requests(&tournament(CURRENT)), 3);
        assert_eq!(
            lcu.requests(&format!("/lol-clash/v1/roster/{OWN_ROSTER}")),
            3
        );
        // The bare tournament list is not also read as bracket IDs.
        assert_eq!(lcu.requests(&format!("/lol-clash/v1/bracket/{CURRENT}")), 0);
        assert_eq!(collector.refused_reads_logged(), refusable);

        // A newly finished tournament changes the history that names every
        // past one, so each is asked again, once.
        lcu.reset_requests();
        let mut grown = past();
        grown.push(1001 + PAST_TOURNAMENTS);
        lcu.answer("/lol-clash/v1/historyandwinners", 200, &history(&grown));
        lcu.answer(
            &tournament(1001 + PAST_TOURNAMENTS),
            400,
            &json!({ "message": "Bad Request" }),
        );
        for _ in 0..3 {
            collector.pass(&lcu).await?;
        }
        for id in &grown {
            assert_eq!(lcu.requests(&tournament(*id)), 1, "tournament {id}");
        }
        // The roster stats read is named by unchanged payloads, so it stays refused.
        assert_eq!(lcu.requests(&roster_stats()), 0);
        Ok(())
    }

    #[tokio::test]
    async fn a_restart_with_unchanged_payloads_asks_no_refused_read_again()
    -> Result<(), Box<dyn std::error::Error>> {
        let lcu = league().await?;
        let mut collector = Collector::new()?;
        collector.pass(&lcu).await?;
        assert_eq!(
            refused_requests(&lcu, &past()),
            PAST_TOURNAMENTS as usize + 1
        );

        // Each restart used to relearn every refusal; now none is asked.
        for _ in 0..3 {
            collector = collector.restart()?;
            lcu.reset_requests();
            for _ in 0..3 {
                collector.pass(&lcu).await?;
            }
            assert_eq!(refused_requests(&lcu, &past()), 0);
            assert_eq!(collector.refused_reads_logged(), 0);
            // The restart still reads what the League client answers.
            assert_eq!(lcu.requests(&tournament(CURRENT)), 3);
        }

        // A history that changed while Scout was closed reopens every
        // tournament it names, once.
        collector = collector.restart()?;
        lcu.reset_requests();
        let mut grown = past();
        grown.push(1001 + PAST_TOURNAMENTS);
        lcu.answer("/lol-clash/v1/historyandwinners", 200, &history(&grown));
        for _ in 0..3 {
            collector.pass(&lcu).await?;
        }
        for id in past() {
            assert_eq!(lcu.requests(&tournament(id)), 1, "tournament {id}");
        }
        assert_eq!(lcu.requests(&roster_stats()), 0);
        Ok(())
    }

    #[tokio::test]
    async fn a_refused_read_the_league_client_later_answers_is_kept_fresh()
    -> Result<(), Box<dyn std::error::Error>> {
        let lcu = league().await?;
        let mut collector = Collector::new()?;
        collector.pass(&lcu).await?;
        assert!(
            collector
                .outbox
                .refused_clash_reads()?
                .iter()
                .any(|refusal| refusal.read == "clash_roster_stats" && refusal.status_code == 400)
        );

        // The player joins a new roster, so the payload naming the stats read
        // changes; this time the League client answers it.
        lcu.answer(&roster_stats(), 200, &json!({ "wins": 1 }));
        lcu.answer(
            "/lol-clash/v1/player",
            200,
            &json!({ "rosterId": OWN_ROSTER, "tournamentId": CURRENT }),
        );
        lcu.reset_requests();
        for _ in 0..2 {
            collector.pass(&lcu).await?;
        }
        assert_eq!(lcu.requests(&roster_stats()), 2);
        assert!(
            !collector
                .outbox
                .refused_clash_reads()?
                .iter()
                .any(|refusal| refusal.read == "clash_roster_stats")
        );
        Ok(())
    }

    #[tokio::test]
    async fn a_transient_failure_is_asked_again_next_pass() -> Result<(), Box<dyn std::error::Error>>
    {
        let lcu = league().await?;
        lcu.answer(
            &tournament(CURRENT),
            429,
            &json!({ "message": "slow down" }),
        );
        let mut collector = Collector::new()?;
        for _ in 0..3 {
            collector.pass(&lcu).await?;
        }
        assert_eq!(lcu.requests(&tournament(CURRENT)), 3);
        lcu.answer(&tournament(CURRENT), 200, &json!({ "id": CURRENT }));
        collector.pass(&lcu).await?;
        assert_eq!(lcu.requests(&tournament(CURRENT)), 4);
        assert!(
            collector
                .payloads
                .contains_key(&format!("clash_tournament:{CURRENT}"))
        );
        Ok(())
    }
}
