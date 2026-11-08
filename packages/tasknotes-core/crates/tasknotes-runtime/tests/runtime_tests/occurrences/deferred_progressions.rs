//! Real primary commit, immutable future failure, explicit repair and metadata Undo.
use super::rolling_occurrences::parent_fields;
use super::{
    Command, ContentRevision, DAY, Fixture, PARENT, Query, Result, RuntimeError, json, mutation,
};
use serde_json::Value;

fn oversized(f: &Fixture) -> Result {
    let list = vec!["0"; 101].join(",");
    parent_fields(
        f,
        json!({"recurrence":format!("DTSTART:20261004;FREQ=DAILY;COUNT=1;BYHOUR={list};BYMINUTE={list};BYSECOND={list}")}),
    )
}
fn deferred(f: &Fixture, id: &str) -> Result<Value> {
    let outcome = f.outcome(id)?;
    Ok(outcome
        .get("items")
        .ok_or("items")?
        .as_array()
        .ok_or("outcomes")?
        .iter()
        .find(|item| item["kind"] == "deferred_progression")
        .ok_or("deferred item")?
        .clone())
}
fn repair(
    f: &Fixture,
    id: &str,
    failure: &str,
    child: &str,
) -> Result<tasknotes_runtime::types::Mutation> {
    Ok(mutation(
        id,
        Command::RepairOccurrenceProgression {
            progression_id: failure.into(),
            expected_parent_revision: ContentRevision::of(&f.bytes(PARENT)?).as_str().into(),
            expected_child_revision: ContentRevision::of(&f.bytes(child)?).as_str().into(),
        },
    ))
}

fn failures(f: &Fixture, limit: u32, after: Value, version: Value) -> Result<Value> {
    f.feature(&Value::Object(serde_json::Map::from_iter([
        ("kind".into(), json!("occurrence_generation_failures")),
        ("limit".into(), json!(limit)),
        ("after".into(), after),
        ("expectedVersion".into(), version),
    ])))
}

fn seed_independent_future(
    f: &Fixture,
    child: &str,
    child_bytes: &[u8],
    next: &str,
    failure: &str,
) -> Result<Vec<u8>> {
    let document = tasknotes_vault::document::TaskDocument::parse(
        tasknotes_vault::path::VaultPath::parse(child)?,
        child_bytes,
    )?;
    let bytes = document
        .plan(
            &[
                tasknotes_vault::document::PropertyEdit::Set {
                    key: "occurrence_date".into(),
                    value: json!("2026-10-05"),
                },
                tasknotes_vault::document::PropertyEdit::Set {
                    key: "status".into(),
                    value: json!("open"),
                },
            ],
            Some("Independently owned repair\n"),
        )?
        .bytes;
    f.files.seed("a", next, &bytes)?;
    f.engine.refresh("a")?;
    assert!(
        !f.engine
            .snapshot("a", &Query::default())?
            .problems
            .iter()
            .any(|problem| problem.message.contains(failure))
    );
    Ok(bytes)
}

#[test]
fn deferred_failure_discovery_survives_restart_without_old_primary_ids_or_provider_calls() -> Result
{
    let f = Fixture::new()?;
    let child = f.series("on_completion", "scheduled", "completion")?;
    oversized(&f)?;
    f.engine
        .execute("a", &f.finish("discoverable-primary", &child, 0)?)?;
    let id = deferred(&f, "discoverable-primary")?["successorId"].clone();
    let provider = std::sync::Arc::new(super::rolling_occurrences::NoProvider::default());
    let engine = tasknotes_runtime::engine::Engine::open(&f.database, provider.clone())?;
    let before = std::fs::read(&f.database)?;
    let counts = f.counts()?;
    let request = json!({"kind":"occurrence_generation_failures","limit":1});
    let page: Value = serde_json::from_str(&engine.features_json("a", &request.to_string())?)?;
    assert_eq!(page["items"].as_array().ok_or("items")?.len(), 1);
    assert_eq!(
        page["items"][0]["primaryMutationId"],
        "discoverable-primary"
    );
    assert_eq!(page["items"][0]["item"]["successorId"], id);
    let command = &page["items"][0]["action"]["command"];
    assert_eq!(command["kind"], "repair_occurrence_progression");
    assert_eq!(
        command["expectedParentRevision"],
        ContentRevision::of(&f.bytes(PARENT)?).as_str()
    );
    assert_eq!(
        command["expectedChildRevision"],
        ContentRevision::of(&f.bytes(&child)?).as_str()
    );
    println!("GENERATION_FAILURES_SCHEMA {page}");
    println!("GENERATION_FAILURES_REQUEST_SCHEMA {request}");
    assert_eq!(provider.0.load(std::sync::atomic::Ordering::SeqCst), 0);
    assert_eq!(std::fs::read(&f.database)?, before);
    assert_eq!(f.counts()?, counts);
    Ok(())
}

#[test]
fn deferred_failure_discovery_has_closed_unrepairable_identity_reasons_without_guessing() -> Result
{
    for mode in [
        "duplicate",
        "changed-day",
        "uncompleted",
        "invalid-parent",
        "missing-child",
        "missing-parent",
    ] {
        let f = Fixture::new()?;
        let child = f.series("on_completion", "scheduled", "completion")?;
        oversized(&f)?;
        f.engine
            .execute("a", &f.finish("identity-primary", &child, 0)?)?;
        let expected = match mode {
            "duplicate" => {
                f.files.seed("a", "Tasks/Duplicate.md", &f.bytes(&child)?)?;
                "changed_or_ambiguous_identity"
            }
            "changed-day" => {
                let document = tasknotes_vault::document::TaskDocument::parse(
                    tasknotes_vault::path::VaultPath::parse(&child)?,
                    &f.bytes(&child)?,
                )?;
                let bytes = document
                    .plan(
                        &[tasknotes_vault::document::PropertyEdit::Set {
                            key: "occurrence_date".into(),
                            value: json!("2026-10-06"),
                        }],
                        None,
                    )?
                    .bytes;
                f.files.seed("a", &child, &bytes)?;
                "changed_or_ambiguous_identity"
            }
            "uncompleted" => {
                f.engine.execute(
                    "a",
                    &mutation(
                        "ordinary-uncomplete",
                        Command::SetCompletion {
                            path: child.clone(),
                            expected_revision: None,
                            completed: false,
                            occurrence_date: Some(DAY.into()),
                        },
                    ),
                )?;
                "child_state_changed"
            }
            "invalid-parent" => {
                parent_fields(&f, json!({"recurrence":"FREQ=NONSENSE"}))?;
                "invalid_current_parent"
            }
            "missing-child" => {
                f.files
                    .state
                    .lock()
                    .map_err(|_| "state")?
                    .files
                    .remove(&("a".into(), child.clone()));
                "child_missing"
            }
            "missing-parent" => {
                f.files
                    .state
                    .lock()
                    .map_err(|_| "state")?
                    .files
                    .remove(&("a".into(), PARENT.into()));
                "parent_missing"
            }
            _ => return Err("unknown mode".into()),
        };
        f.engine.refresh("a")?;
        let counts = f.counts()?;
        let exchanges = f.exchanges()?;
        let page = failures(&f, 256, Value::Null, Value::Null)?;
        assert_eq!(
            page["items"][0]["action"],
            json!({"kind":"unrepairable","reason":expected}),
            "{mode}"
        );
        println!("GENERATION_FAILURES_SCHEMA {page}");
        assert_eq!(f.counts()?, counts);
        assert_eq!(f.exchanges()?, exchanges);
    }
    Ok(())
}

