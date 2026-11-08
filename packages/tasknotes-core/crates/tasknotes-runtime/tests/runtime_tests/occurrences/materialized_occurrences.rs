//! Real SQLite materialization, current provider bytes, recovery and ownership.
#[path = "deferred_progressions.rs"]
mod deferred_progressions;
#[path = "generation_sources.rs"]
mod generation_sources;
#[path = "rolling_occurrences.rs"]
mod rolling_occurrences;
use super::{
    Arc, Command, Engine, Memory, ProfileKind, Query, RuntimeError, json, mutation, profile,
};
use serde_json::{Map, Value};
use tasknotes_vault::{
    document::{ContentRevision, TaskDocument},
    links,
    path::VaultPath,
};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[test]
fn materialized_closed_feature_requests_reject_unknown_or_incomplete_inputs_without_effects()
-> Result {
    let f = Fixture::new()?;
    let counts = f.counts()?;
    for request in [
        json!({"kind":"occurrence_successors"}),
        json!({"kind":"occurrence_successors","mutationId":12}),
        json!({"kind":"occurrence_successors","mutationId":"a","unknown":true}),
        json!({"kind":"occurrence_successors","mutationId":"a","schemaVersion":2}),
        json!({"kind":"occurrence_successors","mutationId":""}),
        json!({"kind":"occurrence_successors","mutationId":"a".repeat(257)}),
    ] {
        assert!(f.engine.features_json("a", &request.to_string()).is_err());
    }
    assert_eq!(
        f.feature(
            &json!({"schemaVersion":1,"kind":"occurrence_successors","mutationId":"no-successor"})
        )?,
        json!({"schemaVersion":1,"mutationId":"no-successor","items":[]})
    );
    let command = Command::SetCompletion {
        path: PARENT.into(),
        expected_revision: None,
        completed: true,
        occurrence_date: Some(DAY.into()),
    };
    assert!(
        matches!(f.engine.execute("a",&mutation("oversized-followup-bound",Command::Batch {commands:vec![command;1001]})),Err(RuntimeError::Validation(message)) if message=="batch requires 1..1000 ordinary commands")
    );
    assert_eq!(f.counts()?, counts);
    assert_eq!(f.exchanges()?, 0);
    Ok(())
}
const PARENT: &str = "Projects/P.md";
const DAY: &str = "2026-10-04";

#[test]
fn materialized_negative_setters_preserve_unrelated_states_bytes_and_undo_owner() -> Result {
    for parent_route in [false, true] {
        for (status, unskip) in [
            ("done", true),
            ("deferred", false),
            ("waiting", true),
            ("waiting", false),
            ("open", true),
            ("open", false),
        ] {
            negative_setter_noop(parent_route, status, unskip)?;
        }
    }
    Ok(())
}

fn workflow_fixture() -> Result<Fixture> {
    let f = Fixture::new()?;
    f.files.seed("a", "tasknotes.yaml", b"status:\n  values: [open, done, deferred, waiting]\n  default: open\n  completed_values: [done]\n  skipped_values: [deferred]\n  default_skipped: deferred\n")?;
    Ok(f)
}

fn negative_request(
    f: &Fixture,
    child: &str,
    parent_route: bool,
    unskip: bool,
    id: &str,
) -> Result<tasknotes_runtime::types::Mutation> {
    let path = if parent_route { PARENT } else { child };
    let expected_revision = Some(ContentRevision::of(&f.bytes(path)?).as_str().into());
    Ok(mutation(
        id,
        if unskip {
            Command::SetOccurrenceSkipped {
                path: path.into(),
                expected_revision,
                occurrence_date: DAY.into(),
                skipped: false,
            }
        } else {
            Command::SetCompletion {
                path: path.into(),
                expected_revision,
                occurrence_date: Some(DAY.into()),
                completed: false,
            }
        },
    ))
}

fn negative_setter_noop(parent_route: bool, status: &str, unskip: bool) -> Result {
    let f = workflow_fixture()?;
    let child = f.series("manual", "scheduled", "completion")?;
    let initial_child = f.bytes(&child)?;
    let initial_parent = f.bytes(PARENT)?;
    if status != "open" {
        f.engine.execute(
            "a",
            &mutation(
                "setup-state",
                Command::SetStatus {
                    path: child.clone(),
                    expected_revision: Some(ContentRevision::of(&initial_child).as_str().into()),
                    status: status.into(),
                    occurrence_date: Some(DAY.into()),
                },
            ),
        )?;
    }
    let child_before = f.bytes(&child)?;
    let parent_before = f.bytes(PARENT)?;
    let owner = f.feature(&json!({"kind":"undo_available"}))?;
    let outbox = f.counts()?.1;
    let exchanges = f.exchanges()?;
    let request = negative_request(&f, &child, parent_route, unskip, "noop-negative")?;
    let receipt = f.engine.execute("a", &request)?;
    assert!(receipt.applied);
    assert_eq!(receipt.paths, Vec::<String>::new());
    assert_eq!(receipt.task_path.as_deref(), Some(child.as_str()));
    assert_eq!(f.bytes(&child)?, child_before);
    assert_eq!(f.bytes(PARENT)?, parent_before);
    assert_eq!(f.values(&child)?.get("status"), Some(&json!(status)));
    assert_eq!(f.counts()?.1, outbox);
    assert_eq!(f.exchanges()?, exchanges);
    assert_eq!(f.feature(&json!({"kind":"undo_available"}))?, owner);
    let f = f.reopen()?;
    assert_eq!(
        serde_json::to_value(f.engine.execute("a", &request)?)?,
        serde_json::to_value(receipt)?
    );
    f.engine.execute(
        "a",
        &negative_request(&f, &child, parent_route, unskip, "fresh-noop-negative")?,
    )?;
    assert_eq!(f.bytes(&child)?, child_before);
    assert_eq!(f.bytes(PARENT)?, parent_before);
    assert_eq!(f.counts()?.1, outbox);
    assert_eq!(f.exchanges()?, exchanges);
    assert_eq!(f.feature(&json!({"kind":"undo_available"}))?, owner);
    if status != "open" {
        f.engine.execute(
            "a",
            &mutation(
                "undo-setup-state",
                Command::Undo {
                    receipt_id: "setup-state".into(),
                },
            ),
        )?;
        assert_eq!(f.bytes(&child)?, initial_child);
        assert_eq!(f.bytes(PARENT)?, initial_parent);
    }
    Ok(())
}

#[test]
fn materialized_negative_setters_repair_only_conflicting_parent_membership() -> Result {
    for parent_route in [false, true] {
        for (status, unskip) in [("done", true), ("deferred", false), ("waiting", true)] {
            let f = workflow_fixture()?;
            let child = f.series("manual", "scheduled", "completion")?;
            f.engine.execute(
                "a",
                &mutation(
                    "state",
                    Command::SetStatus {
                        path: child.clone(),
                        expected_revision: None,
                        status: status.into(),
                        occurrence_date: Some(DAY.into()),
                    },
                ),
            )?;
            let child_before = f.bytes(&child)?;
            let document = TaskDocument::parse(VaultPath::parse(PARENT)?, &f.bytes(PARENT)?)?;
            let plan = document.plan(
                &[
                    tasknotes_vault::document::PropertyEdit::Set {
                        key: "complete_instances".into(),
                        value: json!(["2026-10-02", DAY, "2026-10-06"]),
                    },
                    tasknotes_vault::document::PropertyEdit::Set {
                        key: "skipped_instances".into(),
                        value: json!([DAY, "2026-10-07"]),
                    },
                ],
                None,
            )?;
            f.files.seed("a", PARENT, &plan.bytes)?;
            let exchanges = f.exchanges()?;
            let outbox = f.counts()?.1;
            f.engine.execute(
                "a",
                &negative_request(&f, &child, parent_route, unskip, "repair-negative")?,
            )?;
            assert_eq!(f.bytes(&child)?, child_before);
            let parent = f.values(PARENT)?;
            let completed = parent["completeInstances"]
                .as_array()
                .ok_or("completed list")?;
            let skipped = parent["skippedInstances"]
                .as_array()
                .ok_or("skipped list")?;
            assert_eq!(completed.contains(&json!(DAY)), status == "done");
            assert_eq!(skipped.contains(&json!(DAY)), status == "deferred");
            assert!(
                completed.contains(&json!("2026-10-02"))
                    && completed.contains(&json!("2026-10-06"))
            );
            assert!(skipped.contains(&json!("2026-10-07")));
            assert_eq!(f.counts()?.1, outbox + 1);
            assert_eq!(f.exchanges()?, exchanges + 1);
            assert_eq!(f.outcome("repair-negative")?["items"], json!([]));
            let parent_bytes = f.bytes(PARENT)?;
            f.engine.execute(
                "a",
                &negative_request(&f, &child, parent_route, unskip, "consistent-negative")?,
            )?;
            assert_eq!(f.bytes(PARENT)?, parent_bytes);
            assert_eq!(f.exchanges()?, exchanges + 1);
        }
    }
    Ok(())
}

