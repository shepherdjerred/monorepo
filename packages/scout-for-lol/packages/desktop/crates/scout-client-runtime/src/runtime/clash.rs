//! Fair, entity-aware collection of the player's observable Clash graph.

use scout_client_core::diagnostics::Diagnostics;
use scout_client_core::lcu::{
    ClashBracketId, ClashRosterId, ClashTournamentId, LcuClient, LcuError, LcuResource,
};
use scout_client_core::outbox::ObservationOutbox;
use scout_client_core::protocol::ObservationKind;
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::hash::{Hash as _, Hasher as _};
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

/// Where a refused entity read is remembered in the collector's payload cache:
/// `refused:<read>:<id>`, holding the fingerprint of the payloads that named
/// the id when the League client refused it. Not a `clash_` key, so it is
/// never read as a source of IDs.
const REFUSED_PREFIX: &str = "refused:";

/// One entity read a pass may make.
struct EntityRead {
    resource: LcuResource,
    name: &'static str,
    id: String,
    /// The player's own roster, filed under the bare `clash_roster` key.
    primary: bool,
    /// Fingerprint of every cached payload that names this ID.
    evidence: u64,
}

impl EntityRead {
    fn refusal_key(&self) -> String {
        format!("{REFUSED_PREFIX}{}:{}", self.name, self.id)
    }
}

/// Each ID that `keys` names in `sources`, plus the scalars of `list_source`
/// when that payload is a bare ID list (the League client answers
/// `current-tournament-ids` as `[3021]`), with a fingerprint of the payloads
/// that name it. The fingerprint changes when, and only when, one of those
/// payloads does.
///
/// A bare list counts only for its own kind: read as every kind, the
/// tournament list `[3021]` was also asked for as bracket 3021.
fn ids_with_evidence(
    payloads: &HashMap<String, Vec<u8>>,
    sources: &[&str],
    keys: &[&str],
    list_source: Option<&str>,
) -> BTreeMap<String, u64> {
    let mut found: BTreeMap<String, DefaultHasher> = BTreeMap::new();
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
            source.hash(hasher);
            body.hash(hasher);
        }
    }
    found
        .into_iter()
        .map(|(id, hasher)| (id, hasher.finish()))
        .collect()
}

/// Whether the League client refused the read itself rather than failing to
/// answer: a 4xx other than a timeout or rate limit. A 404 never gets here;
/// the client reads it as "nothing there".
fn is_refusal(error: &LcuError) -> bool {
    matches!(
        error,
        LcuError::Status(status)
            if status.is_client_error()
                && *status != reqwest::StatusCode::REQUEST_TIMEOUT
                && *status != reqwest::StatusCode::TOO_MANY_REQUESTS
    )
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
                evidence,
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
/// changes.
async fn collect_entities(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    observer: Option<&str>,
    diagnostics: &Diagnostics,
    tick: u64,
) -> Result<(), String> {
    let candidates = entity_reads(payloads);
    let current: HashSet<String> = candidates.iter().map(EntityRead::refusal_key).collect();
    payloads.retain(|key, _| !key.starts_with(REFUSED_PREFIX) || current.contains(key));
    let reads: Vec<_> = candidates
        .into_iter()
        .filter(|read| {
            payloads.get(&read.refusal_key()).map(Vec::as_slice)
                != Some(read.evidence.to_le_bytes().as_slice())
        })
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
                if is_refusal(&error) {
                    payloads.insert(read.refusal_key(), read.evidence.to_le_bytes().to_vec());
                }
                continue;
            }
        };
        payloads.remove(&read.refusal_key());
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

    use scout_client_core::diagnostics::Diagnostics;
    use scout_client_core::outbox::ObservationOutbox;
    use serde_json::json;
    use uuid::Uuid;

    use super::super::mock_lcu::MockLcu;
    use super::collect_snapshots;

    const OWN_ROSTER: &str = "f1c2a7d0-4b9e-4a17-9c3e-2d8f6a5b1c0e";
    /// Past tournaments the player's history names; the League client refuses
    /// each with `400 Bad Request`, as it did on a real Windows client.
    const PAST: [u32; 3] = [1001, 1002, 1003];
    const CURRENT: u32 = 3021;

    fn tournament(id: u32) -> String {
        format!("/lol-clash/v1/tournament/{id}")
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
        lcu.answer("/lol-clash/v1/historyandwinners", 200, &history(&PAST));
        for id in PAST {
            lcu.answer(&tournament(id), 400, &json!({ "message": "Bad Request" }));
        }
        lcu.answer(&tournament(CURRENT), 200, &json!({ "id": CURRENT }));
        lcu.answer(
            &format!("/lol-clash/v1/roster/{OWN_ROSTER}"),
            200,
            &json!({ "id": OWN_ROSTER, "tournamentId": CURRENT }),
        );
        lcu.answer(
            &format!("/lol-clash/v1/roster/{OWN_ROSTER}/stats"),
            400,
            &json!({ "message": "Bad Request" }),
        );
        Ok(lcu)
    }

    struct Collector {
        outbox: ObservationOutbox,
        diagnostics: Diagnostics,
        payloads: HashMap<String, Vec<u8>>,
        tick: u64,
    }

    impl Collector {
        fn new() -> Result<Self, Box<dyn std::error::Error>> {
            let path = std::env::temp_dir().join(format!("scout-clash-{}.db", Uuid::new_v4()));
            Ok(Self {
                outbox: ObservationOutbox::open(path)?,
                diagnostics: Diagnostics::in_memory(),
                payloads: HashMap::new(),
                tick: 1,
            })
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

        for _ in 0..4 {
            collector.pass(&lcu).await?;
        }
        for id in PAST {
            assert_eq!(lcu.requests(&tournament(id)), 1, "tournament {id}");
        }
        assert_eq!(
            lcu.requests(&format!("/lol-clash/v1/roster/{OWN_ROSTER}/stats")),
            1
        );
        // What the League client does answer stays fresh every pass.
        assert_eq!(lcu.requests(&tournament(CURRENT)), 4);
        assert_eq!(
            lcu.requests(&format!("/lol-clash/v1/roster/{OWN_ROSTER}")),
            4
        );
        // The bare tournament list is not also read as bracket IDs.
        assert_eq!(lcu.requests(&format!("/lol-clash/v1/bracket/{CURRENT}")), 0);
        assert_eq!(collector.refused_reads_logged(), PAST.len() + 1);

        // A newly finished tournament changes the history that names every
        // past one, so each is asked again, once.
        lcu.reset_requests();
        lcu.answer(
            "/lol-clash/v1/historyandwinners",
            200,
            &history(&[1001, 1002, 1003, 1004]),
        );
        lcu.answer(&tournament(1004), 400, &json!({ "message": "Bad Request" }));
        for _ in 0..3 {
            collector.pass(&lcu).await?;
        }
        for id in [1001, 1002, 1003, 1004] {
            assert_eq!(lcu.requests(&tournament(id)), 1, "tournament {id}");
        }
        // The roster stats read is named by unchanged payloads, so it stays refused.
        assert_eq!(
            lcu.requests(&format!("/lol-clash/v1/roster/{OWN_ROSTER}/stats")),
            0
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