#[test]
fn deferred_and_concrete_failure_pages_invalidate_on_no_file_state_transitions() -> Result {
    let f = Fixture::new()?;
    let child = f.series("on_completion", "scheduled", "completion")?;
    oversized(&f)?;
    f.engine
        .execute("a", &f.finish("first-deferred", &child, 0)?)?;
    f.engine.execute(
        "a",
        &mutation(
            "uncomplete-first",
            Command::SetCompletion {
                path: child.clone(),
                expected_revision: None,
                completed: false,
                occurrence_date: Some(DAY.into()),
            },
        ),
    )?;
    f.engine
        .execute("a", &f.finish("second-deferred", &child, 0)?)?;
    parent_fields(&f, json!({"recurrence":"DTSTART:20261004;FREQ=DAILY"}))?;
    f.engine.execute(
        "a",
        &mutation(
            "uncomplete-second",
            Command::SetCompletion {
                path: child.clone(),
                expected_revision: None,
                completed: false,
                occurrence_date: Some(DAY.into()),
            },
        ),
    )?;
    f.files.state.lock().map_err(|_| "state")?.fail_stage_path =
        Some("Tasks/P 2026-10-05.md".into());
    f.engine
        .execute("a", &f.finish("concrete-pending", &child, 0)?)?;
    let first = failures(&f, 1, Value::Null, Value::Null)?;
    assert_eq!(first["items"][0]["item"]["kind"], "materialize_occurrence");
    assert!(!first["nextCursor"].is_null());
    let second = failures(&f, 1, first["nextCursor"].clone(), first["version"].clone())?;
    assert_eq!(second["items"][0]["item"]["kind"], "deferred_progression");
    let last = failures(
        &f,
        1,
        second["nextCursor"].clone(),
        second["version"].clone(),
    )?;
    assert!(last["nextCursor"].is_null());
    for page in [&first, &second, &last] {
        println!("GENERATION_FAILURES_SCHEMA {page}");
    }
    let before_requests = f.counts()?;
    for request in [
        json!({"kind":"occurrence_generation_failures","limit":0}),
        json!({"kind":"occurrence_generation_failures","limit":257}),
        json!({"kind":"occurrence_generation_failures","limit":1.5}),
        json!({"kind":"occurrence_generation_failures","extra":true}),
        json!({"kind":"occurrence_generation_failures","after":first["nextCursor"]}),
        json!({"kind":"occurrence_generation_failures","after":{ "lastId": "unknown", "version":first["version"], "binding":first["nextCursor"]["binding"]},"expectedVersion":first["version"]}),
        json!({"kind":"occurrence_generation_failures","after":{ "lastId": first["nextCursor"]["lastId"], "version":first["version"], "binding":"a".repeat(64)},"expectedVersion":first["version"]}),
    ] {
        assert!(f.feature(&request).is_err());
    }
    assert_eq!(f.counts()?, before_requests);
    let parent = f.bytes(PARENT)?;
    let foreign = [parent, b"\nIndependent body edit\n".to_vec()].concat();
    f.files.seed("a", PARENT, &foreign)?;
    let db = rusqlite::Connection::open(&f.database)?;
    let raw: String = db.query_row(
        "SELECT fingerprint FROM journals WHERE id='first-child'",
        [],
        |row| row.get(0),
    )?;
    drop(db);
    let replay: tasknotes_runtime::types::Mutation = serde_json::from_str(&raw)?;
    let counts = f.counts()?;
    let exchanges = f.exchanges()?;
    f.engine.execute("a", &replay)?;
    assert_eq!(
        f.outcome("concrete-pending")?["items"][0]["state"],
        "failed"
    );
    assert_eq!(f.counts()?, counts);
    assert_eq!(f.exchanges()?, exchanges);
    assert!(matches!(f.engine.features_json("a",&json!({"kind":"occurrence_generation_failures","limit":1,"after":first["nextCursor"],"expectedVersion":first["version"]}).to_string()),Err(RuntimeError::Conflict)));
    let updated = failures(&f, 1, Value::Null, Value::Null)?;
    assert!(updated["version"].as_u64() > first["version"].as_u64());
    Ok(())
}

#[test]
fn deferred_repair_stale_inputs_invalid_rules_and_changed_child_never_create_effects() -> Result {
    for mode in [
        "stale-parent",
        "stale-child",
        "resource",
        "invalid-rule",
        "uncompleted",
    ] {
        let f = Fixture::new()?;
        let child = f.series("on_completion", "scheduled", "completion")?;
        oversized(&f)?;
        f.engine
            .execute("a", &f.finish("rejected-origin", &child, 0)?)?;
        let original = deferred(&f, "rejected-origin")?;
        let id = original["successorId"].as_str().ok_or("failure")?;
        if mode == "uncompleted" {
            f.engine.execute(
                "a",
                &mutation(
                    "uncompleted-before-repair",
                    Command::SetCompletion {
                        path: child.clone(),
                        expected_revision: None,
                        completed: false,
                        occurrence_date: Some(DAY.into()),
                    },
                ),
            )?;
            parent_fields(&f, json!({"recurrence":"DTSTART:20261004;FREQ=DAILY"}))?;
        }
        if mode == "invalid-rule" {
            parent_fields(&f, json!({"recurrence":"FREQ=NONSENSE"}))?;
        }
        let request = repair(&f, "rejected-repair", id, &child)?;
        if mode.starts_with("stale") {
            let path = if mode == "stale-parent" {
                PARENT
            } else {
                &child
            };
            let bytes = [f.bytes(path)?, b"\nForeign body\n".to_vec()].concat();
            f.files.seed("a", path, &bytes)?;
        }
        let parent = f.bytes(PARENT)?;
        let child_bytes = f.bytes(&child)?;
        let counts = f.counts()?;
        let exchanges = f.exchanges()?;
        assert!(f.engine.execute("a", &request).is_err(), "{mode}");
        assert_eq!(f.bytes(PARENT)?, parent);
        assert_eq!(f.bytes(&child)?, child_bytes);
        assert_eq!(f.counts()?, counts);
        assert_eq!(f.exchanges()?, exchanges);
        assert_eq!(deferred(&f, "rejected-origin")?, original);
    }
    Ok(())
}