#[test]
fn materialized_group_undo_after_host_recovery_never_starts_cancelled_successor() -> Result {
    for crash_undo in [false, true] {
        undo_recovered_unstarted_successor(crash_undo)?;
    }
    Ok(())
}

fn undo_recovered_unstarted_successor(crash_undo: bool) -> Result {
    let f = Fixture::new()?;
    let child = f.series("on_completion", "scheduled", "completion")?;
    let parent_before = f.bytes(PARENT)?;
    let child_before = f.bytes(&child)?;
    let next = "Tasks/P 2026-10-05.md";
    f.files
        .state
        .lock()
        .map_err(|_| "state lock")?
        .fail_stage_path = Some(next.into());
    f.engine
        .execute("a", &f.finish("pending-primary", &child, 0)?)?;
    assert_eq!(
        f.outcome("pending-primary")?.pointer("/items/0/state"),
        Some(&json!("pending"))
    );
    let before = f.exchanges()?;
    let outbox = f.counts()?.1;
    let next_calls = f
        .files
        .state
        .lock()
        .map_err(|_| "state lock")?
        .stage_begin_paths
        .iter()
        .filter(|path| path.as_str() == next)
        .count();
    f.files
        .state
        .lock()
        .map_err(|_| "state lock")?
        .fail_stage_path = None;
    let f = f.reopen()?;
    let request = mutation(
        "cancel-primary",
        Command::Undo {
            receipt_id: "pending-primary".into(),
        },
    );
    if crash_undo {
        f.files
            .state
            .lock()
            .map_err(|_| "state lock")?
            .crash_at_exchange = Some(before + 1);
        assert!(matches!(
            f.engine.execute("a", &request),
            Err(RuntimeError::Host(_))
        ));
    }
    let f = f.reopen()?;
    let receipt = f.engine.execute("a", &request)?;
    assert!(receipt.applied);
    assert_eq!(
        f.outcome("pending-primary")?.pointer("/items/0/state"),
        Some(&json!("cancelled"))
    );
    assert_eq!(f.exchanges()?, before + 2);
    assert_eq!(f.counts()?.1, outbox + 2);
    assert_eq!(f.bytes(&child)?, child_before);
    assert_eq!(f.bytes(PARENT)?, parent_before);
    assert!(f.files.get("a", next)?.is_none());
    assert_eq!(
        f.files
            .state
            .lock()
            .map_err(|_| "state lock")?
            .stage_begin_paths
            .iter()
            .filter(|path| path.as_str() == next)
            .count(),
        next_calls
    );
    let f = f.reopen()?;
    assert_eq!(
        serde_json::to_value(f.engine.execute("a", &request)?)?,
        serde_json::to_value(receipt)?
    );
    f.engine.refresh("a")?;
    assert!(f.files.get("a", next)?.is_none());
    assert_eq!(f.exchanges()?, before + 2);
    assert_eq!(f.counts()?.1, outbox + 2);
    Ok(())
}

#[test]
fn materialized_negative_setters_preserve_consistent_list_order_and_reject_other_corruption()
-> Result {
    for parent_route in [false, true] {
        let f = workflow_fixture()?;
        let child = f.series("manual", "scheduled", "completion")?;
        f.engine.execute("a", &f.finish("done", &child, 0)?)?;
        let parent = TaskDocument::parse(VaultPath::parse(PARENT)?, &f.bytes(PARENT)?)?;
        let edits = [tasknotes_vault::document::PropertyEdit::Set {
            key: "complete_instances".into(),
            value: json!(["2026-10-02", DAY, "2026-10-06"]),
        }];
        let ordered = parent.plan(&edits, None)?.bytes;
        f.files.seed("a", PARENT, &ordered)?;
        let child_before = f.bytes(&child)?;
        let exchanges = f.exchanges()?;
        let outbox = f.counts()?.1;
        f.engine.execute(
            "a",
            &negative_request(&f, &child, parent_route, true, "ordered-noop")?,
        )?;
        assert_eq!(f.bytes(PARENT)?, ordered);
        assert_eq!(f.bytes(&child)?, child_before);
        assert_eq!(f.exchanges()?, exchanges);
        assert_eq!(f.counts()?.1, outbox);
        for corrupt in [
            json!([DAY, "not-a-date"]),
            json!([DAY, "2026-10-02", "2026-10-02"]),
            json!(17),
        ] {
            let parent = TaskDocument::parse(VaultPath::parse(PARENT)?, &ordered)?;
            let bad = parent
                .plan(
                    &[tasknotes_vault::document::PropertyEdit::Set {
                        key: "complete_instances".into(),
                        value: corrupt,
                    }],
                    None,
                )?
                .bytes;
            f.files.seed("a", PARENT, &bad)?;
            let counts = f.counts()?;
            assert!(matches!(
                f.engine.execute(
                    "a",
                    &negative_request(&f, &child, parent_route, true, "corrupt-noop")?
                ),
                Err(RuntimeError::Validation(_))
            ));
            assert_eq!(f.bytes(PARENT)?, bad);
            assert_eq!(f.bytes(&child)?, child_before);
            assert_eq!(f.counts()?, counts);
            assert_eq!(f.exchanges()?, exchanges);
        }
    }
    Ok(())
}

#[test]
fn materialized_group_undo_recovers_already_exchanged_successor_before_ownership_check() -> Result {
    let f = Fixture::new()?;
    let child = f.series("on_completion", "scheduled", "completion")?;
    let parent_before = f.bytes(PARENT)?;
    let child_before = f.bytes(&child)?;
    let crash = f.exchanges()? + 3;
    f.files
        .state
        .lock()
        .map_err(|_| "state lock")?
        .crash_at_exchange = Some(crash);
    f.engine
        .execute("a", &f.finish("exchanged-primary", &child, 0)?)?;
    assert_eq!(
        f.outcome("exchanged-primary")?["items"][0]["state"],
        "pending"
    );
    let f = f.reopen()?;
    f.engine.execute(
        "a",
        &mutation(
            "undo-exchanged-primary",
            Command::Undo {
                receipt_id: "exchanged-primary".into(),
            },
        ),
    )?;
    assert_eq!(f.bytes(&child)?, child_before);
    assert_eq!(f.bytes(PARENT)?, parent_before);
    assert!(f.files.get("a", "Tasks/P 2026-10-05.md")?.is_none());
    assert_eq!(
        f.outcome("exchanged-primary")?["items"][0]["state"],
        "cancelled"
    );
    assert_eq!(f.exchanges()?, 7);
    assert_eq!(f.counts()?.1, 7);
    Ok(())
}

#[test]
fn materialized_parent_editor_repair_keeps_series_fields_and_body_on_parent() -> Result {
    let f = Fixture::new()?;
    let child = f.series("manual", "scheduled", "completion")?;
    let child_before = f.bytes(&child)?;
    let parent = f.bytes(PARENT)?;
    let bad = String::from_utf8(parent)?
        .replace("scheduled: 2026-10-01", "scheduled: broken")
        .into_bytes();
    f.files.seed("a", PARENT, &bad)?;
    let request = mutation(
        "parent-edited",
        Command::EditTask {
            path: PARENT.into(),
            expected_revision: Some(ContentRevision::of(&bad).as_str().into()),
            properties: serde_json::from_value(
                json!({"scheduled":DAY,"due":"2026-10-05","recurrence":"FREQ=DAILY;INTERVAL=2","priority":"high","vendorSeries":{"owned":true}}),
            )?,
            body: Some("Parent edited body\r\n".into()),
            status: Some("done".into()),
            occurrence_date: None,
        },
    );
    let receipt = f.engine.execute("a", &request)?;
    assert_eq!(receipt.task_path.as_deref(), Some(child.as_str()));
    assert_eq!(f.values(&child)?.get("status"), Some(&json!("done")));
    assert_eq!(f.values(&child)?.get("priority"), Some(&json!("normal")));
    assert!(!f.values(&child)?.contains_key("vendorSeries"));
    assert_eq!(
        TaskDocument::parse(VaultPath::parse(&child)?, &f.bytes(&child)?)?.body(),
        TaskDocument::parse(VaultPath::parse(&child)?, &child_before)?.body()
    );
    let parent_values = f.values(PARENT)?;
    assert_eq!(
        parent_values.get("recurrence"),
        Some(&json!("DTSTART:20261004;FREQ=DAILY;INTERVAL=2"))
    );
    assert_eq!(parent_values.get("scheduled"), Some(&json!("2026-10-06")));
    assert_eq!(parent_values.get("due"), Some(&json!("2026-10-07")));
    assert_eq!(
        parent_values.get("vendorSeries"),
        Some(&json!({"owned":true}))
    );
    assert_eq!(parent_values.get("status"), Some(&json!("open")));
    assert!(f.bytes(PARENT)?.ends_with(b"Parent edited body\r\n"));
    Ok(())
}

