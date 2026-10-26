//! Current source identities for durable generation failures, never stale paths.
use super::rolling_occurrences::{NoProvider, parent_fields};
use super::{
    Command, ContentRevision, DAY, Engine, Fixture, PARENT, Result, RuntimeError, TaskDocument,
    VaultPath, json, mutation,
};
use serde_json::Value;

fn page(f: &Fixture) -> Result<Value> {
    f.feature(&json!({"kind":"occurrence_generation_failures"}))
}

fn missing_template(f: &Fixture) -> Result {
    parent_fields(f, json!({"occurrenceTemplate":"Templates/missing.md"}))?;
    f.files.seed("a", "tasknotes.yaml", b"templating:\n  enabled: false\n  template_path: ''\n  failure_mode: error_abort\n  unknown_variable_policy: preserve\n")?;
    f.engine.refresh("a")?;
    Ok(())
}

fn deferred_rule(f: &Fixture) -> Result {
    let list = vec!["0"; 101].join(",");
    parent_fields(
        f,
        json!({"recurrence":format!("DTSTART:20261004;FREQ=DAILY;COUNT=1;BYHOUR={list};BYMINUTE={list};BYSECOND={list}")}),
    )
}

fn remove(f: &Fixture, path: &str) -> Result {
    f.files
        .state
        .lock()
        .map_err(|_| "state")?
        .files
        .remove(&("a".into(), path.into()));
    Ok(())
}

fn second_child(f: &Fixture) -> Result<String> {
    let mut request = f.request("second-source")?;
    let Command::MaterializeOccurrence {
        occurrence_date, ..
    } = &mut request.command
    else {
        return Err("materialize command".into());
    };
    *occurrence_date = "2026-10-05".into();
    Ok(f.engine
        .execute("a", &request)?
        .task_path
        .ok_or("second child")?)
}

fn finish_day(f: &Fixture, path: &str, day: &str) -> Result<Command> {
    Ok(Command::SetCompletion {
        path: path.into(),
        expected_revision: Some(ContentRevision::of(&f.bytes(path)?).as_str().into()),
        completed: true,
        occurrence_date: Some(day.into()),
    })
}

#[test]
fn generation_sources_all_completion_routes_reopen_replay_and_use_source_day() -> Result {
    for route in 0..5 {
        let f = Fixture::new()?;
        let child = f.series("on_completion", "scheduled", "completion")?;
        missing_template(&f)?;
        let request = f.finish("source-completion", &child, route)?;
        assert!(f.engine.execute("a", &request)?.applied);
        let before = page(&f)?;
        assert_eq!(before["items"][0]["sourceTaskPaths"], json!([child]));
        assert_eq!(before["items"][0]["item"]["occurrenceDate"], "2026-10-05");
        assert_eq!(
            before["items"][0]["action"]["command"]["kind"],
            "materialize_occurrence"
        );
        let counts = f.counts()?;
        let exchanges = f.exchanges()?;
        let f = f.reopen()?;
        assert_eq!(page(&f)?, before);
        assert!(f.engine.execute("a", &request)?.applied);
        assert_eq!(page(&f)?, before);
        assert_eq!(f.counts()?, counts);
        assert_eq!(f.exchanges()?, exchanges);
    }
    Ok(())
}