#[test]
fn deferred_policy_changes_cannot_waive_owed_parent_projection_but_can_waive_optional_successor()
-> Result {
    let f = Fixture::new()?;
    let child = f.series("on_completion", "scheduled", "completion")?;
    oversized(&f)?;
    f.engine
        .execute("a", &f.finish("policy-origin", &child, 0)?)?;
    let id = deferred(&f, "policy-origin")?["successorId"]
        .as_str()
        .ok_or("failure")?
        .to_owned();
    parent_fields(&f, json!({"occurrenceMaterialization":"manual"}))?;
    let before = f.bytes(PARENT)?;
    let counts = f.counts()?;
    assert!(
        matches!(f.engine.execute("a",&repair(&f,"unpaid-parent-debt",&id,&child)?),Err(RuntimeError::Validation(code)) if code=="occurrence_expansion_resource_limit")
    );
    assert_eq!(f.bytes(PARENT)?, before);
    assert_eq!(f.counts()?, counts);
    parent_fields(&f, json!({"recurrence":"DTSTART:20261004;FREQ=DAILY"}))?;
    f.engine
        .execute("a", &repair(&f, "paid-parent-debt", &id, &child)?)?;
    assert_eq!(
        f.values(PARENT)?.get("scheduled"),
        Some(&json!("2026-10-05"))
    );
    assert_eq!(
        deferred(&f, "policy-origin")?["resolution"]["kind"],
        "policy_no_successor"
    );
    assert_eq!(
        f.outcome("paid-parent-debt")?["items"]
            .as_array()
            .ok_or("items")?
            .as_slice(),
        Vec::<Value>::new().as_slice()
    );
    println!("DEFERRED_OUTCOME_SCHEMA {}", f.outcome("policy-origin")?);
    let f = Fixture::new()?;
    f.files.seed("a","tasknotes.yaml",b"status:\n  values: [open, done, deferred, cancelled]\n  default: open\n  completed_values: [done]\n  skipped_values: [deferred, cancelled]\n  default_skipped: cancelled\n")?;
    let child = f.series("on_completion", "scheduled", "completion_or_skip")?;
    oversized(&f)?;
    f.engine.execute(
        "a",
        &mutation(
            "skip-debt",
            Command::SetOccurrenceSkipped {
                path: child.clone(),
                expected_revision: None,
                occurrence_date: DAY.into(),
                skipped: true,
            },
        ),
    )?;
    let item = deferred(&f, "skip-debt")?;
    assert_eq!(item["childState"], "skipped");
    assert_eq!(item["parentProjectionOwed"], false);
    assert_eq!(item["successorDiscoveryOwed"], true);
    parent_fields(&f, json!({"occurrenceMaterialization":"manual"}))?;
    let before = f.bytes(PARENT)?;
    let skipped = f.bytes(&child)?;
    let id = item["successorId"].as_str().ok_or("skip failure")?;
    let receipt = f
        .engine
        .execute("a", &repair(&f, "waived-optional-future", id, &child)?)?;
    assert_eq!(receipt.paths, Vec::<String>::new());
    assert_eq!(f.bytes(PARENT)?, before);
    assert_eq!(f.bytes(&child)?, skipped);
    assert_eq!(
        deferred(&f, "skip-debt")?["resolution"]["kind"],
        "policy_no_successor"
    );
    println!("DEFERRED_OUTCOME_SCHEMA {}", f.outcome("skip-debt")?);
    Ok(())
}

#[test]
fn deferred_all_native_completion_routes_commit_identity_and_preserve_bytes_replay_and_group_undo()
-> Result {
    for parent_route in [false, true] {
        // Parent native completion routes are completion/toggle/status/editor;
        // generic Update(status) is a per-child compatibility route only.
        for route in 0..if parent_route { 4 } else { 5 } {
            let f = Fixture::new()?;
            let child = f.series("on_completion", "scheduled", "completion")?;
            oversized(&f)?;
            let parent = f.bytes(PARENT)?;
            let schedule = f.values(PARENT)?.get("scheduled").cloned();
            let initial = f.bytes(&child)?;
            let outbox = f.counts()?.1;
            let request = f.finish(
                "budgeted-completion",
                if parent_route { PARENT } else { &child },
                route,
            )?;
            let receipt = f.engine.execute("a", &request)?;
            assert!(receipt.applied);
            assert_eq!(f.values(&child)?.get("status"), Some(&json!("done")));
            assert_eq!(
                f.values(PARENT)?.get("completeInstances"),
                Some(&json!([DAY]))
            );
            assert_eq!(f.values(PARENT)?.get("scheduled").cloned(), schedule);
            let item = deferred(&f, "budgeted-completion")?;
            if !parent_route && route == 0 {
                println!(
                    "DEFERRED_OUTCOME_SCHEMA {}",
                    f.outcome("budgeted-completion")?
                );
            }
            assert_eq!(item["state"], "failed");
            assert_eq!(item["completedOccurrenceDate"], DAY);
            assert!(item["occurrenceDate"].is_null());
            assert_eq!(item["parentProjectionOwed"], true);
            assert_eq!(item["successorDiscoveryOwed"], true);
            assert_eq!(f.counts()?.1, outbox + 2);
            let exchanges = f.exchanges()?;
            let f = f.reopen()?;
            assert_eq!(
                serde_json::to_value(f.engine.execute("a", &request)?)?,
                serde_json::to_value(receipt)?
            );
            assert_eq!(f.exchanges()?, exchanges);
            assert_eq!(deferred(&f, "budgeted-completion")?, item);
            assert!(
                f.engine
                    .snapshot("a", &Query::default())?
                    .problems
                    .iter()
                    .any(|problem| problem
                        .message
                        .contains(item["successorId"].as_str().unwrap_or("missing")))
            );
            f.engine.execute(
                "a",
                &mutation(
                    "undo-budgeted",
                    Command::Undo {
                        receipt_id: "budgeted-completion".into(),
                    },
                ),
            )?;
            assert_eq!(f.bytes(PARENT)?, parent);
            assert_eq!(f.bytes(&child)?, initial);
            assert_eq!(deferred(&f, "budgeted-completion")?["state"], "cancelled");
            if !parent_route && route == 0 {
                println!(
                    "DEFERRED_OUTCOME_SCHEMA {}",
                    f.outcome("budgeted-completion")?
                );
            }
        }
    }
    Ok(())
}

#[test]
fn deferred_failure_activation_waits_for_primary_commit_and_recovers_each_exchange() -> Result {
    for boundary in [1, 2, 3] {
        let f = Fixture::new()?;
        let child = f.series("on_completion", "scheduled", "completion")?;
        oversized(&f)?;
        let request = f.finish("deferred-crash", &child, 0)?;
        let exchanges = f.exchanges()?;
        let db = rusqlite::Connection::open(&f.database)?;
        if boundary == 3 {
            db.execute_batch("CREATE TRIGGER stop_deferred_receipt BEFORE UPDATE OF receipt ON journals WHEN NEW.id='deferred-crash' AND NEW.receipt IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic commit stop'); END;")?;
        } else {
            f.files.state.lock().map_err(|_| "state")?.crash_at_exchange =
                Some(exchanges + boundary);
        }
        assert!(f.engine.execute("a", &request).is_err());
        assert_eq!(deferred(&f, "deferred-crash")?["state"], "staged");
        if boundary == 3 {
            println!("DEFERRED_OUTCOME_SCHEMA {}", f.outcome("deferred-crash")?);
        }
        if boundary == 3 {
            db.execute_batch("DROP TRIGGER stop_deferred_receipt;")?;
        }
        drop(db);
        let f = f.reopen()?;
        assert!(f.engine.execute("a", &request)?.applied);
        assert_eq!(deferred(&f, "deferred-crash")?["state"], "failed");
        assert_eq!(f.exchanges()?, exchanges + 2);
        assert_eq!(f.values(&child)?.get("status"), Some(&json!("done")));
        assert_eq!(
            f.values(PARENT)?.get("completeInstances"),
            Some(&json!([DAY]))
        );
    }
    Ok(())
}