#[test]
fn materialized_editor_filename_moves_preserve_reference_edits_completion_and_group_undo() -> Result
{
    for move_parent in [false, true] {
        let f = Fixture::new()?;
        f.files.seed(
            "a",
            tasknotes_vault::config::PLUGIN_CONFIGURATION_PATH,
            br#"{"tasksFolder":"Tasks","storeTitleInFilename":true,"taskFilenameFormat":"title"}"#,
        )?;
        let child = f.series("on_completion", "scheduled", "completion")?;
        f.files.seed(
            "a",
            "References.md",
            format!("Reference [[/{child}]] and [[/{PARENT}]]\n").as_bytes(),
        )?;
        let child_before = f.bytes(&child)?;
        let parent_before = f.bytes(PARENT)?;
        let references = f.bytes("References.md")?;
        let target = if move_parent { PARENT } else { child.as_str() };
        let request = mutation(
            "move-and-complete",
            Command::EditTask {
                path: target.into(),
                expected_revision: Some(ContentRevision::of(&f.bytes(target)?).as_str().into()),
                properties: serde_json::from_value(json!({"title":"Renamed task"}))?,
                body: Some("Only selected owner body\n".into()),
                status: Some("done".into()),
                occurrence_date: Some(DAY.into()),
            },
        );
        let receipt = f.engine.execute("a", &request)?;
        let result = receipt.task_path.as_deref().ok_or("child result")?;
        let moved = if move_parent {
            "Projects/Renamed task.md"
        } else {
            "Tasks/Renamed task.md"
        };
        assert!(f.files.get("a", target)?.is_none());
        assert!(f.files.get("a", moved)?.is_some());
        assert_eq!(f.values(result)?.get("status"), Some(&json!("done")));
        let parent_result = if move_parent { moved } else { PARENT };
        assert_eq!(
            f.values(parent_result)?.get("completeInstances"),
            Some(&json!([DAY]))
        );
        assert_eq!(
            links::resolve(
                &json!({"raw":f.values(result)?.get("recurrenceParent"),"sourcePath":result,"candidates":[parent_result]})
            )?,
            parent_result
        );
        assert_eq!(
            f.outcome("move-and-complete")?["items"][0]["state"],
            "applied"
        );
        f.engine.execute(
            "a",
            &mutation(
                "undo-move-and-complete",
                Command::Undo {
                    receipt_id: "move-and-complete".into(),
                },
            ),
        )?;
        assert_eq!(f.bytes(&child)?, child_before);
        assert_eq!(f.bytes(PARENT)?, parent_before);
        assert_eq!(f.bytes("References.md")?, references);
        assert!(f.files.get("a", moved)?.is_none());
    }
    Ok(())
}

#[test]
fn materialized_datetime_selection_keeps_identity_clock_and_explicit_instant_anchor() -> Result {
    for route in 0..4 {
        let f = Fixture::new()?;
        let child = f.series("manual", "completion", "completion")?;
        let mut request = f.finish("datetime-child", &child, route)?;
        match &mut request.command {
            Command::SetCompletion {
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
            } => *occurrence_date = Some("2026-10-05T00:30:00Z".into()),
            _ => return Err("unknown route".into()),
        }
        request.execution_context = Some(tasknotes_runtime::types::ExecutionContext {
            today: "2026-10-03".into(),
            timezone: "America/Los_Angeles".into(),
        });
        let receipt = f.engine.execute("a", &request)?;
        assert_eq!(
            f.values(&child)?.get("completedDate"),
            Some(&json!("2026-10-03"))
        );
        assert_eq!(
            f.values(PARENT)?.get("recurrence"),
            Some(&json!("DTSTART:20261005T003000Z;FREQ=DAILY"))
        );
        let exchanges = f.exchanges()?;
        let f = f.reopen()?;
        assert_eq!(
            serde_json::to_value(f.engine.execute("a", &request)?)?,
            serde_json::to_value(receipt)?
        );
        assert_eq!(f.exchanges()?, exchanges);
    }
    Ok(())
}
const ORIGINAL:&[u8]=b"\xef\xbb\xbf---\r\ntitle: P\r\nstatus: open\r\npriority: normal\r\ntags: [task]\r\nid: series-p # identity\r\nrecurrence: DTSTART:20261001;FREQ=DAILY\r\nscheduled: 2026-10-01\r\ndateCreated: 2026-10-01T00:00:00Z\r\ndateModified: 2026-10-01T00:00:00Z\r\nvendor: {nested: retained} # metadata\r\ntimeEntries: opaque-retired-data\r\n---\r\nParent body\r\n";

#[test]
fn materialized_native_completion_routes_use_child_day_and_preserve_completion_clock() -> Result {
    for route in 0..5 {
        let f = Fixture::new()?;
        let child = f.series("on_completion", "completion", "completion")?;
        let parent_before = f.bytes(PARENT)?;
        let receipt = f
            .engine
            .execute("a", &f.finish("native-finish", &child, route)?)?;
        assert!(receipt.applied);
        assert_eq!(receipt.task_path.as_deref(), Some(child.as_str()));
        let child_values = f.values(&child)?;
        let parent = f.values(PARENT)?;
        assert_eq!(child_values.get("status"), Some(&json!("done")));
        assert_eq!(
            child_values.get("completedDate"),
            Some(&json!("2026-10-03"))
        );
        assert_eq!(parent.get("completeInstances"), Some(&json!([DAY])));
        assert_eq!(
            parent.get("recurrence"),
            Some(&json!("DTSTART:20261004;FREQ=DAILY"))
        );
        assert_eq!(parent.get("status"), Some(&json!("open")));
        assert_eq!(
            parent.get("timeEntries"),
            Some(&json!("opaque-retired-data"))
        );
        assert!(f.bytes(PARENT)?.starts_with(b"\xef\xbb\xbf---\r\n"));
        assert!(parent_before.ends_with(b"Parent body\r\n"));
        let next = f.next_path()?;
        assert_ne!(next, child);
        assert_eq!(f.values(&next)?.get("status"), Some(&json!("open")));
        assert_eq!(f.outcome("native-finish")?["items"][0]["state"], "applied");
        assert_eq!(f.counts()?.1, 4);
        if route == 3 {
            assert_eq!(child_values.get("vendorChild"), Some(&json!({"keep":true})));
            assert!(f.bytes(&child)?.ends_with(b"Edited child body\r\n"));
        }
    }
    Ok(())
}

#[test]
fn materialized_parent_instance_route_uses_authoritative_child_and_repairs_target_lists() -> Result
{
    let f = Fixture::new()?;
    let child = f.series("manual", "scheduled", "completion")?;
    let parent = f.bytes(PARENT)?;
    let parent=[parent.strip_suffix(b"---\r\nParent body\r\n").ok_or("ending")?,b"complete_instances: [2026-10-04]\r\nskipped_instances: [2026-10-04]\r\n---\r\nParent body\r\n"].concat();
    f.files.seed("a", PARENT, &parent)?;
    let request = mutation(
        "parent-finish",
        Command::SetCompletion {
            path: PARENT.into(),
            expected_revision: Some(ContentRevision::of(&parent).as_str().into()),
            completed: true,
            occurrence_date: Some(DAY.into()),
        },
    );
    let receipt = f.engine.execute("a", &request)?;
    assert_eq!(receipt.task_path.as_deref(), Some(child.as_str()));
    assert_eq!(f.values(&child)?.get("status"), Some(&json!("done")));
    assert_eq!(
        f.values(PARENT)?.get("completeInstances"),
        Some(&json!([DAY]))
    );
    assert_eq!(f.values(PARENT)?.get("skippedInstances"), Some(&json!([])));
    assert_eq!(f.outcome("parent-finish")?["items"], json!([]));
    Ok(())
}

#[test]
fn materialized_completion_replay_and_group_undo_restore_owned_parent_child_and_next() -> Result {
    let f = Fixture::new()?;
    let child = f.series("on_completion", "completion", "completion")?;
    let before_child = f.bytes(&child)?;
    let before_parent = f.bytes(PARENT)?;
    let request = f.finish("finish", &child, 0)?;
    let receipt = f.engine.execute("a", &request)?;
    let next = f.next_path()?;
    let exchanges = f.exchanges()?;
    let counts = f.counts()?;
    let f = f.reopen()?;
    assert_eq!(
        serde_json::to_value(f.engine.execute("a", &request)?)?,
        serde_json::to_value(&receipt)?
    );
    assert_eq!(f.exchanges()?, exchanges);
    assert_eq!(f.counts()?, counts);
    assert_eq!(
        f.feature(&json!({"kind":"undo_available"}))?["receiptId"],
        "finish"
    );
    f.engine.execute(
        "a",
        &mutation(
            "undo-group",
            Command::Undo {
                receipt_id: "finish".into(),
            },
        ),
    )?;
    assert_eq!(f.bytes(&child)?, before_child);
    assert_eq!(f.bytes(PARENT)?, before_parent);
    assert!(f.files.get("a", &next)?.is_none());
    assert_eq!(f.outcome("finish")?["items"][0]["state"], "cancelled");
    println!("OCCURRENCE_SCHEMA {}", f.outcome("finish")?);
    assert_eq!(f.counts()?.1, 7);
    Ok(())
}