#[test]
fn generation_sources_primary_title_move_and_parent_target_keep_canonical_child() -> Result {
    for parent_target in [false, true] {
        let f = Fixture::new()?;
        f.files.seed(
            "a",
            tasknotes_vault::config::PLUGIN_CONFIGURATION_PATH,
            br#"{"tasksFolder":"Tasks","storeTitleInFilename":true,"taskFilenameFormat":"title"}"#,
        )?;
        let child = f.series("on_completion", "scheduled", "completion")?;
        missing_template(&f)?;
        let request = if parent_target {
            mutation("source-title", finish_day(&f, PARENT, DAY)?)
        } else {
            mutation(
                "source-title",
                Command::EditTask {
                    path: child.clone(),
                    expected_revision: None,
                    properties: serde_json::from_value(json!({"title":"Moved occurrence"}))?,
                    body: None,
                    status: Some("done".into()),
                    occurrence_date: Some(DAY.into()),
                },
            )
        };
        let receipt = f.engine.execute("a", &request)?;
        let actual = receipt.task_path.ok_or("source child")?;
        assert_eq!(page(&f)?["items"][0]["sourceTaskPaths"], json!([actual]));
        if !parent_target {
            assert_ne!(actual, child);
        }
    }
    Ok(())
}

#[test]
fn generation_sources_rename_deletion_and_historical_path_reuse_never_select_unrelated_task()
-> Result {
    for deferred in [false, true] {
        let f = Fixture::new()?;
        let child = f.series("on_completion", "scheduled", "completion")?;
        if deferred {
            deferred_rule(&f)?;
        } else {
            missing_template(&f)?;
        }
        f.engine
            .execute("a", &f.finish("renamed-source", &child, 0)?)?;
        let renamed = "Tasks/Renamed source.md";
        f.files.seed("a", renamed, &f.bytes(&child)?)?;
        remove(&f, &child)?;
        f.files.seed("a", &child, b"---\ntitle: Unrelated replacement\ntags: [task]\nstatus: open\npriority: normal\n---\nReplacement body\n")?;
        f.engine.refresh("a")?;
        let renamed_page = page(&f)?;
        assert_eq!(
            renamed_page["items"][0]["sourceTaskPaths"],
            json!([renamed])
        );
        assert_ne!(renamed_page["items"][0]["sourceTaskPaths"], json!([child]));
        remove(&f, renamed)?;
        f.engine.refresh("a")?;
        assert_eq!(page(&f)?["items"][0]["sourceTaskPaths"], json!([]));
        assert_eq!(page(&f)?["items"][0]["item"]["parentPath"], PARENT);
    }
    Ok(())
}

#[test]
fn generation_sources_atomic_batches_are_sorted_series_scoped_and_deferred_source_scoped() -> Result
{
    for deferred in [false, true] {
        let f = Fixture::new()?;
        let first = f.series("on_completion", "scheduled", "completion")?;
        let second = second_child(&f)?;
        if deferred {
            deferred_rule(&f)?;
        } else {
            missing_template(&f)?;
        }
        let request = mutation(
            "source-batch",
            Command::Batch {
                commands: vec![
                    finish_day(&f, &second, "2026-10-05")?,
                    finish_day(&f, &first, DAY)?,
                ],
            },
        );
        assert!(f.engine.execute("a", &request)?.applied);
        let actual = page(&f)?;
        let rows = actual["items"].as_array().ok_or("rows")?;
        assert_eq!(rows.len(), if deferred { 2 } else { 1 });
        let mut expected = vec![first.clone(), second.clone()];
        expected.sort();
        for row in rows {
            if deferred {
                let source = if row["item"]["completedOccurrenceDate"] == DAY {
                    &first
                } else {
                    &second
                };
                assert_eq!(row["sourceTaskPaths"], json!([source]));
            } else {
                assert_eq!(row["sourceTaskPaths"], json!(expected));
            }
        }
        let f = f.reopen()?;
        assert_eq!(page(&f)?, actual);
    }
    Ok(())
}