#[test]
fn deferred_explicit_repair_uses_original_identity_clock_and_owns_only_its_successor() -> Result {
    let f = Fixture::new()?;
    let child = f.series("on_completion", "completion", "completion")?;
    oversized(&f)?;
    f.engine
        .execute("a", &f.finish("original-deferred", &child, 0)?)?;
    let failed = deferred(&f, "original-deferred")?;
    let failure = failed["successorId"].as_str().ok_or("failure")?.to_owned();
    let completed = f.bytes(&child)?;
    parent_fields(&f, json!({"recurrence":"DTSTART:20261004;FREQ=DAILY"}))?;
    let before = f.bytes(PARENT)?;
    let mut request = repair(&f, "repair-future", &failure, &child)?;
    request.at = "2030-04-20T12:34:56Z".into();
    let receipt = f.engine.execute("a", &request)?;
    assert!(receipt.applied);
    println!(
        "REPAIR_COMMAND_SCHEMA {}",
        serde_json::to_string(&request.command)?
    );
    assert_eq!(f.bytes(&child)?, completed);
    let repaired = deferred(&f, "original-deferred")?;
    assert_eq!(repaired["state"], "failed");
    assert_eq!(repaired["failure"], failed["failure"]);
    assert_eq!(repaired["resolution"]["kind"], "materialized");
    assert_eq!(repaired["resolution"]["futureDate"], "2026-10-05");
    println!(
        "DEFERRED_OUTCOME_SCHEMA {}",
        f.outcome("original-deferred")?
    );
    let next = f.next_path()?;
    let next_bytes = f.bytes(&next)?;
    let f = f.reopen()?;
    assert_eq!(
        serde_json::to_value(f.engine.execute("a", &request)?)?,
        serde_json::to_value(receipt)?
    );
    assert_eq!(f.bytes(&next)?, next_bytes);
    assert!(
        !f.engine
            .snapshot("a", &Query::default())?
            .problems
            .iter()
            .any(|problem| problem.message.contains(&failure))
    );
    assert!(matches!(
        f.engine.execute(
            "a",
            &mutation(
                "undo-old-first",
                Command::Undo {
                    receipt_id: "original-deferred".into()
                }
            )
        ),
        Err(RuntimeError::Conflict)
    ));
    f.engine.execute(
        "a",
        &mutation(
            "undo-repair",
            Command::Undo {
                receipt_id: "repair-future".into(),
            },
        ),
    )?;
    assert_eq!(f.bytes(PARENT)?, before);
    assert_eq!(f.bytes(&child)?, completed);
    assert!(f.files.get("a", &next)?.is_none());
    assert!(deferred(&f, "original-deferred")?["resolution"].is_null());
    assert!(
        f.engine
            .snapshot("a", &Query::default())?
            .problems
            .iter()
            .any(|problem| problem.message.contains(&failure))
    );
    Ok(())
}

#[test]
fn deferred_terminal_zero_file_repair_has_real_metadata_undo_and_failed_undo_is_not_cancellation()
-> Result {
    let f = Fixture::new()?;
    let child = f.series("manual", "scheduled", "completion")?;
    oversized(&f)?;
    f.engine
        .execute("a", &f.finish("terminal-origin", &child, 0)?)?;
    let failure = deferred(&f, "terminal-origin")?["successorId"]
        .as_str()
        .ok_or("failure")?
        .to_owned();
    parent_fields(
        &f,
        json!({"recurrence":"DTSTART:20261004;FREQ=DAILY;COUNT=1"}),
    )?;
    // Null is a requested removal in the production updater. Reconstruct a
    // genuine already-cleared schedule, rather than null-valued source keys.
    let document = tasknotes_vault::document::TaskDocument::parse(
        tasknotes_vault::path::VaultPath::parse(PARENT)?,
        &f.bytes(PARENT)?,
    )?;
    let cleared = document
        .plan(
            &[
                tasknotes_vault::document::PropertyEdit::Remove {
                    key: "scheduled".into(),
                },
                tasknotes_vault::document::PropertyEdit::Remove { key: "due".into() },
            ],
            None,
        )?
        .bytes;
    f.files.seed("a", PARENT, &cleared)?;
    let parent = f.bytes(PARENT)?;
    let completed = f.bytes(&child)?;
    let outbox = f.counts()?.1;
    let exchanges = f.exchanges()?;
    let request = repair(&f, "terminal-repair", &failure, &child)?;
    let receipt = f.engine.execute("a", &request)?;
    assert!(receipt.applied);
    assert_eq!(receipt.paths, Vec::<String>::new());
    assert_eq!(f.bytes(PARENT)?, parent);
    assert_eq!(f.bytes(&child)?, completed);
    assert_eq!(f.exchanges()?, exchanges);
    assert_eq!(f.counts()?.1, outbox);
    assert_eq!(
        deferred(&f, "terminal-origin")?["resolution"]["kind"],
        "exhausted"
    );
    println!("DEFERRED_OUTCOME_SCHEMA {}", f.outcome("terminal-origin")?);
    assert_eq!(
        f.feature(&json!({"kind":"undo_available"}))?["receiptId"],
        "terminal-repair"
    );
    let db = rusqlite::Connection::open(&f.database)?;
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM journal_files WHERE id='terminal-repair'",
            [],
            |row| row.get::<_, i64>(0)
        )?,
        0
    );
    db.execute_batch("CREATE TRIGGER reject_metadata_undo BEFORE UPDATE OF receipt ON journals WHEN NEW.id='undo-terminal' AND NEW.receipt IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic Undo commit stop'); END;")?;
    let undo = mutation(
        "undo-terminal",
        Command::Undo {
            receipt_id: "terminal-repair".into(),
        },
    );
    assert!(matches!(
        f.engine.execute("a", &undo),
        Err(RuntimeError::Storage(_))
    ));
    assert_eq!(
        deferred(&f, "terminal-origin")?["resolution"]["kind"],
        "exhausted"
    );
    db.execute_batch("DROP TRIGGER reject_metadata_undo;")?;
    drop(db);
    let f = f.reopen()?;
    f.engine.execute("a", &undo)?;
    assert!(deferred(&f, "terminal-origin")?["resolution"].is_null());
    assert_eq!(f.exchanges()?, exchanges);
    assert_eq!(f.counts()?.1, outbox);
    assert_eq!(f.bytes(PARENT)?, parent);
    assert_eq!(f.bytes(&child)?, completed);
    Ok(())
}

fn metadata_only_debt(f: &Fixture) -> Result<(String, String)> {
    f.files.seed("a","tasknotes.yaml",b"status:\n  values: [open, done, cancelled]\n  default: open\n  completed_values: [done]\n  skipped_values: [cancelled]\n  default_skipped: cancelled\n")?;
    let child = f.series("on_completion", "scheduled", "completion_or_skip")?;
    oversized(f)?;
    f.engine.execute(
        "a",
        &mutation(
            "metadata-origin",
            Command::SetOccurrenceSkipped {
                path: child.clone(),
                expected_revision: None,
                occurrence_date: DAY.into(),
                skipped: true,
            },
        ),
    )?;
    let id = deferred(f, "metadata-origin")?
        .get("successorId")
        .ok_or("failure ID")?
        .as_str()
        .ok_or("failure")?
        .to_owned();
    Ok((child, id))
}