#[test]
fn materialized_transition_crash_recovery_covers_each_owned_exchange_without_duplicate_uploads()
-> Result {
    for boundary in 1..=3 {
        let f = Fixture::new()?;
        let child = f.series("on_completion", "completion", "completion")?;
        let request = f.finish("interrupted-finish", &child, 0)?;
        let crash = f.exchanges()? + boundary;
        f.files
            .state
            .lock()
            .map_err(|_| "state lock")?
            .crash_at_exchange = Some(crash);
        let result = f.engine.execute("a", &request);
        if boundary < 3 {
            assert!(matches!(result, Err(RuntimeError::Host(_))));
        } else {
            assert!(result?.applied);
            assert_eq!(
                f.outcome("interrupted-finish")?["items"][0]["state"],
                "pending"
            );
        }
        let f = f.reopen()?;
        f.engine.refresh("a")?;
        assert!(f.engine.execute("a", &request)?.applied);
        assert_eq!(f.exchanges()?, 4);
        assert_eq!(f.counts()?.1, 4);
        assert_eq!(
            f.outcome("interrupted-finish")?["items"][0]["state"],
            "applied"
        );
        let tasks = f.engine.snapshot("a", &Query::default())?.tasks;
        assert_eq!(
            tasks
                .iter()
                .filter(|task| task.properties.get("occurrenceDate") == Some(&json!("2026-10-05")))
                .count(),
            1
        );
    }
    Ok(())
}

#[test]
fn materialized_pending_next_failure_preserves_primary_and_group_undo_cancels_unstarted_work()
-> Result {
    let f = Fixture::new()?;
    let child = f.series("on_completion", "completion", "completion")?;
    let parent_before = f.bytes(PARENT)?;
    let child_before = f.bytes(&child)?;
    f.files
        .state
        .lock()
        .map_err(|_| "state lock")?
        .fail_stage_path = Some("Tasks/P 2026-10-05.md".into());
    let receipt = f
        .engine
        .execute("a", &f.finish("blocked-next", &child, 0)?)?;
    assert!(receipt.applied);
    assert_eq!(f.values(&child)?.get("status"), Some(&json!("done")));
    assert_eq!(f.outcome("blocked-next")?["items"][0]["state"], "pending");
    println!("OCCURRENCE_SCHEMA {}", f.outcome("blocked-next")?);
    assert_eq!(
        f.outcome("blocked-next")?["items"][0]["failure"]["code"],
        "host"
    );
    assert_eq!(
        f.feature(&json!({"kind":"sync_status"}))?["pendingMutationCount"],
        1
    );
    let snapshot = f.engine.snapshot("a", &Query::default())?;
    assert!(
        snapshot
            .problems
            .iter()
            .any(|problem| problem.path == PARENT
                && problem.message.contains("Primary completion was preserved"))
    );
    f.engine.execute(
        "a",
        &mutation(
            "undo-blocked-next",
            Command::Undo {
                receipt_id: "blocked-next".into(),
            },
        ),
    )?;
    assert_eq!(f.bytes(PARENT)?, parent_before);
    assert_eq!(f.bytes(&child)?, child_before);
    f.files
        .state
        .lock()
        .map_err(|_| "state lock")?
        .fail_stage_path = None;
    let f = f.reopen()?;
    f.engine.refresh("a")?;
    assert!(f.files.get("a", "Tasks/P 2026-10-05.md")?.is_none());
    assert_eq!(f.outcome("blocked-next")?["items"][0]["state"], "cancelled");
    Ok(())
}

#[test]
fn materialized_failed_next_planning_does_not_rollback_completion_or_replan_changed_template()
-> Result {
    let f = Fixture::new()?;
    let child = f.series("on_completion", "completion", "completion")?;
    let parent = f.bytes(PARENT)?;
    let changed = [
        parent
            .strip_suffix(b"---\r\nParent body\r\n")
            .ok_or("ending")?,
        b"occurrence_template: Templates/missing.md\r\n---\r\nParent body\r\n",
    ]
    .concat();
    f.files.seed("a", PARENT, &changed)?;
    f.files.seed("a","tasknotes.yaml",b"templating:\n  enabled: false\n  template_path: ''\n  failure_mode: error_abort\n  unknown_variable_policy: preserve\n")?;
    let receipt = f
        .engine
        .execute("a", &f.finish("template-failed-next", &child, 0)?)?;
    assert!(receipt.applied);
    assert_eq!(f.values(&child)?.get("status"), Some(&json!("done")));
    let outcome = f.outcome("template-failed-next")?;
    println!("OCCURRENCE_SCHEMA {outcome}");
    assert_eq!(outcome["items"][0]["state"], "failed");
    let before = f.exchanges()?;
    f.files.seed(
        "a",
        "Templates/missing.md",
        b"---\nstatus: open\n---\nLater template\n",
    )?;
    let f = f.reopen()?;
    f.engine.refresh("a")?;
    assert_eq!(f.exchanges()?, before);
    assert_eq!(f.outcome("template-failed-next")?, outcome);
    assert!(f.files.get("a", "Tasks/P 2026-10-05.md")?.is_none());
    Ok(())
}

#[test]
fn materialized_group_undo_rejects_foreign_successor_and_newer_mutation_without_effects() -> Result
{
    let f = Fixture::new()?;
    let child = f.series("on_completion", "scheduled", "completion")?;
    f.engine.execute("a", &f.finish("finished", &child, 0)?)?;
    let next = f.next_path()?;
    let next_before = f.bytes(&next)?;
    f.files.seed("a", &next, b"Foreign content\n")?;
    let exchanges = f.exchanges()?;
    assert!(matches!(
        f.engine.execute(
            "a",
            &mutation(
                "undo-foreign",
                Command::Undo {
                    receipt_id: "finished".into()
                }
            )
        ),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(f.exchanges()?, exchanges);
    assert_eq!(f.bytes(&next)?, b"Foreign content\n");
    f.files.seed("a", &next, &next_before)?;
    f.engine.execute(
        "a",
        &mutation(
            "newer-child-edit",
            Command::Update {
                path: child.clone(),
                expected_revision: Some(ContentRevision::of(&f.bytes(&child)?).as_str().into()),
                properties: serde_json::from_value(json!({"priority":"high"}))?,
                body: None,
            },
        ),
    )?;
    let exchanges = f.exchanges()?;
    assert!(matches!(
        f.engine.execute(
            "a",
            &mutation(
                "undo-older",
                Command::Undo {
                    receipt_id: "finished".into()
                }
            )
        ),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(f.exchanges()?, exchanges);
    Ok(())
}

#[test]
fn materialized_uncomplete_keeps_progression_and_later_notes_while_selection_mismatch_fails_before_effects()
-> Result {
    let f = Fixture::new()?;
    let child = f.series("on_completion", "completion", "completion")?;
    f.engine
        .execute("a", &f.finish("complete-once", &child, 0)?)?;
    let next = f.next_path()?;
    let next_bytes = f.bytes(&next)?;
    let request = mutation(
        "uncomplete",
        Command::SetCompletion {
            path: child.clone(),
            expected_revision: Some(ContentRevision::of(&f.bytes(&child)?).as_str().into()),
            completed: false,
            occurrence_date: Some(DAY.into()),
        },
    );
    f.engine.execute("a", &request)?;
    assert_eq!(f.values(&child)?.get("status"), Some(&json!("open")));
    assert!(!f.values(&child)?.contains_key("completedDate"));
    assert_eq!(f.values(PARENT)?.get("completeInstances"), Some(&json!([])));
    assert_eq!(
        f.values(PARENT)?.get("recurrence"),
        Some(&json!("DTSTART:20261004;FREQ=DAILY"))
    );
    assert_eq!(f.bytes(&next)?, next_bytes);
    let counts = f.counts()?;
    let exchanges = f.exchanges()?;
    let mismatch = mutation(
        "wrong-day",
        Command::SetCompletion {
            path: child.clone(),
            expected_revision: Some(ContentRevision::of(&f.bytes(&child)?).as_str().into()),
            completed: true,
            occurrence_date: Some("2026-10-05".into()),
        },
    );
    assert!(
        matches!(f.engine.execute("a",&mismatch),Err(RuntimeError::Validation(message)) if message=="occurrence_selection_mismatch")
    );
    assert_eq!(f.counts()?, counts);
    assert_eq!(f.exchanges()?, exchanges);
    Ok(())
}
struct Fixture {
    directory: tempfile::TempDir,
    database: String,
    files: Arc<Memory>,
    engine: Engine,
}

#[test]
fn materialized_parent_and_child_cas_preserve_foreign_bytes_and_never_activate_next() -> Result {
    for race_parent in [false, true] {
        let f = Fixture::new()?;
        let child = f.series("on_completion", "scheduled", "completion")?;
        let target = if race_parent {
            PARENT.to_owned()
        } else {
            child.clone()
        };
        let foreign = b"External competing bytes\n".to_vec();
        f.files
            .state
            .lock()
            .map_err(|_| "state lock")?
            .racing_before_compare_path = Some((target.clone(), foreign.clone()));
        assert!(matches!(
            f.engine
                .execute("a", &f.finish("cas-transition", &child, 0)?),
            Err(RuntimeError::Conflict)
        ));
        assert_eq!(f.bytes(&target)?, foreign);
        assert_eq!(f.counts()?.1, 1);
        assert_eq!(
            f.outcome("cas-transition")?["items"][0]["state"],
            "cancelled"
        );
        assert!(f.files.get("a", "Tasks/P 2026-10-05.md")?.is_none());
        let f = f.reopen()?;
        assert_eq!(f.bytes(&target)?, foreign);
        assert!(f.engine.snapshot("a", &Query::default())?.conflict_count > 0);
    }
    Ok(())
}

#[test]
fn materialized_schema13_migration_preserves_real_occurrence_journal_and_current16_rejects_bad_state()
-> Result {
    let f = Fixture::new()?;
    let child = f.series("manual", "scheduled", "completion")?;
    let before_child = f.bytes(&child)?;
    let db = rusqlite::Connection::open(&f.database)?;
    let occurrence_before: String = db.query_row(
        "SELECT json FROM occurrence_plans WHERE id='first-child'",
        [],
        |row| row.get(0),
    )?;
    super::remove_occurrence_windows_for_historical_fixture(&db)?;
    db.execute_batch("DROP TABLE occurrence_successors; DROP TABLE occurrence_transitions; PRAGMA user_version=13;")?;
    let before = retained_tables(&db)?;
    drop(db);
    let f = f.reopen()?;
    let db = rusqlite::Connection::open(&f.database)?;
    assert_eq!(retained_tables(&db)?, before);
    assert_eq!(
        db.query_row(
            "SELECT json FROM occurrence_plans WHERE id='first-child'",
            [],
            |row| row.get::<_, String>(0)
        )?,
        occurrence_before
    );
    assert_eq!(f.bytes(&child)?, before_child);
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))?,
        16
    );
    db.execute_batch("DROP TABLE occurrence_successors;")?;
    drop(db);
    let Fixture {
        directory,
        database,
        files,
        engine,
    } = f;
    drop(engine);
    assert!(matches!(
        Engine::open(&database, files),
        Err(RuntimeError::Storage(_))
    ));
    drop(directory);
    Ok(())
}

#[test]
fn materialized_current_schema_rejects_successor_owner_or_closed_state_corruption() -> Result {
    for corruption in [
        "UPDATE occurrence_successors SET state='pending'",
        "UPDATE occurrence_successors SET intent=json_set(intent,'$.command.occurrenceDate','2026-10-06')",
    ] {
        let f = Fixture::new()?;
        let child = f.series("on_completion", "scheduled", "completion")?;
        f.engine
            .execute("a", &f.finish("valid-followup", &child, 0)?)?;
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
            matches!(Engine::open(&database,files),Err(RuntimeError::Storage(message)) if message=="occurrence successor ownership is corrupt")
        );
        drop(directory);
    }
    Ok(())
}