#[test]
fn generation_sources_cross_parent_batch_never_leaks_another_series_child() -> Result {
    let f = Fixture::new()?;
    let first = f.series("on_completion", "scheduled", "completion")?;
    missing_template(&f)?;
    let second_parent = "Projects/Q.md";
    let second = "Tasks/Q occurrence.md";
    let bytes = String::from_utf8(f.bytes(PARENT)?)?
        .replace("title: P", "title: Q")
        .replace("series-p", "series-q");
    f.files.seed("a", second_parent, bytes.as_bytes())?;
    let document = TaskDocument::parse(VaultPath::parse(&first)?, &f.bytes(&first)?)?;
    let bytes = document
        .plan(
            &[tasknotes_vault::document::PropertyEdit::Set {
                key: "recurrence_parent".into(),
                value: json!(format!("[[/{second_parent}]]")),
            }],
            None,
        )?
        .bytes;
    f.files.seed("a", second, &bytes)?;
    f.engine.refresh("a")?;
    f.engine.execute(
        "a",
        &mutation(
            "cross-series",
            Command::Batch {
                commands: vec![finish_day(&f, &first, DAY)?, finish_day(&f, second, DAY)?],
            },
        ),
    )?;
    let actual = page(&f)?;
    let rows = actual["items"].as_array().ok_or("rows")?;
    assert_eq!(rows.len(), 2);
    for row in rows {
        let expected = if row["item"]["parentPath"] == PARENT {
            &first
        } else {
            second
        };
        assert_eq!(row["sourceTaskPaths"], json!([expected]));
    }
    Ok(())
}