#[test]
fn deferred_zero_file_newer_resolution_blocks_old_undo_and_invalidates_cached_versions() -> Result {
    let f = Fixture::new()?;
    let (child, id) = metadata_only_debt(&f)?;
    parent_fields(&f, json!({"occurrenceMaterialization":"manual"}))?;
    let page = failures(&f, 1, Value::Null, Value::Null)?;
    let parent = f.bytes(PARENT)?;
    let child_bytes = f.bytes(&child)?;
    let exchanges = f.exchanges()?;
    let outbox = f.counts()?.1;
    for name in ["metadata-first", "metadata-second"] {
        assert_eq!(
            f.engine
                .execute("a", &repair(&f, name, &id, &child)?)?
                .paths,
            Vec::<String>::new()
        );
    }
    let second = deferred(&f, "metadata-origin")?["resolution"].clone();
    assert_eq!(second["repairId"], "metadata-second");
    assert!(matches!(
        failures(&f, 1, Value::Null, page["version"].clone()),
        Err(error) if matches!(error.downcast_ref::<RuntimeError>(), Some(RuntimeError::Conflict))
    ));
    let resolved_page = failures(&f, 1, Value::Null, Value::Null)?;
    assert_eq!(
        resolved_page["items"].as_array().ok_or("items")?.as_slice(),
        Vec::<Value>::new().as_slice()
    );
    let before_rejected = f.counts()?;
    assert!(matches!(
        f.engine.execute(
            "a",
            &mutation(
                "reject-old-metadata-undo",
                Command::Undo {
                    receipt_id: "metadata-first".into()
                }
            )
        ),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(f.counts()?, before_rejected);
    assert_eq!(deferred(&f, "metadata-origin")?["resolution"], second);
    f.engine.execute(
        "a",
        &mutation(
            "undo-second-metadata",
            Command::Undo {
                receipt_id: "metadata-second".into(),
            },
        ),
    )?;
    assert_eq!(
        deferred(&f, "metadata-origin")?["resolution"]["repairId"],
        "metadata-first"
    );
    assert!(matches!(
        failures(&f, 1, Value::Null, resolved_page["version"].clone()),
        Err(error) if matches!(error.downcast_ref::<RuntimeError>(), Some(RuntimeError::Conflict))
    ));
    assert_eq!(
        failures(&f, 1, Value::Null, Value::Null)?["items"]
            .as_array()
            .ok_or("items")?
            .as_slice(),
        Vec::<Value>::new().as_slice()
    );
    f.engine.execute(
        "a",
        &mutation(
            "undo-first-metadata",
            Command::Undo {
                receipt_id: "metadata-first".into(),
            },
        ),
    )?;
    assert!(deferred(&f, "metadata-origin")?["resolution"].is_null());
    assert_eq!(
        failures(&f, 1, Value::Null, Value::Null)?["items"]
            .as_array()
            .ok_or("items")?
            .len(),
        1
    );
    assert_eq!(f.exchanges()?, exchanges);
    assert_eq!(f.counts()?.1, outbox);
    assert_eq!(f.bytes(PARENT)?, parent);
    assert_eq!(f.bytes(&child)?, child_bytes);
    Ok(())
}

#[test]
fn deferred_pending_repair_undo_cancels_before_recovery_and_preserves_independent_future() -> Result
{
    for independent in [false, true] {
        let f = Fixture::new()?;
        let child = f.series("on_completion", "scheduled", "completion")?;
        oversized(&f)?;
        f.engine
            .execute("a", &f.finish("pending-repair-origin", &child, 0)?)?;
        let failure = deferred(&f, "pending-repair-origin")?["successorId"]
            .as_str()
            .ok_or("failure")?
            .to_owned();
        parent_fields(&f, json!({"recurrence":"DTSTART:20261004;FREQ=DAILY"}))?;
        let parent = f.bytes(PARENT)?;
        let child_before = f.bytes(&child)?;
        let next = "Tasks/P 2026-10-05.md";
        f.files.state.lock().map_err(|_| "state")?.fail_stage_path = Some(next.into());
        f.engine
            .execute("a", &repair(&f, "pending-repair", &failure, &child)?)?;
        assert_eq!(f.outcome("pending-repair")?["items"][0]["state"], "pending");
        let calls = f
            .files
            .state
            .lock()
            .map_err(|_| "state")?
            .stage_begin_paths
            .iter()
            .filter(|path| path.as_str() == next)
            .count();
        let exchanges = f.exchanges()?;
        let outbox = f.counts()?.1;
        let future = if independent {
            Some(seed_independent_future(
                &f,
                &child,
                &child_before,
                next,
                &failure,
            )?)
        } else {
            None
        };
        // Refresh recovers pending work before indexing the independent file.
        // Its failed preparation is separate from the incoming Undo, which must
        // suppress all further preparation of its own unstarted successor.
        let calls_before_undo = f
            .files
            .state
            .lock()
            .map_err(|_| "state")?
            .stage_begin_paths
            .iter()
            .filter(|path| path.as_str() == next)
            .count();
        assert_eq!(calls_before_undo, calls + usize::from(independent));
        f.files.state.lock().map_err(|_| "state")?.fail_stage_path = None;
        f.engine.execute(
            "a",
            &mutation(
                "undo-pending-repair",
                Command::Undo {
                    receipt_id: "pending-repair".into(),
                },
            ),
        )?;
        assert_eq!(f.bytes(PARENT)?, parent);
        assert_eq!(f.bytes(&child)?, child_before);
        assert_eq!(f.files.get("a", next)?, future);
        assert_eq!(f.exchanges()?, exchanges + 1);
        assert_eq!(f.counts()?.1, outbox + 1);
        assert_eq!(
            f.files
                .state
                .lock()
                .map_err(|_| "state")?
                .stage_begin_paths
                .iter()
                .filter(|path| path.as_str() == next)
                .count(),
            calls_before_undo
        );
        assert!(deferred(&f, "pending-repair-origin")?["resolution"].is_null());
        assert!(
            f.engine
                .snapshot("a", &Query::default())?
                .problems
                .iter()
                .any(|problem| problem.message.contains(&failure))
        );
    }
    Ok(())
}

#[test]
fn deferred_repair_undo_rejects_foreign_successor_modification_without_metadata_loss() -> Result {
    let f = Fixture::new()?;
    let child = f.series("on_completion", "scheduled", "completion")?;
    oversized(&f)?;
    f.engine
        .execute("a", &f.finish("foreign-origin", &child, 0)?)?;
    let id = deferred(&f, "foreign-origin")?["successorId"]
        .as_str()
        .ok_or("failure")?
        .to_owned();
    parent_fields(&f, json!({"recurrence":"DTSTART:20261004;FREQ=DAILY"}))?;
    f.engine
        .execute("a", &repair(&f, "foreign-repair", &id, &child)?)?;
    let next = f.next_path()?;
    let foreign = [f.bytes(&next)?, b"\nForeign successor edit\n".to_vec()].concat();
    f.files.seed("a", &next, &foreign)?;
    let parent = f.bytes(PARENT)?;
    let state = deferred(&f, "foreign-origin")?;
    let counts = f.counts()?;
    let exchanges = f.exchanges()?;
    assert!(matches!(
        f.engine.execute(
            "a",
            &mutation(
                "foreign-undo",
                Command::Undo {
                    receipt_id: "foreign-repair".into()
                }
            )
        ),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(f.bytes(&next)?, foreign);
    assert_eq!(f.bytes(PARENT)?, parent);
    assert_eq!(deferred(&f, "foreign-origin")?, state);
    assert_eq!(f.counts()?, counts);
    assert_eq!(f.exchanges()?, exchanges);
    Ok(())
}

#[test]
fn deferred_schema15_migration_preserves_real_owned_rows_and_schema16_rejects_corruption() -> Result
{
    let f = Fixture::new()?;
    let child = f.series("manual", "scheduled", "completion")?;
    let child_bytes = f.bytes(&child)?;
    let counts = f.counts()?;
    let db = rusqlite::Connection::open(&f.database)?;
    super::super::remove_deferred_progressions_for_historical_fixture(&db)?;
    db.execute_batch("PRAGMA user_version=15;")?;
    let before = super::retained_tables(&db)?;
    drop(db);
    let f = f.reopen()?;
    let db = rusqlite::Connection::open(&f.database)?;
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))?,
        16
    );
    assert_eq!(super::retained_tables(&db)?, before);
    assert_eq!(f.bytes(&child)?, child_bytes);
    assert_eq!(f.counts()?, counts);
    drop(db);
    for corruption in [
        "DROP TABLE occurrence_deferred_progressions",
        "UPDATE occurrence_deferred_progressions SET intent=json_set(intent,'$.originAt','2027-01-01T00:00:00Z')",
        "UPDATE occurrence_deferred_progressions SET intent=json_set(intent,'$.parentRevision','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')",
        "DELETE FROM occurrence_progression_effects",
        "UPDATE occurrence_progression_effects SET sha256='corrupt'",
        "UPDATE occurrence_progression_resolutions SET sha256='corrupt'",
    ] {
        let f = Fixture::new()?;
        let child = f.series("on_completion", "scheduled", "completion")?;
        oversized(&f)?;
        f.engine
            .execute("a", &f.finish("corrupt-origin", &child, 0)?)?;
        let failure = deferred(&f, "corrupt-origin")?["successorId"]
            .as_str()
            .ok_or("failure")?
            .to_owned();
        parent_fields(&f, json!({"recurrence":"DTSTART:20261004;FREQ=DAILY"}))?;
        f.engine
            .execute("a", &repair(&f, "corrupt-repair", &failure, &child)?)?;
        let db = rusqlite::Connection::open(&f.database)?;
        db.execute_batch(corruption)?;
        drop(db);
        let Fixture {
            directory,
            database,
            files,
            engine,
        } = f;
        drop(engine);
        assert!(
            matches!(
                tasknotes_runtime::engine::Engine::open(&database, files),
                Err(RuntimeError::Storage(_))
            ),
            "{corruption}"
        );
        drop(directory);
    }
    Ok(())
}

#[test]
fn independent_materialized_completion_preserves_explicit_instant_anchor() -> Result {
    let mut actual = Vec::new();
    for parent_route in [false, true] {
        let f = Fixture::new()?;
        let child = f.series("manual", "completion", "completion")?;
        let target = if parent_route { PARENT } else { &child };
        let mut request = mutation(
            "independent-instant-complete",
            Command::SetCompletion {
                path: target.into(),
                expected_revision: Some(ContentRevision::of(&f.bytes(target)?).as_str().into()),
                completed: true,
                occurrence_date: Some("2026-10-04T23:30:00-07:00".into()),
            },
        );
        request.at = "2026-10-05T06:30:00Z".into();
        request.execution_context = Some(tasknotes_runtime::types::ExecutionContext {
            today: DAY.into(),
            timezone: "America/Los_Angeles".into(),
        });
        f.engine.execute("a", &request)?;
        let values = f.values(PARENT)?;
        println!(
            "INDEPENDENT_MATERIALIZED_ANCHOR parent={parent_route} {} scheduled={}",
            values["recurrence"], values["scheduled"]
        );
        actual.push(values["recurrence"].clone());
        assert_eq!(values["completeInstances"], json!([DAY]));
    }
    assert_eq!(
        actual,
        vec![json!("DTSTART:20261005T063000Z;FREQ=DAILY"); 2]
    );
    Ok(())
}

#[test]
fn independent_deferred_repair_preserves_original_explicit_instant_anchor() -> Result {
    let f = Fixture::new()?;
    let child = f.series("on_completion", "completion", "completion")?;
    oversized(&f)?;
    let mut request = f.finish("independent-deferred-instant", &child, 0)?;
    request.at = "2026-10-05T06:30:00Z".into();
    request.execution_context = Some(tasknotes_runtime::types::ExecutionContext {
        today: DAY.into(),
        timezone: "America/Los_Angeles".into(),
    });
    let Command::SetCompletion {
        occurrence_date, ..
    } = &mut request.command
    else {
        return Err("completion command".into());
    };
    *occurrence_date = Some("2026-10-04T23:30:00-07:00".into());
    f.engine.execute("a", &request)?;
    let f = f.reopen()?;
    let failure = deferred(&f, "independent-deferred-instant")?["successorId"]
        .as_str()
        .ok_or("failure id")?
        .to_owned();
    parent_fields(&f, json!({"recurrence":"DTSTART:20261004;FREQ=DAILY"}))?;
    let mut request = repair(&f, "independent-repair-instant", &failure, &child)?;
    request.at = "2030-04-20T12:34:56Z".into();
    f.engine.execute("a", &request)?;
    let values = f.values(PARENT)?;
    println!("INDEPENDENT_REPAIRED_ANCHOR {}", values["recurrence"]);
    assert_eq!(values["recurrence"], "DTSTART:20261005T063000Z;FREQ=DAILY");
    assert_eq!(values["completeInstances"], json!([DAY]));
    Ok(())
}

#[test]
fn independent_materialized_date_only_selection_keeps_date_only_completion_anchor() -> Result {
    let f = Fixture::new()?;
    let child = f.series("manual", "completion", "completion")?;
    let mut request = f.finish("independent-day-only", &child, 0)?;
    request.at = "2030-04-20T12:34:56Z".into();
    f.engine.execute("a", &request)?;
    let values = f.values(PARENT)?;
    assert_eq!(values["recurrence"], "DTSTART:20261004;FREQ=DAILY");
    assert_eq!(values["completeInstances"], json!([DAY]));
    Ok(())
}

fn explicit_selection_request(
    f: &Fixture,
    id: &str,
    path: &str,
    route: u8,
    selected: &str,
) -> Result<tasknotes_runtime::types::Mutation> {
    let mut request = f.finish(id, path, route)?;
    let (Command::SetCompletion {
        occurrence_date, ..
    }
    | Command::ToggleComplete {
        occurrence_date, ..
    }
    | Command::SetStatus {
        occurrence_date, ..
    }
    | Command::EditTask {
        occurrence_date, ..
    }) = &mut request.command
    else {
        return Err("explicit selection route".into());
    };
    *occurrence_date = Some(selected.into());
    request.at = "2030-04-20T12:34:56Z".into();
    request.execution_context = Some(tasknotes_runtime::types::ExecutionContext {
        today: "2030-04-20".into(),
        timezone: "America/Los_Angeles".into(),
    });
    Ok(request)
}

#[test]
fn explicit_materialized_routes_preserve_selected_instant_independently_of_mutation_clock() -> Result
{
    for anchor in ["completion", "scheduled"] {
        for parent_route in [false, true] {
            for route in 0..4 {
                let f = Fixture::new()?;
                let child = f.series("manual", anchor, "completion")?;
                let parent_before = f.bytes(PARENT)?;
                let child_before = f.bytes(&child)?;
                let path = if parent_route { PARENT } else { &child };
                let request = explicit_selection_request(
                    &f,
                    "selected-clock",
                    path,
                    route,
                    "2026-10-04T23:30:00.987654321-07:00",
                )?;
                let receipt = f.engine.execute("a", &request)?;
                let values = f.values(PARENT)?;
                let expected = if anchor == "completion" {
                    "DTSTART:20261005T063000Z;FREQ=DAILY"
                } else {
                    "DTSTART:20261001;FREQ=DAILY"
                };
                assert_eq!(values["recurrence"], expected);
                assert_eq!(values["completeInstances"], json!([DAY]));
                let exchanges = f.exchanges()?;
                let f = f.reopen()?;
                assert_eq!(
                    serde_json::to_value(f.engine.execute("a", &request)?)?,
                    serde_json::to_value(receipt)?
                );
                assert_eq!(f.exchanges()?, exchanges);
                f.engine.execute(
                    "a",
                    &mutation(
                        "undo-selected-clock",
                        Command::Undo {
                            receipt_id: "selected-clock".into(),
                        },
                    ),
                )?;
                assert_eq!(f.bytes(PARENT)?, parent_before);
                assert_eq!(f.bytes(&child)?, child_before);
            }
        }
    }
    Ok(())
}

#[test]
fn deferred_selected_instant_survives_each_crash_boundary_and_later_repair_clock() -> Result {
    for boundary in [1, 2, 3] {
        let f = Fixture::new()?;
        let child = f.series("on_completion", "completion", "completion")?;
        oversized(&f)?;
        let request = explicit_selection_request(
            &f,
            "selected-instant-crash",
            &child,
            0,
            "2026-10-04T23:30:00-07:00",
        )?;
        let exchanges = f.exchanges()?;
        let db = rusqlite::Connection::open(&f.database)?;
        if boundary == 3 {
            db.execute_batch("CREATE TRIGGER stop_selected_instant BEFORE UPDATE OF receipt ON journals WHEN NEW.id='selected-instant-crash' AND NEW.receipt IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic commit stop'); END;")?;
        } else {
            f.files.state.lock().map_err(|_| "state")?.crash_at_exchange =
                Some(exchanges + boundary);
        }
        assert!(f.engine.execute("a", &request).is_err());
        assert_eq!(deferred(&f, "selected-instant-crash")?["state"], "staged");
        if boundary == 3 {
            db.execute_batch("DROP TRIGGER stop_selected_instant;")?;
        }
        drop(db);
        let f = f.reopen()?;
        assert!(f.engine.execute("a", &request)?.applied);
        let original = deferred(&f, "selected-instant-crash")?;
        let failure = original["successorId"].as_str().ok_or("failure id")?;
        parent_fields(&f, json!({"recurrence":"DTSTART:20261004;FREQ=DAILY"}))?;
        let mut repair = repair(&f, "repair-selected-instant", failure, &child)?;
        repair.at = "2035-01-02T00:00:00Z".into();
        let receipt = f.engine.execute("a", &repair)?;
        assert_eq!(
            f.values(PARENT)?["recurrence"],
            "DTSTART:20261005T063000Z;FREQ=DAILY"
        );
        assert_eq!(f.values(PARENT)?["completeInstances"], json!([DAY]));
        assert_eq!(
            deferred(&f, "selected-instant-crash")?["failure"],
            original["failure"]
        );
        let exchanges = f.exchanges()?;
        let f = f.reopen()?;
        assert_eq!(
            serde_json::to_value(f.engine.execute("a", &repair)?)?,
            serde_json::to_value(receipt)?
        );
        assert_eq!(f.exchanges()?, exchanges);
    }
    Ok(())
}

#[test]
fn deferred_selected_instant_is_bound_to_immutable_selection_and_rejects_missing_or_changed_data()
-> Result {
    for corruption in [
        "json_remove(intent,'$.completionInstant')",
        "json_set(intent,'$.completionInstant',null)",
        "json_set(intent,'$.completionInstant','2026-10-05T06:31:00Z')",
        "json_set(intent,'$.completionInstant','2026-10-05T06:30:00+00:00')",
        "json_set(intent,'$.completionInstant','invalid')",
    ] {
        let f = Fixture::new()?;
        let child = f.series("manual", "completion", "completion")?;
        oversized(&f)?;
        f.engine.execute(
            "a",
            &explicit_selection_request(
                &f,
                "instant-corruption",
                &child,
                0,
                "2026-10-04T23:30:00-07:00",
            )?,
        )?;
        let db = rusqlite::Connection::open(&f.database)?;
        db.execute_batch(&format!(
            "UPDATE occurrence_deferred_progressions SET intent={corruption}"
        ))?;
        drop(db);
        let Fixture {
            directory,
            database,
            files,
            engine,
        } = f;
        drop(engine);
        assert!(
            matches!(
                tasknotes_runtime::engine::Engine::open(&database, files),
                Err(RuntimeError::Storage(_))
            ),
            "{corruption}"
        );
        drop(directory);
    }
    Ok(())
}

#[test]
fn atomic_deferred_selection_instants_reopen_with_their_own_primary_commands() -> Result {
    let f = Fixture::new()?;
    let first = f.series("manual", "completion", "completion")?;
    let mut materialize = f.request("second-child")?;
    let Command::MaterializeOccurrence {
        occurrence_date, ..
    } = &mut materialize.command
    else {
        return Err("materialize command".into());
    };
    *occurrence_date = "2026-10-05".into();
    let second = f
        .engine
        .execute("a", &materialize)?
        .task_path
        .ok_or("second child")?;
    oversized(&f)?;
    let mut request =
        explicit_selection_request(&f, "batch-instants", &first, 0, "2026-10-04T23:30:00-07:00")?;
    let other = explicit_selection_request(
        &f,
        "unused-inner-id",
        &second,
        0,
        "2026-10-05T23:30:00-07:00",
    )?;
    request.command = Command::Batch {
        commands: vec![request.command.clone(), other.command],
    };
    assert!(f.engine.execute("a", &request)?.applied);
    let f = f.reopen()?;
    let db = rusqlite::Connection::open(&f.database)?;
    let mut statement = db.prepare(
        "SELECT json_extract(intent,'$.completionInstant') FROM occurrence_deferred_progressions ORDER BY json_extract(intent,'$.occurrenceDate')",
    )?;
    let actual = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    assert_eq!(actual, vec!["2026-10-05T06:30:00Z", "2026-10-06T06:30:00Z"]);
    drop(statement);
    db.execute(
        "UPDATE occurrence_deferred_progressions SET intent=json_set(intent,'$.completionInstant','2026-10-05T06:31:00Z') WHERE json_extract(intent,'$.childPath')=?",
        [&first],
    )?;
    drop(db);
    let Fixture {
        directory,
        database,
        files,
        engine,
    } = f;
    drop(engine);
    assert!(matches!(
        tasknotes_runtime::engine::Engine::open(&database, files),
        Err(RuntimeError::Storage(_))
    ));
    drop(directory);
    Ok(())
}

#[test]
fn independent_baseline_two_deferred_children_of_one_parent_reopen() -> Result {
    let f = Fixture::new()?;
    let first = f.series("manual", "completion", "completion")?;
    let mut materialize = f.request("second-child")?;
    let Command::MaterializeOccurrence {
        occurrence_date, ..
    } = &mut materialize.command
    else {
        return Err("materialize command".into());
    };
    *occurrence_date = "2026-10-05".into();
    let second = f
        .engine
        .execute("a", &materialize)?
        .task_path
        .ok_or("second child")?;
    oversized(&f)?;
    let first = f.finish("unused-first", &first, 0)?;
    let mut second = f.finish("unused-second", &second, 0)?;
    let Command::SetCompletion {
        occurrence_date, ..
    } = &mut second.command
    else {
        return Err("completion command".into());
    };
    *occurrence_date = Some("2026-10-05".into());
    let request = mutation(
        "two-deferred-days",
        Command::Batch {
            commands: vec![first.command, second.command],
        },
    );
    assert!(f.engine.execute("a", &request)?.applied);
    let f = f.reopen()?;
    assert_eq!(
        f.values(PARENT)?["completeInstances"],
        json!([DAY, "2026-10-05"])
    );
    Ok(())
}

fn deferred_pair() -> Result<(
    Fixture,
    [String; 2],
    tasknotes_runtime::types::Mutation,
    Vec<u8>,
)> {
    let f = Fixture::new()?;
    let first = f.series("manual", "completion", "completion")?;
    let mut materialize = f.request("second-child")?;
    let Command::MaterializeOccurrence {
        occurrence_date, ..
    } = &mut materialize.command
    else {
        return Err("materialize command".into());
    };
    *occurrence_date = "2026-10-05".into();
    let second = f
        .engine
        .execute("a", &materialize)?
        .task_path
        .ok_or("second child")?;
    oversized(&f)?;
    let before = f.bytes(PARENT)?;
    let mut request =
        explicit_selection_request(&f, "pair", &first, 0, "2026-10-04T23:30:00-07:00")?;
    let other = explicit_selection_request(&f, "unused", &second, 0, "2026-10-05T23:30:00-07:00")?;
    request.command = Command::Batch {
        commands: vec![request.command.clone(), other.command],
    };
    f.engine.execute("a", &request)?;
    Ok((f.reopen()?, [first, second], request, before))
}

#[test]
fn grouped_deferred_primary_replay_and_undo_preserve_both_children() -> Result {
    let (f, children, request, before) = deferred_pair()?;
    let receipt = f.engine.execute("a", &request)?;
    let exchanges = f.exchanges()?;
    assert_eq!(
        serde_json::to_value(f.engine.execute("a", &request)?)?,
        serde_json::to_value(receipt)?
    );
    assert_eq!(f.exchanges()?, exchanges);
    f.engine.execute(
        "a",
        &mutation(
            "undo-pair",
            Command::Undo {
                receipt_id: "pair".into(),
            },
        ),
    )?;
    assert_eq!(f.bytes(PARENT)?, before);
    for child in children {
        assert_eq!(f.values(&child)?["status"], "open");
    }
    let f = f.reopen()?;
    for item in f.outcome("pair")?["items"].as_array().ok_or("items")? {
        assert_eq!(item["state"], "cancelled");
    }
    Ok(())
}

#[test]
fn grouped_deferred_repair_orders_preserve_membership_and_reject_anchor_rollback() -> Result {
    for newer_first in [false, true] {
        let (f, children, _, _) = deferred_pair()?;
        let outcome = f.outcome("pair")?;
        let ids = children
            .iter()
            .map(|child| {
                outcome["items"]
                    .as_array()
                    .ok_or("items")?
                    .iter()
                    .find(|item| item["childPath"] == *child)
                    .and_then(|item| item["successorId"].as_str())
                    .map(str::to_owned)
                    .ok_or("failure")
            })
            .collect::<std::result::Result<Vec<_>, _>>()?;
        parent_fields(&f, json!({"recurrence":"DTSTART:20261004;FREQ=DAILY"}))?;
        let first = usize::from(newer_first);
        let request = repair(&f, "repair-first", &ids[first], &children[first])?;
        let before_repair = f.bytes(PARENT)?;
        let receipt = f.engine.execute("a", &request)?;
        assert_pair_membership(&f)?;
        let f = f.reopen()?;
        let exchanges = f.exchanges()?;
        assert_eq!(
            serde_json::to_value(f.engine.execute("a", &request)?)?,
            serde_json::to_value(receipt)?
        );
        assert_eq!(f.exchanges()?, exchanges);
        let second = 1 - first;
        let request = repair(&f, "repair-second", &ids[second], &children[second])?;
        if newer_first {
            let before = f.bytes(PARENT)?;
            let history = f.outcome("pair")?;
            let counts = f.counts()?;
            assert!(matches!(
                f.engine.execute("a", &request),
                Err(RuntimeError::Conflict)
            ));
            assert_eq!(f.bytes(PARENT)?, before);
            assert_eq!(f.outcome("pair")?, history);
            assert_eq!(f.counts()?, counts);
            assert_eq!(f.exchanges()?, exchanges);
        } else {
            f.engine.execute("a", &request)?;
            assert_eq!(
                f.values(PARENT)?["recurrence"],
                "DTSTART:20261006T063000Z;FREQ=DAILY"
            );
            assert_pair_membership(&f)?;
            f.engine.execute(
                "a",
                &mutation(
                    "undo-second",
                    Command::Undo {
                        receipt_id: "repair-second".into(),
                    },
                ),
            )?;
            assert_eq!(
                f.values(PARENT)?["recurrence"],
                "DTSTART:20261005T063000Z;FREQ=DAILY"
            );
        }
        // Undo of the first repair restores its own before-image and failure;
        // the grouped completed children retain their primary ownership.
        if newer_first {
            f.engine.execute(
                "a",
                &mutation(
                    "undo-first",
                    Command::Undo {
                        receipt_id: "repair-first".into(),
                    },
                ),
            )?;
            assert_eq!(f.bytes(PARENT)?, before_repair);
        }
        let f = f.reopen()?;
        for child in &children {
            assert_eq!(f.values(child)?["status"], "done");
        }
        assert_pair_membership(&f)?;
        // Manual generation owns no future task; neither repair can acquire one.
        assert_eq!(f.engine.snapshot("a", &Query::default())?.tasks.len(), 3);
    }
    Ok(())
}

fn assert_pair_membership(f: &Fixture) -> Result {
    let mut days = f
        .values(PARENT)?
        .get("completeInstances")
        .ok_or("membership")?
        .as_array()
        .ok_or("membership")?
        .clone();
    days.sort_by(|left, right| left.as_str().cmp(&right.as_str()));
    assert_eq!(
        days,
        json!([DAY, "2026-10-05"]).as_array().ok_or("days")?.clone()
    );
    Ok(())
}

#[test]
fn grouped_deferred_input_and_publication_fences_reject_independent_corruption() -> Result {
    for corruption in [
        "json_remove(intent,'$.inputParentRevision')".to_owned(),
        format!(
            "json_set(intent,'$.inputParentRevision','{}')",
            "a".repeat(64)
        ),
        format!(
            "json_set(intent,'$.inputChildRevision','{}')",
            "b".repeat(64)
        ),
        format!("json_set(intent,'$.parentRevision','{}')", "c".repeat(64)),
        "json_set(intent,'$.parentProperties.title','changed')".to_owned(),
    ] {
        let (f, _, _, _) = deferred_pair()?;
        let db = rusqlite::Connection::open(&f.database)?;
        db.execute_batch(&format!(
            "UPDATE occurrence_deferred_progressions SET intent={corruption}"
        ))?;
        drop(db);
        let Fixture {
            directory,
            database,
            files,
            engine,
        } = f;
        drop(engine);
        assert!(
            matches!(
                tasknotes_runtime::engine::Engine::open(&database, files),
                Err(RuntimeError::Storage(_))
            ),
            "{corruption}"
        );
        drop(directory);
    }
    Ok(())
}