#[test]
fn materialized_skip_and_unskip_honor_policy_and_never_delete_future_notes() -> Result {
    for trigger in ["completion", "completion_or_skip"] {
        let f = Fixture::new()?;
        f.files.seed("a","tasknotes.yaml",b"status:\n  values: [open, done, deferred, cancelled]\n  default: open\n  completed_values: [done]\n  skipped_values: [deferred, cancelled]\n  default_skipped: cancelled\n")?;
        let child = f.series("on_completion", "completion", trigger)?;
        let skip = mutation(
            "skip-child",
            Command::SetOccurrenceSkipped {
                path: child.clone(),
                expected_revision: Some(ContentRevision::of(&f.bytes(&child)?).as_str().into()),
                occurrence_date: DAY.into(),
                skipped: true,
            },
        );
        f.engine.execute("a", &skip)?;
        assert_eq!(f.values(&child)?.get("status"), Some(&json!("cancelled")));
        assert_eq!(
            f.values(PARENT)?.get("skippedInstances"),
            Some(&json!([DAY]))
        );
        assert_eq!(
            f.values(PARENT)?.get("recurrence"),
            Some(&json!("DTSTART:20261001;FREQ=DAILY"))
        );
        let next = if trigger == "completion_or_skip" {
            Some(f.next_path()?)
        } else {
            assert_eq!(f.outcome("skip-child")?["items"], json!([]));
            None
        };
        let unskip = mutation(
            "unskip-child",
            Command::SetOccurrenceSkipped {
                path: PARENT.into(),
                expected_revision: Some(ContentRevision::of(&f.bytes(PARENT)?).as_str().into()),
                occurrence_date: DAY.into(),
                skipped: false,
            },
        );
        f.engine.execute("a", &unskip)?;
        assert_eq!(f.values(&child)?.get("status"), Some(&json!("open")));
        assert_eq!(f.values(PARENT)?.get("skippedInstances"), Some(&json!([])));
        assert_eq!(f.values(PARENT)?.get("completeInstances"), Some(&json!([])));
        if let Some(next) = next {
            assert!(f.files.get("a", &next)?.is_some());
        }
    }
    let f = Fixture::new()?;
    let child = f.series("on_completion", "scheduled", "completion_or_skip")?;
    let before = f.counts()?;
    let exchanges = f.exchanges()?;
    let skip = mutation(
        "missing-skipped",
        Command::SetOccurrenceSkipped {
            path: child.clone(),
            expected_revision: Some(ContentRevision::of(&f.bytes(&child)?).as_str().into()),
            occurrence_date: DAY.into(),
            skipped: true,
        },
    );
    assert!(
        matches!(f.engine.execute("a",&skip),Err(RuntimeError::Validation(message)) if message=="missing_skipped_status")
    );
    assert_eq!(f.counts()?, before);
    assert_eq!(f.exchanges()?, exchanges);
    Ok(())
}

#[test]
fn materialized_successor_activation_is_atomic_with_primary_sqlite_receipt() -> Result {
    let f = Fixture::new()?;
    let child = f.series("on_completion", "completion", "completion")?;
    let request = f.finish("sqlite-barrier", &child, 0)?;
    let db = rusqlite::Connection::open(&f.database)?;
    db.execute_batch("CREATE TRIGGER reject_primary_receipt BEFORE UPDATE OF receipt ON journals WHEN NEW.id='sqlite-barrier' AND NEW.receipt IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic receipt transaction interruption'); END;")?;
    assert!(matches!(
        f.engine.execute("a", &request),
        Err(RuntimeError::Storage(_))
    ));
    assert_eq!(f.outcome("sqlite-barrier")?["items"][0]["state"], "staged");
    println!("OCCURRENCE_SCHEMA {}", f.outcome("sqlite-barrier")?);
    assert_eq!(f.counts()?.1, 1);
    assert!(f.files.get("a", "Tasks/P 2026-10-05.md")?.is_none());
    db.execute_batch("DROP TRIGGER reject_primary_receipt;")?;
    drop(db);
    let f = f.reopen()?;
    f.engine.refresh("a")?;
    assert!(f.engine.execute("a", &request)?.applied);
    assert_eq!(f.outcome("sqlite-barrier")?["items"][0]["state"], "applied");
    println!("OCCURRENCE_SCHEMA {}", f.outcome("sqlite-barrier")?);
    assert_eq!(f.counts()?.1, 4);
    assert_eq!(f.exchanges()?, 4);
    Ok(())
}

#[test]
fn materialized_pending_successor_recovery_keeps_original_template_bytes_with_current_configuration_projection()
-> Result {
    let f = Fixture::new()?;
    let child = f.series("on_completion", "scheduled", "completion")?;
    let parent = f.bytes(PARENT)?;
    f.files.seed(
        "a",
        PARENT,
        &[
            parent
                .strip_suffix(b"---\r\nParent body\r\n")
                .ok_or("ending")?,
            b"occurrence_template: Templates/Next.md\r\n---\r\nParent body\r\n",
        ]
        .concat(),
    )?;
    f.files.seed(
        "a",
        "Templates/Next.md",
        b"---\nstatus: open\n---\nOriginal next template\n",
    )?;
    f.files
        .state
        .lock()
        .map_err(|_| "state lock")?
        .fail_stage_path = Some("Tasks/P 2026-10-05.md".into());
    let request = f.finish("immutable-next", &child, 0)?;
    assert!(f.engine.execute("a", &request)?.applied);
    assert_eq!(f.outcome("immutable-next")?["items"][0]["state"], "pending");
    f.files.seed(
        "a",
        "Templates/Next.md",
        b"---\nstatus: done\n---\nChanged template after primary\n",
    )?;
    f.files.seed("a","tasknotes.yaml",b"status:\n  values: [open, in-progress, done]\n  default: in-progress\n  completed_values: [done]\n")?;
    f.files
        .state
        .lock()
        .map_err(|_| "state lock")?
        .fail_stage_path = None;
    let f = f.reopen()?;
    f.engine.execute("a", &request)?;
    let next = f.next_path()?;
    assert!(f.bytes(&next)?.ends_with(b"Original next template\n"));
    assert_eq!(f.values(&next)?.get("status"), Some(&json!("open")));
    assert_eq!(
        f.engine.snapshot("a", &Query::default())?.configuration["defaultStatus"],
        "in-progress"
    );
    assert_eq!(f.outcome("immutable-next")?["items"][0]["state"], "applied");
    Ok(())
}