#[test]
fn generation_sources_identical_primary_ids_are_isolated_by_profile() -> Result {
    let f = Fixture::new()?;
    let first = f.series("on_completion", "scheduled", "completion")?;
    missing_template(&f)?;
    let other_child = "Tasks/Other profile occurrence.md";
    for (path, bytes) in [
        (PARENT, f.bytes(PARENT)?),
        (other_child, f.bytes(&first)?),
        (
            tasknotes_vault::config::PLUGIN_CONFIGURATION_PATH,
            f.bytes(tasknotes_vault::config::PLUGIN_CONFIGURATION_PATH)?,
        ),
        ("tasknotes.yaml", f.bytes("tasknotes.yaml")?),
    ] {
        f.files.seed("b", path, &bytes)?;
    }
    let mut other = super::profile(super::ProfileKind::ObsidianSync);
    other.id = "b".into();
    f.engine.register_profile(other)?;
    f.engine.refresh("b")?;
    f.engine
        .execute("a", &f.finish("shared-source-id", &first, 0)?)?;
    f.engine.execute(
        "b",
        &mutation(
            "shared-source-id",
            Command::SetCompletion {
                path: other_child.into(),
                expected_revision: None,
                completed: true,
                occurrence_date: Some(DAY.into()),
            },
        ),
    )?;
    let other: Value = serde_json::from_str(
        &f.engine
            .features_json("b", r#"{"kind":"occurrence_generation_failures"}"#)?,
    )?;
    assert_eq!(other["items"][0]["sourceTaskPaths"], json!([other_child]));
    assert_eq!(page(&f)?["items"][0]["sourceTaskPaths"], json!([first]));
    Ok(())
}

#[test]
fn generation_sources_ambiguous_identity_is_typed_without_a_guessed_child() -> Result {
    for deferred in [false, true] {
        let f = Fixture::new()?;
        let child = f.series("on_completion", "scheduled", "completion")?;
        if deferred {
            deferred_rule(&f)?;
        } else {
            missing_template(&f)?;
        }
        f.engine
            .execute("a", &f.finish("ambiguous-source", &child, 0)?)?;
        f.files.seed("a", "Tasks/Duplicate.md", &f.bytes(&child)?)?;
        f.engine.refresh("a")?;
        let actual = page(&f)?;
        assert_eq!(actual["items"][0]["sourceTaskPaths"], json!([]));
        assert_eq!(
            actual["items"][0]["action"],
            json!({"kind":"unrepairable","reason":"changed_or_ambiguous_identity"})
        );
    }
    Ok(())
}

#[test]
fn generation_sources_repair_and_undo_keep_original_completion_and_ownership_separate() -> Result {
    let f = Fixture::new()?;
    let child = f.series("on_completion", "scheduled", "completion")?;
    missing_template(&f)?;
    f.engine
        .execute("a", &f.finish("source-primary", &child, 0)?)?;
    let completed_bytes = f.bytes(&child)?;
    f.files.seed(
        "a",
        "Templates/missing.md",
        b"---\nstatus: open\n---\nRepair template\n",
    )?;
    f.engine.refresh("a")?;
    let current = page(&f)?;
    let command: Command =
        serde_json::from_value(current["items"][0]["action"]["command"].clone())?;
    f.engine.execute("a", &mutation("source-repair", command))?;
    assert_eq!(page(&f)?["items"], json!([]));
    f.engine.execute(
        "a",
        &mutation(
            "undo-source-repair",
            Command::Undo {
                receipt_id: "source-repair".into(),
            },
        ),
    )?;
    assert_eq!(f.bytes(&child)?, completed_bytes);
    assert_eq!(page(&f)?["items"][0]["sourceTaskPaths"], json!([child]));
    f.engine.execute(
        "a",
        &mutation(
            "undo-source-primary",
            Command::Undo {
                receipt_id: "source-primary".into(),
            },
        ),
    )?;
    assert_eq!(f.values(&child)?.get("status"), Some(&json!("open")));
    assert_eq!(page(&f)?["items"], json!([]));
    Ok(())
}

#[test]
fn generation_sources_missing_corrupt_and_unrelated_fences_fail_loudly() -> Result {
    for corruption in [
        "DELETE FROM occurrence_transitions WHERE id='owned-source'",
        "UPDATE occurrence_transitions SET json='[]' WHERE id='owned-source'",
        "UPDATE occurrence_transitions SET json=json_set(json,'$[0].parentResultPath','Projects/Other.md') WHERE id='owned-source'",
        "UPDATE occurrence_transitions SET json=json_set(json,'$[0].occurrenceDate','not-a-day') WHERE id='owned-source'",
    ] {
        let f = Fixture::new()?;
        let child = f.series("on_completion", "scheduled", "completion")?;
        missing_template(&f)?;
        f.engine
            .execute("a", &f.finish("owned-source", &child, 0)?)?;
        rusqlite::Connection::open(&f.database)?.execute_batch(corruption)?;
        assert!(
            matches!(
                f.engine
                    .features_json("a", r#"{"kind":"occurrence_generation_failures"}"#),
                Err(RuntimeError::Storage(_))
            ),
            "{corruption}"
        );
    }
    Ok(())
}

#[test]
fn generation_sources_projection_reads_no_provider_or_document_bodies_and_makes_no_writes() -> Result
{
    let f = Fixture::new()?;
    let child = f.series("on_completion", "scheduled", "completion")?;
    missing_template(&f)?;
    f.engine
        .execute("a", &f.finish("metadata-source", &child, 0)?)?;
    let expected = page(&f)?;
    let provider = std::sync::Arc::new(NoProvider::default());
    let engine = Engine::open(&f.database, provider.clone())?;
    // Keep image metadata valid but replace every stored body with an unreadable
    // sentinel. Projection must depend solely on cached role metadata and fences.
    let db = rusqlite::Connection::open(&f.database)?;
    db.execute_batch(
        "UPDATE transfer_payloads SET bytes=zeroblob(length(bytes)) WHERE bytes IS NOT NULL",
    )?;
    let before = std::fs::read(&f.database)?;
    let counts = f.counts()?;
    let exchanges = f.exchanges()?;
    let actual: Value = serde_json::from_str(
        &engine.features_json("a", r#"{"kind":"occurrence_generation_failures"}"#)?,
    )?;
    assert_eq!(actual, expected);
    assert_eq!(provider.0.load(std::sync::atomic::Ordering::SeqCst), 0);
    assert_eq!(std::fs::read(&f.database)?, before);
    assert_eq!(f.counts()?, counts);
    assert_eq!(f.exchanges()?, exchanges);
    Ok(())
}