#[test]
fn materialized_atomic_native_bulk_routes_share_parent_fence_and_group_successor_reuse() -> Result {
    let f = Fixture::new()?;
    let first = f.series("on_completion", "scheduled", "completion")?;
    let mut second = f.request("second-child")?;
    if let Command::MaterializeOccurrence {
        occurrence_date, ..
    } = &mut second.command
    {
        *occurrence_date = "2026-10-05".into();
    }
    let second = f
        .engine
        .execute("a", &second)?
        .task_path
        .ok_or("second child")?;
    let first_before = f.bytes(&first)?;
    let second_before = f.bytes(&second)?;
    let parent_before = f.bytes(PARENT)?;
    let duplicate_counts = f.counts()?;
    let exchanges = f.exchanges()?;
    let duplicate = vec![
        Command::SetCompletion {
            path: first.clone(),
            expected_revision: Some(ContentRevision::of(&first_before).as_str().into()),
            completed: true,
            occurrence_date: Some(DAY.into()),
        },
        Command::SetCompletion {
            path: PARENT.into(),
            expected_revision: None,
            completed: true,
            occurrence_date: Some(DAY.into()),
        },
    ];
    assert!(
        matches!(f.engine.execute("a",&mutation("duplicate-selection",Command::Batch {commands:duplicate})),Err(RuntimeError::Validation(message)) if message=="batch selects the same materialized occurrence more than once")
    );
    assert_eq!(f.counts()?, duplicate_counts);
    assert_eq!(f.exchanges()?, exchanges);
    let commands = vec![
        Command::Update {
            path: PARENT.into(),
            expected_revision: Some(ContentRevision::of(&parent_before).as_str().into()),
            properties: serde_json::from_value(json!({"vendorBatch":{"retained":true}}))?,
            body: None,
        },
        Command::SetCompletion {
            path: first.clone(),
            expected_revision: Some(ContentRevision::of(&first_before).as_str().into()),
            completed: true,
            occurrence_date: Some(DAY.into()),
        },
        Command::SetCompletion {
            path: second.clone(),
            expected_revision: Some(ContentRevision::of(&second_before).as_str().into()),
            completed: true,
            occurrence_date: Some("2026-10-05".into()),
        },
    ];
    let receipt = f
        .engine
        .execute("a", &mutation("bulk-native", Command::Batch { commands }))?;
    assert!(receipt.applied);
    assert_eq!(
        f.values(PARENT)?.get("vendorBatch"),
        Some(&json!({"retained":true}))
    );
    assert_eq!(
        f.values(PARENT)?.get("completeInstances"),
        Some(&json!([DAY, "2026-10-05"]))
    );
    let outcome = f.outcome("bulk-native")?;
    assert!(
        outcome["items"]
            .as_array()
            .ok_or("items")?
            .iter()
            .all(|item| item["state"] == "applied")
    );
    assert_eq!(f.values(&second)?.get("status"), Some(&json!("done")));
    f.engine.execute(
        "a",
        &mutation(
            "undo-bulk-native",
            Command::Undo {
                receipt_id: "bulk-native".into(),
            },
        ),
    )?;
    assert_eq!(f.bytes(&first)?, first_before);
    assert_eq!(f.bytes(&second)?, second_before);
    assert_eq!(f.bytes(PARENT)?, parent_before);
    let tasks = f.engine.snapshot("a", &Query::default())?.tasks;
    assert_eq!(
        tasks
            .iter()
            .filter(|task| task.properties.contains_key("occurrenceDate"))
            .count(),
        2
    );
    Ok(())
}
impl Fixture {
    fn series(&self, mode: &str, anchor: &str, trigger: &str) -> Result<String> {
        let suffix = format!(
            "recurrence_anchor: {anchor}\r\noccurrence_materialization: {mode}\r\noccurrence_next_trigger: {trigger}\r\n---\r\nParent body\r\n"
        );
        let bytes = [
            ORIGINAL
                .strip_suffix(b"---\r\nParent body\r\n")
                .ok_or("parent ending")?,
            suffix.as_bytes(),
        ]
        .concat();
        self.files.seed("a", PARENT, &bytes)?;
        self.engine.refresh("a")?;
        Ok(self
            .engine
            .execute("a", &self.request("first-child")?)?
            .task_path
            .ok_or("first child")?)
    }
    fn values(&self, path: &str) -> Result<Map<String, Value>> {
        let document = TaskDocument::parse(VaultPath::parse(path)?, &self.bytes(path)?)?;
        let config = tasknotes_vault::config::TaskNotesConfiguration::resolve(
            self.files
                .get("a", tasknotes_vault::config::PLUGIN_CONFIGURATION_PATH)?
                .as_deref(),
            self.files
                .get("a", tasknotes_vault::config::PORTABLE_CONFIGURATION_PATH)?
                .as_deref(),
            true,
        )?;
        Ok(config.mapping.normalize(document.frontmatter()))
    }
    fn finish(
        &self,
        id: &str,
        child: &str,
        route: u8,
    ) -> Result<tasknotes_runtime::types::Mutation> {
        let path = child.to_owned();
        let expected_revision = Some(ContentRevision::of(&self.bytes(child)?).as_str().to_owned());
        let occurrence_date = Some(DAY.to_owned());
        let command = match route {
            0 => Command::SetCompletion {
                path,
                expected_revision,
                occurrence_date,
                completed: true,
            },
            1 => Command::ToggleComplete {
                path,
                expected_revision,
                occurrence_date,
            },
            2 => Command::SetStatus {
                path,
                expected_revision,
                occurrence_date,
                status: "done".into(),
            },
            3 => Command::EditTask {
                path,
                expected_revision,
                occurrence_date,
                status: Some("done".into()),
                properties: serde_json::from_value(
                    json!({"priority":"high","vendorChild":{"keep":true}}),
                )?,
                body: Some("Edited child body\r\n".into()),
            },
            4 => Command::Update {
                path,
                expected_revision,
                properties: serde_json::from_value(json!({"status":"done"}))?,
                body: None,
            },
            _ => return Err("unknown route".into()),
        };
        Ok(mutation(id, command))
    }
    fn outcome(&self, id: &str) -> Result<Value> {
        self.feature(&json!({"kind":"occurrence_successors","mutationId":id}))
    }
    fn next_path(&self) -> Result<String> {
        let tasks = self.engine.snapshot("a", &Query::default())?.tasks;
        tasks
            .into_iter()
            .find(|task| task.properties.get("occurrenceDate") == Some(&json!("2026-10-05")))
            .map(|task| task.path)
            .ok_or_else(|| "successor task".into())
    }
    fn new() -> Result<Self> {
        let directory = tempfile::tempdir()?;
        let database = directory
            .path()
            .join("runtime.db")
            .to_str()
            .ok_or("database path")?
            .to_owned();
        let files = Arc::new(Memory::default());
        files.seed(
            "a",
            ".obsidian/plugins/tasknotes/data.json",
            br#"{"tasksFolder":"Tasks","storeTitleInFilename":false,"taskFilenameFormat":"title"}"#,
        )?;
        files.seed("a", PARENT, ORIGINAL)?;
        let engine = Engine::open(&database, files.clone())?;
        engine.register_profile(profile(ProfileKind::ObsidianSync))?;
        engine.refresh("a")?;
        Ok(Self {
            directory,
            database,
            files,
            engine,
        })
    }
    fn request(&self, id: &str) -> Result<tasknotes_runtime::types::Mutation> {
        Ok(mutation(
            id,
            Command::MaterializeOccurrence {
                parent_path: PARENT.into(),
                expected_parent_revision: ContentRevision::of(&self.bytes(PARENT)?).as_str().into(),
                occurrence_date: DAY.into(),
                expected_occurrence_revision: None,
                properties: Map::new(),
                body: Some("Child body\r\n".into()),
            },
        ))
    }
    fn bytes(&self, path: &str) -> Result<Vec<u8>> {
        self.files
            .get("a", path)?
            .ok_or_else(|| "missing test file".into())
    }
    fn feature(&self, value: &Value) -> Result<Value> {
        Ok(serde_json::from_str(
            &self.engine.features_json("a", &value.to_string())?,
        )?)
    }
    fn exchanges(&self) -> Result<u64> {
        Ok(self
            .files
            .state
            .lock()
            .map_err(|_| "test state lock")?
            .exchanges)
    }
    fn reopen(self) -> Result<Self> {
        let Self {
            directory,
            database,
            files,
            engine,
        } = self;
        drop(engine);
        let engine = Engine::open(&database, files.clone())?;
        Ok(Self {
            directory,
            database,
            files,
            engine,
        })
    }
    fn counts(&self) -> Result<(i64, i64, i64)> {
        let db = rusqlite::Connection::open(&self.database)?;
        Ok(db.query_row("SELECT (SELECT count(*) FROM journals),(SELECT count(*) FROM outbox),(SELECT count(*) FROM occurrence_plans)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?)
    }
}

#[test]
fn materialization_creates_reuses_replays_and_undoes_with_parent_bytes_intact() -> Result {
    let f = Fixture::new()?;
    let request = f.request("materialize")?;
    let receipt = f.engine.execute("a", &request)?;
    assert!(receipt.applied);
    let child = receipt
        .task_path
        .as_deref()
        .ok_or("primary child identity")?;
    let bytes = f.bytes(child)?;
    let document = TaskDocument::parse(VaultPath::parse(child)?, &bytes)?;
    assert_eq!(
        document.frontmatter().get("recurrence_parent"),
        Some(&json!(format!("[[/{PARENT}]]")))
    );
    assert_eq!(
        document.frontmatter().get("occurrence_date"),
        Some(&json!(DAY))
    );
    assert_eq!(document.frontmatter().get("scheduled"), Some(&json!(DAY)));
    assert_eq!(document.frontmatter().get("status"), Some(&json!("open")));
    assert_eq!(document.body(), "Child body\r\n");
    assert!(!document.frontmatter().contains_key("recurrence"));
    assert_eq!(f.bytes(PARENT)?, ORIGINAL);
    assert_eq!(f.counts()?, (1, 1, 1));
    let exchanges = f.exchanges()?;
    let child = child.to_owned();
    let replay_json = serde_json::to_value(&receipt)?;
    let f = f.reopen()?;
    assert_eq!(
        serde_json::to_value(f.engine.execute("a", &request)?)?,
        replay_json
    );
    assert_eq!(f.exchanges()?, exchanges);
    let reused = f.engine.execute("a", &f.request("reuse-new-mutation")?)?;
    assert_eq!(reused.task_path.as_deref(), Some(child.as_str()));
    assert_eq!(reused.paths, Vec::<String>::new());
    assert_eq!(f.bytes(&child)?, bytes);
    assert_eq!(f.exchanges()?, exchanges);
    assert_eq!(f.counts()?, (2, 1, 2));
    f.engine.execute(
        "a",
        &mutation(
            "undo-materialize",
            Command::Undo {
                receipt_id: "materialize".into(),
            },
        ),
    )?;
    assert!(f.files.get("a", &child)?.is_none());
    assert_eq!(f.bytes(PARENT)?, ORIGINAL);
    Ok(())
}

#[test]
fn occurrence_template_and_explicit_values_keep_requested_identity_and_precedence() -> Result {
    let f = Fixture::new()?;
    let parent = [
        ORIGINAL
            .strip_suffix(b"---\r\nParent body\r\n")
            .ok_or("parent ending")?,
        b"occurrence_template: Templates/Occurrence.md\r\n---\r\nParent body\r\n",
    ]
    .concat();
    f.files.seed("a", PARENT, &parent)?;
    f.files.seed("a","Templates/Occurrence.md",b"---\nrecurrence_parent: '[[/Wrong.md]]'\noccurrence_date: 2026-12-31\nstatus: in-progress\nscheduled: 2026-10-09\nvendor: {from: template}\n---\nTemplate {{title}}\n")?;
    f.engine.refresh("a")?;
    let receipt = f.engine.execute("a", &f.request("template")?)?;
    let child = receipt.task_path.as_deref().ok_or("child")?;
    let document = TaskDocument::parse(VaultPath::parse(child)?, &f.bytes(child)?)?;
    assert_eq!(
        document.frontmatter().get("recurrence_parent"),
        Some(&json!(format!("[[/{PARENT}]]")))
    );
    assert_eq!(
        document.frontmatter().get("occurrence_date"),
        Some(&json!(DAY))
    );
    assert_eq!(
        document.frontmatter().get("scheduled"),
        Some(&json!("2026-10-09"))
    );
    assert_eq!(
        document.frontmatter().get("status"),
        Some(&json!("in-progress"))
    );
    assert_eq!(
        document.frontmatter().get("vendor"),
        Some(&json!({"from":"template"}))
    );
    assert!(document.body().starts_with("Template "));
    assert_eq!(f.bytes(PARENT)?, parent);
    Ok(())
}

#[test]
fn inherited_relative_attachment_references_keep_the_same_binary_targets_in_order() -> Result {
    let f = Fixture::new()?;
    let parent=[ORIGINAL.strip_suffix(b"---\r\nParent body\r\n").ok_or("parent ending")?,b"attachments: ['[Photo](./media/photo.png)', './media/other.png']\r\n---\r\nParent body\r\n"].concat();
    f.files.seed("a", PARENT, &parent)?;
    for (path, bytes) in [
        ("Projects/media/photo.png", b"original-photo".as_slice()),
        ("Tasks/media/photo.png", b"different-photo".as_slice()),
        ("Projects/media/other.png", b"other".as_slice()),
    ] {
        f.files.seed("a", path, bytes)?;
    }
    f.engine.refresh("a")?;
    let receipt = f.engine.execute("a", &f.request("attachments")?)?;
    let child = receipt.task_path.as_deref().ok_or("child")?;
    let doc = TaskDocument::parse(VaultPath::parse(child)?, &f.bytes(child)?)?;
    let references = doc
        .frontmatter()
        .get("attachments")
        .and_then(Value::as_array)
        .ok_or("attachment list")?;
    let resolved = references
        .iter()
        .map(|r| links::resolve(&json!({"raw":r,"sourcePath":child,"candidates":[]})))
        .collect::<tasknotes_vault::Result<Vec<_>>>()?;
    assert_eq!(
        resolved,
        vec!["Projects/media/photo.png", "Projects/media/other.png"]
    );
    assert_eq!(f.bytes("Projects/media/photo.png")?, b"original-photo");
    assert_eq!(f.bytes("Tasks/media/photo.png")?, b"different-photo");
    assert_eq!(f.bytes(PARENT)?, parent);
    Ok(())
}

#[test]
fn stale_parent_child_and_duplicate_occurrence_fail_before_effects() -> Result {
    let f = Fixture::new()?;
    let mut stale = f.request("stale-parent")?;
    if let Command::MaterializeOccurrence {
        expected_parent_revision,
        ..
    } = &mut stale.command
    {
        *expected_parent_revision = "0".repeat(64);
    }
    assert!(matches!(
        f.engine.execute("a", &stale),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(f.counts()?, (0, 0, 0));
    assert_eq!(f.exchanges()?, 0);
    let receipt = f.engine.execute("a", &f.request("create-child")?)?;
    let child = receipt.task_path.as_deref().ok_or("child")?;
    let bytes = f.bytes(child)?;
    let before = f.counts()?;
    let exchanges = f.exchanges()?;
    let mut stale = f.request("stale-child")?;
    if let Command::MaterializeOccurrence {
        expected_occurrence_revision,
        ..
    } = &mut stale.command
    {
        *expected_occurrence_revision = Some("0".repeat(64));
    }
    assert!(matches!(
        f.engine.execute("a", &stale),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(f.counts()?, before);
    assert_eq!(f.exchanges()?, exchanges);
    f.files.seed("a", "Tasks/Duplicate.md", &bytes)?;
    assert!(
        matches!(f.engine.execute("a",&f.request("duplicate")?),Err(RuntimeError::Validation(code)) if code=="duplicate_occurrence_note")
    );
    assert_eq!(f.counts()?, before);
    assert_eq!(f.exchanges()?, exchanges);
    assert_eq!(f.bytes(child)?, bytes);
    Ok(())
}

#[test]
fn materialization_recovers_interrupted_publication_without_duplicate_child_or_upload() -> Result {
    let f = Fixture::new()?;
    let request = f.request("interrupted")?;
    f.files
        .state
        .lock()
        .map_err(|_| "state lock")?
        .crash_after_exchange = true;
    assert!(matches!(
        f.engine.execute("a", &request),
        Err(RuntimeError::Host(_))
    ));
    assert_eq!(f.counts()?, (1, 0, 1));
    let exchanges = f.exchanges()?;
    let f = f.reopen()?;
    let receipt = f.engine.execute("a", &request)?;
    assert!(receipt.applied);
    assert!(receipt.task_path.is_some());
    assert_eq!(f.counts()?, (1, 1, 1));
    assert_eq!(f.exchanges()?, exchanges);
    assert_eq!(f.bytes(PARENT)?, ORIGINAL);
    Ok(())
}

#[test]
fn persisted_parent_read_dependency_blocks_recovery_after_external_parent_change() -> Result {
    let f = Fixture::new()?;
    let request = f.request("parent-read-fence")?;
    f.files
        .state
        .lock()
        .map_err(|_| "state lock")?
        .crash_after_exchange = true;
    assert!(matches!(
        f.engine.execute("a", &request),
        Err(RuntimeError::Host(_))
    ));
    let changed = [ORIGINAL, b"Foreign parent edit\r\n"].concat();
    f.files.seed("a", PARENT, &changed)?;
    let f = f.reopen()?;
    assert!(matches!(
        f.engine.execute("a", &request),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(f.bytes(PARENT)?, changed);
    assert_eq!(
        f.feature(&json!({"kind":"mutation_receipt","mutationId":"parent-read-fence"}))?
            .get("state"),
        Some(&json!("parked"))
    );
    assert_eq!(
        f.feature(&json!({"kind":"sync_status"}))?
            .get("pendingUploadCount"),
        Some(&json!(0))
    );
    assert!(f.engine.snapshot("a", &Query::default())?.conflict_count > 0);
    Ok(())
}

#[test]
fn strict_recurring_writes_reject_invalid_rule_type_frequency_and_anchor() -> Result {
    let mut accepted = Vec::new();
    for (id, command) in [
        (
            "bad-frequency",
            Command::Create {
                path: Some("Tasks/Bad.md".into()),
                properties: serde_json::from_value(
                    json!({"title":"Bad","recurrence":"FREQ=NONSENSE","scheduled":DAY}),
                )?,
                body: None,
            },
        ),
        (
            "bad-type",
            Command::Update {
                path: PARENT.into(),
                expected_revision: Some(ContentRevision::of(ORIGINAL).as_str().into()),
                properties: serde_json::from_value(json!({"recurrence":17}))?,
                body: None,
            },
        ),
        (
            "bad-anchor",
            Command::EditTask {
                path: PARENT.into(),
                expected_revision: Some(ContentRevision::of(ORIGINAL).as_str().into()),
                properties: serde_json::from_value(json!({"recurrenceAnchor":"unknown"}))?,
                body: None,
                status: None,
                occurrence_date: None,
            },
        ),
    ] {
        let f = Fixture::new()?;
        match f.engine.execute("a", &mutation(id, command)) {
            Err(RuntimeError::Validation(_)) => {
                assert_eq!(f.exchanges()?, 0);
                assert_eq!(f.counts()?, (0, 0, 0));
                assert_eq!(f.bytes(PARENT)?, ORIGINAL);
            }
            other => accepted.push(format!("{id}: {other:?}")),
        }
    }
    assert!(
        accepted.is_empty(),
        "Strict recurrence prerequisite defects reproduced: {accepted:?}"
    );
    Ok(())
}

#[test]
fn mapped_recurrence_sources_cannot_hide_a_conflicting_canonical_role_before_writes() -> Result {
    for (physical, canonical) in [
        (
            "rule: DTSTART:20261001;FREQ=DAILY\r\n",
            "recurrence: 17\r\n",
        ),
        (
            "rule: DTSTART:20261001;FREQ=DAILY\r\nanchorRule: scheduled\r\n",
            "recurrenceAnchor: unknown\r\n",
        ),
    ] {
        let f = Fixture::new()?;
        f.files.seed("a",".obsidian/plugins/tasknotes/data.json",br#"{"tasksFolder":"Tasks","storeTitleInFilename":false,"taskFilenameFormat":"title","fieldMapping":{"recurrence":"rule","recurrenceAnchor":"anchorRule"}}"#)?;
        let parent = String::from_utf8(ORIGINAL.to_vec())?
            .replace("recurrence: DTSTART:20261001;FREQ=DAILY\r\n", "");
        let parent = parent
            .replace(
                "---\r\nParent body\r\n",
                &format!("{physical}{canonical}---\r\nParent body\r\n"),
            )
            .into_bytes();
        f.files.seed("a", PARENT, &parent)?;
        f.engine.refresh("a")?;
        let request = mutation(
            "conflicting-recurring-source",
            Command::Update {
                path: PARENT.into(),
                expected_revision: Some(ContentRevision::of(&parent).as_str().into()),
                properties: serde_json::from_value(json!({"priority":"high"}))?,
                body: None,
            },
        );
        assert!(
            matches!(f.engine.execute("a",&request),Err(RuntimeError::Validation(code)) if code=="ambiguous_recurrence_source")
        );
        assert_eq!(f.counts()?, (0, 0, 0));
        assert_eq!(f.exchanges()?, 0);
        assert_eq!(f.bytes(PARENT)?, parent);
    }
    Ok(())
}

fn retained_tables(
    db: &rusqlite::Connection,
) -> Result<std::collections::BTreeMap<String, Vec<Vec<rusqlite::types::Value>>>> {
    let names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('occurrence_plans','occurrence_successors','occurrence_transitions','occurrence_windows','occurrence_deferred_progressions','occurrence_progression_effects','occurrence_progression_resolutions') ORDER BY name")?
        .query_map([],|row|row.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    let mut tables = std::collections::BTreeMap::new();
    for name in names {
        if !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        {
            return Err("unsafe table identifier".into());
        }
        let mut query = db.prepare(&format!("SELECT * FROM {name} ORDER BY rowid"))?;
        let width = query.column_count();
        let rows = query
            .query_map([], |row| {
                (0..width)
                    .map(|i| row.get(i))
                    .collect::<rusqlite::Result<Vec<rusqlite::types::Value>>>()
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        tables.insert(name, rows);
    }
    Ok(tables)
}

#[test]
fn schema12_migration_retains_all_old_tables_receipts_outbox_and_undo() -> Result {
    let f = Fixture::new()?;
    let ordinary = mutation(
        "historical",
        Command::Update {
            path: PARENT.into(),
            expected_revision: Some(ContentRevision::of(ORIGINAL).as_str().into()),
            properties: serde_json::from_value(json!({"priority":"high"}))?,
            body: None,
        },
    );
    let receipt = f.engine.execute("a", &ordinary)?;
    let Fixture {
        directory,
        database,
        files,
        engine,
    } = f;
    drop(engine);
    let db = rusqlite::Connection::open(&database)?;
    // Remove only later empty ownership tables to reconstruct schema12.
    // layout while preserving real committed task, BLOB, outbox and journal rows.
    super::remove_occurrence_plans_for_historical_fixture(&db)?;
    db.execute_batch("PRAGMA user_version=12;")?;
    let before = retained_tables(&db)?;
    drop(db);
    let engine = Engine::open(&database, files.clone())?;
    let db = rusqlite::Connection::open(&database)?;
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?,
        16
    );
    assert_eq!(retained_tables(&db)?, before);
    assert_eq!(
        serde_json::to_value(engine.execute("a", &ordinary)?)?,
        serde_json::to_value(receipt)?
    );
    engine.execute(
        "a",
        &mutation(
            "historical-undo",
            Command::Undo {
                receipt_id: "historical".into(),
            },
        ),
    )?;
    assert_eq!(files.get("a", PARENT)?.as_deref(), Some(ORIGINAL));
    drop(engine);
    drop(directory);
    Ok(())
}

#[test]
fn current_schema13_rejects_missing_or_changed_occurrence_journal_ownership() -> Result {
    for corruption in [
        "DELETE FROM occurrence_plans",
        "UPDATE occurrence_plans SET json='{}'",
        "UPDATE occurrence_plans SET json=json_set(json,'$.taskPath','Tasks/Unrelated.md')",
        "DROP TABLE occurrence_plans",
    ] {
        let f = Fixture::new()?;
        f.engine.execute("a", &f.request("owner")?)?;
        let Fixture {
            directory,
            database,
            files,
            engine,
        } = f;
        drop(engine);
        let db = rusqlite::Connection::open(&database)?;
        db.execute_batch(corruption)?;
        drop(db);
        assert!(
            matches!(
                Engine::open(&database, files),
                Err(RuntimeError::Storage(_))
            ),
            "accepted corrupt occurrence ownership: {corruption}"
        );
        drop(directory);
    }
    Ok(())
}

#[test]
fn explicit_occurrence_contract_rejects_unsafe_identity_inputs_without_effects() -> Result {
    for (key, value) in [
        ("recurrenceParent", json!("[[/Other.md]]")),
        ("occurrence_date", json!("2026-12-31")),
        ("recurrence", json!("FREQ=DAILY")),
    ] {
        let f = Fixture::new()?;
        let mut request = f.request("reserved")?;
        if let Command::MaterializeOccurrence { properties, .. } = &mut request.command {
            properties.insert(key.into(), value);
        }
        assert!(matches!(
            f.engine.execute("a", &request),
            Err(RuntimeError::Validation(_))
        ));
        assert_eq!(f.counts()?, (0, 0, 0));
        assert_eq!(f.exchanges()?, 0);
    }
    let f = Fixture::new()?;
    let mut request = f.request("bad-wire")?;
    if let Command::MaterializeOccurrence {
        occurrence_date, ..
    } = &mut request.command
    {
        *occurrence_date = "2026-02-30".into();
    }
    assert!(matches!(
        f.engine.execute("a", &request),
        Err(RuntimeError::Validation(_))
    ));
    assert_eq!(f.counts()?, (0, 0, 0));
    assert_eq!(f.exchanges()?, 0);
    let mut wire = serde_json::to_value(f.request("wire")?)?;
    let roundtrip: tasknotes_runtime::types::Mutation = serde_json::from_value(wire.clone())?;
    roundtrip.command.validate_contract()?;
    wire["command"]["unknownField"] = json!(true);
    assert!(serde_json::from_value::<tasknotes_runtime::types::Mutation>(wire).is_err());
    Ok(())
}
