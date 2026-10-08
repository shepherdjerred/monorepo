//! Real `SQLite` skip transitions, post-write list invariants, replay and CAS.

use super::{
    Arc, Command, ContentRevision, Engine, Memory, ProfileKind, Query, Result, RuntimeError, Value,
    json, mutation, profile,
};
use tasknotes_vault::{document::TaskDocument, path::VaultPath};

const PATH: &str = "Tasks/a.md";

fn setup(database: &str) -> Result<(Engine, Arc<Memory>)> {
    let files = Arc::new(Memory::default());
    files.seed(
        "a",
        "tasknotes.yaml",
        b"title:\n  storage: frontmatter\nvalidation:\n  mode: strict\nmapping:\n  complete_instances: completeInstances\n  skipped_instances: skippedInstances\n  date_modified: dateModified\n",
    )?;
    let engine = Engine::open(database, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    Ok((engine, files))
}

fn source(extra: Value) -> Result<Vec<u8>> {
    let Value::Object(extra) = extra else {
        return Err(RuntimeError::NotFound);
    };
    let mut fm = json!({"title":"Recurring","status":"open","tags":["task"],"dateCreated":"2026-01-01T00:00:00Z","dateModified":"2026-10-01T00:00:00Z","recurrence":"DTSTART:20261001;FREQ=DAILY","recurrenceAnchor":"completion","scheduled":"2026-10-01","due":"2026-10-05","vendor":{"ticket":"ZX-42"},"completeInstances":["2026-10-01","2026-10-02"],"skippedInstances":["2026-10-04"],"timeEntries":[{"startTime":"2026-10-03T11:00:00Z","vendor":true}]})
        .as_object().cloned().ok_or(RuntimeError::NotFound)?;
    fm.extend(extra);
    Ok(format!(
        "---\n{}\n---\n# Original body\n[[unknown|Kept]]\n",
        serde_json::to_string(&fm)?
    )
    .into_bytes())
}

fn skip(day: &str, skipped: bool, expected: Option<String>) -> Command {
    Command::SetOccurrenceSkipped {
        path: PATH.to_owned(),
        expected_revision: expected,
        occurrence_date: day.to_owned(),
        skipped,
    }
}

fn doc(files: &Memory) -> Result<TaskDocument> {
    TaskDocument::parse(
        VaultPath::parse(PATH)?,
        &files.get("a", PATH)?.ok_or(RuntimeError::NotFound)?,
    )
    .map_err(Into::into)
}

fn exchanges(files: &Memory) -> Result<u64> {
    Ok(files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock".into()))?
        .exchanges)
}

fn preserved(original: &TaskDocument, changed: &TaskDocument) {
    for role in [
        "status",
        "recurrence",
        "recurrenceAnchor",
        "scheduled",
        "due",
        "dateCreated",
        "vendor",
        "timeEntries",
    ] {
        assert_eq!(
            changed.frontmatter().get(role),
            original.frontmatter().get(role),
            "{role}"
        );
    }
    assert_eq!(changed.body(), original.body());
}

#[test]
fn skip_unskip_preserve_anchors_status_body_and_exact_noop_bytes() -> Result<()> {
    let (engine, files) = setup(":memory:")?;
    let original = source(json!({}))?;
    files.seed("a", PATH, &original)?;
    engine.refresh("a")?;
    let original_doc = doc(&files)?;
    let receipt = engine.execute(
        "a",
        &mutation(
            "skip-completed",
            skip(
                "2026-10-01",
                true,
                Some(original_doc.revision().as_str().to_owned()),
            ),
        ),
    )?;
    assert_eq!(receipt.paths, [PATH]);
    let changed = doc(&files)?;
    assert_eq!(
        changed.frontmatter().get("completeInstances"),
        Some(&json!(["2026-10-02"]))
    );
    assert_eq!(
        changed.frontmatter().get("skippedInstances"),
        Some(&json!(["2026-10-04", "2026-10-01"]))
    );
    assert_eq!(
        changed.frontmatter().get("dateModified"),
        Some(&json!("2026-10-03T12:00:00Z"))
    );
    preserved(&original_doc, &changed);
    let changed_bytes = files.get("a", PATH)?;
    let count = exchanges(&files)?;
    let revision = engine
        .snapshot("a", &Query::default())?
        .tasks
        .first()
        .ok_or(RuntimeError::NotFound)?
        .revision
        .clone();
    let mut repeated = mutation("skip-noop", skip("2026-10-01", true, None));
    repeated.at = "2026-10-04T01:00:00Z".into();
    let noop = engine.execute("a", &repeated)?;
    assert!(noop.applied);
    assert!(noop.paths.is_empty());
    assert_eq!(exchanges(&files)?, count);
    assert_eq!(files.get("a", PATH)?, changed_bytes);
    assert_eq!(
        engine
            .snapshot("a", &Query::default())?
            .tasks
            .first()
            .ok_or(RuntimeError::NotFound)?
            .revision,
        revision
    );
    let mut unskip = mutation("unskip", skip("2026-10-01", false, None));
    unskip.at = "2026-10-04T02:00:00Z".into();
    engine.execute("a", &unskip)?;
    assert_eq!(
        doc(&files)?.frontmatter().get("completeInstances"),
        Some(&json!(["2026-10-02"]))
    );
    assert_eq!(
        doc(&files)?.frontmatter().get("skippedInstances"),
        Some(&json!(["2026-10-04"]))
    );
    let before_noop = files.get("a", PATH)?;
    assert!(
        engine
            .execute(
                "a",
                &mutation("unskip-noop", skip("2026-10-01", false, None))
            )?
            .paths
            .is_empty()
    );
    assert_eq!(files.get("a", PATH)?, before_noop);
    // Instance membership is independent of the generated rule window.
    engine.execute(
        "a",
        &mutation("outside-rule", skip("2024-02-29", true, None)),
    )?;
    assert_eq!(
        doc(&files)?.frontmatter().get("skippedInstances"),
        Some(&json!(["2026-10-04", "2024-02-29"]))
    );
    Ok(())
}

#[test]
fn skip_reopens_replays_original_identity_and_undo_restores_exact_bytes() -> Result<()> {
    let directory = tempfile::tempdir().map_err(|e| RuntimeError::Storage(e.to_string()))?;
    let database = directory.path().join("instances.db");
    let database = database.to_str().ok_or(RuntimeError::NotFound)?;
    let (engine, files) = setup(database)?;
    let original = source(json!({}))?;
    files.seed("a", PATH, &original)?;
    engine.refresh("a")?;
    let request = mutation("skip-reopen", skip("2026-10-01", true, None));
    let receipt = engine.execute("a", &request)?;
    let count = exchanges(&files)?;
    drop(engine);
    let engine = Engine::open(database, files.clone())?;
    assert_eq!(
        serde_json::to_value(engine.execute("a", &request)?)?,
        serde_json::to_value(&receipt)?
    );
    assert_eq!(exchanges(&files)?, count);
    let mut changed_identity = request.clone();
    changed_identity.at = "2026-10-04T12:00:00Z".into();
    assert!(matches!(
        engine.execute("a", &changed_identity),
        Err(RuntimeError::Validation(_))
    ));
    engine.execute(
        "a",
        &mutation(
            "undo-skip",
            Command::Undo {
                receipt_id: request.mutation_id,
            },
        ),
    )?;
    assert_eq!(files.get("a", PATH)?, Some(original));
    Ok(())
}

#[test]
fn interrupted_skip_recovers_without_replanning_or_changing_original_clock() -> Result<()> {
    let directory = tempfile::tempdir().map_err(|e| RuntimeError::Storage(e.to_string()))?;
    let database = directory.path().join("instances.db");
    let database = database.to_str().ok_or(RuntimeError::NotFound)?;
    let (engine, files) = setup(database)?;
    let original = source(json!({}))?;
    files.seed("a", PATH, &original)?;
    engine.refresh("a")?;
    files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock".into()))?
        .crash_after_exchange = true;
    let request = mutation("skip-crash", skip("2026-10-01", true, None));
    assert!(matches!(
        engine.execute("a", &request),
        Err(RuntimeError::Host(_))
    ));
    let changed = files.get("a", PATH)?;
    drop(engine);
    let engine = Engine::open(database, files.clone())?;
    assert!(engine.execute("a", &request)?.applied);
    assert_eq!(files.get("a", PATH)?, changed);
    assert_eq!(exchanges(&files)?, 1);
    assert_eq!(
        doc(&files)?.frontmatter().get("dateModified"),
        Some(&json!(request.at))
    );
    engine.execute(
        "a",
        &mutation(
            "undo-recovered-skip",
            Command::Undo {
                receipt_id: request.mutation_id,
            },
        ),
    )?;
    assert_eq!(files.get("a", PATH)?, Some(original));
    Ok(())
}

#[test]
fn stale_revision_and_provider_cas_race_preserve_foreign_bytes() -> Result<()> {
    let (engine, files) = setup(":memory:")?;
    let original = source(json!({}))?;
    files.seed("a", PATH, &original)?;
    engine.refresh("a")?;
    assert!(matches!(
        engine.execute(
            "a",
            &mutation("stale", skip("2026-10-01", true, Some("stale".into())))
        ),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(exchanges(&files)?, 0);
    let foreign = source(json!({"vendor":{"ticket":"foreign"}}))?;
    files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock".into()))?
        .racing_before_compare = Some(foreign.clone());
    let expected = ContentRevision::of(&original).as_str().to_owned();
    assert!(matches!(
        engine.execute(
            "a",
            &mutation("race", skip("2026-10-01", true, Some(expected)))
        ),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(files.get("a", PATH)?, Some(foreign));
    assert_eq!(exchanges(&files)?, 0);
    Ok(())
}

fn write(role: &str, value: Value, editor: bool) -> Command {
    let properties = serde_json::Map::from_iter([(role.to_owned(), value)]);
    if editor {
        Command::EditTask {
            path: PATH.into(),
            expected_revision: None,
            properties,
            body: Some("Edited body\n".into()),
            status: None,
            occurrence_date: None,
        }
    } else {
        Command::Update {
            path: PATH.into(),
            expected_revision: None,
            properties,
            body: None,
        }
    }
}

#[test]
fn every_explicit_write_rejects_corrupt_mapped_and_alias_instance_properties() -> Result<()> {
    for role in [
        "completeInstances",
        "skippedInstances",
        "complete_instances",
        "skipped_instances",
    ] {
        for value in [
            Value::Null,
            json!("2026-10-01"),
            json!([false]),
            json!(["2026-02-30"]),
            json!(["2026-10-01", "2026-10-01"]),
        ] {
            for editor in [false, true] {
                let (engine, files) = setup(":memory:")?;
                let original = source(json!({}))?;
                files.seed("a", PATH, &original)?;
                let result = engine.execute(
                    "a",
                    &mutation("invalid-write", write(role, value.clone(), editor)),
                );
                // Update null means explicit deletion, not a stored null list.
                if value.is_null() {
                    assert!(result?.applied);
                    let physical = if role.contains("complete") {
                        "completeInstances"
                    } else {
                        "skippedInstances"
                    };
                    assert!(!doc(&files)?.frontmatter().contains_key(physical));
                    continue;
                }
                assert!(
                    matches!(result, Err(RuntimeError::Validation(_))),
                    "{role}: {result:?}"
                );
                assert_eq!(files.get("a", PATH)?, Some(original));
                assert_eq!(exchanges(&files)?, 0);
            }
        }
    }
    Ok(())
}

#[test]
fn overlapping_update_and_staged_completion_are_rejected_before_exchange() -> Result<()> {
    for editor in [false, true] {
        let (engine, files) = setup(":memory:")?;
        let original = source(json!({}))?;
        files.seed("a", PATH, &original)?;
        let mut command = write("skippedInstances", json!(["2026-10-01"]), editor);
        if let Command::EditTask {
            status,
            occurrence_date,
            ..
        } = &mut command
        {
            *status = Some("done".into());
            *occurrence_date = Some("2026-10-01".into());
        }
        assert!(matches!(
            engine.execute("a", &mutation("overlap-write", command)),
            Err(RuntimeError::Validation(_))
        ));
        assert_eq!(files.get("a", PATH)?, Some(original));
        assert_eq!(exchanges(&files)?, 0);
    }
    Ok(())
}

#[test]
fn bad_existing_lists_never_default_to_empty_in_skip_or_completion() -> Result<()> {
    for role in ["completeInstances", "skippedInstances"] {
        for value in [
            Value::Null,
            json!("bad"),
            json!([42]),
            json!(["2026-02-30"]),
            json!(["2026-10-01", "2026-10-01"]),
        ] {
            for command in [
                skip("2026-10-01", true, None),
                skip("2026-10-01", false, None),
                Command::SetCompletion {
                    path: PATH.into(),
                    expected_revision: None,
                    completed: true,
                    occurrence_date: Some("2026-10-01".into()),
                },
            ] {
                let (engine, files) = setup(":memory:")?;
                let extra =
                    Value::Object(serde_json::Map::from_iter([(role.into(), value.clone())]));
                let original = source(extra)?;
                files.seed("a", PATH, &original)?;
                assert!(matches!(
                    engine.execute("a", &mutation("bad-existing", command)),
                    Err(RuntimeError::Validation(_))
                ));
                assert_eq!(files.get("a", PATH)?, Some(original));
                assert_eq!(exchanges(&files)?, 0);
            }
        }
    }
    Ok(())
}

#[test]
fn explicit_normalization_rejects_corrupt_legacy_instance_aliases() -> Result<()> {
    let (engine, files) = setup(":memory:")?;
    let parsed = TaskDocument::parse(VaultPath::parse(PATH)?, &source(json!({}))?)?;
    let mut legacy = parsed.frontmatter().clone();
    legacy.remove("completeInstances");
    legacy.insert("complete_instances".into(), json!(["2026-02-30"]));
    let original =
        format!("---\n{}\n---\nOriginal\n", serde_json::to_string(&legacy)?).into_bytes();
    files.seed("a", PATH, &original)?;
    assert!(matches!(
        engine.execute(
            "a",
            &mutation(
                "bad-normalize",
                Command::Normalize {
                    path: PATH.into(),
                    expected_revision: None
                }
            )
        ),
        Err(RuntimeError::Validation(_))
    ));
    assert_eq!(files.get("a", PATH)?, Some(original));
    assert_eq!(exchanges(&files)?, 0);
    Ok(())
}

#[test]
fn configured_physical_fields_and_mapping_role_aliases_use_the_same_skip_plan() -> Result<()> {
    let (engine, files) = setup(":memory:")?;
    files.seed("a", "tasknotes.yaml", b"title:\n  storage: frontmatter\nvalidation:\n  mode: strict\nmapping:\n  complete_instances: done_days\n  skipped_instances: ignored_days\n  date_modified: dateModified\n")?;
    let Value::Object(mut fm) = serde_json::from_slice::<Value>(
        source(json!({}))?
            .split(|byte| *byte == b'\n')
            .nth(1)
            .ok_or(RuntimeError::NotFound)?,
    )?
    else {
        return Err(RuntimeError::NotFound);
    };
    let completed = fm
        .remove("completeInstances")
        .ok_or(RuntimeError::NotFound)?;
    let skipped = fm
        .remove("skippedInstances")
        .ok_or(RuntimeError::NotFound)?;
    fm.insert("done_days".into(), completed);
    fm.insert("ignored_days".into(), skipped);
    let original = format!("---\n{}\n---\nOriginal\n", serde_json::to_string(&fm)?).into_bytes();
    files.seed("a", PATH, &original)?;
    engine.refresh("a")?;
    engine.execute(
        "a",
        &mutation("mapped-skip", skip("2026-10-01", true, None)),
    )?;
    let changed = doc(&files)?;
    assert_eq!(
        changed.frontmatter().get("done_days"),
        Some(&json!(["2026-10-02"]))
    );
    assert_eq!(
        changed.frontmatter().get("ignored_days"),
        Some(&json!(["2026-10-04", "2026-10-01"]))
    );
    assert!(!changed.frontmatter().contains_key("completeInstances"));
    assert!(!changed.frontmatter().contains_key("skippedInstances"));
    assert!(matches!(
        engine.execute(
            "a",
            &mutation(
                "mapped-invalid",
                write("ignored_days", json!(["2026-02-30"]), true)
            )
        ),
        Err(RuntimeError::Validation(_))
    ));
    Ok(())
}

#[test]
fn atomic_failure_rolls_back_and_partial_failure_retains_only_successful_skip() -> Result<()> {
    for partial in [false, true] {
        let (engine, files) = setup(":memory:")?;
        let original = source(json!({}))?;
        files.seed("a", PATH, &original)?;
        let commands = vec![
            skip("2026-10-01", true, None),
            Command::Create {
                path: Some("Tasks/b.md".into()),
                properties: json!({"title":"Invalid","skippedInstances":["2026-02-30"]})
                    .as_object()
                    .cloned()
                    .ok_or(RuntimeError::NotFound)?,
                body: None,
            },
        ];
        let command = if partial {
            Command::BatchPartial { commands }
        } else {
            Command::Batch { commands }
        };
        let result = engine.execute("a", &mutation("batch-skip", command));
        if partial {
            let receipt = result?;
            assert!(receipt.applied);
            assert_eq!(receipt.paths, [PATH]);
            assert_eq!(
                doc(&files)?.frontmatter().get("skippedInstances"),
                Some(&json!(["2026-10-04", "2026-10-01"]))
            );
            let result: Value = serde_json::from_str(
                &engine
                    .features_json("a", r#"{"kind":"batch_outcome","mutationId":"batch-skip"}"#)?,
            )?;
            assert_eq!(result.get("succeeded"), Some(&json!(1)));
            assert_eq!(result.get("failed"), Some(&json!(1)));
        } else {
            assert!(matches!(result, Err(RuntimeError::Validation(_))));
            assert_eq!(files.get("a", PATH)?, Some(original));
            assert_eq!(exchanges(&files)?, 0);
        }
        assert_eq!(files.get("a", "Tasks/b.md")?, None);
    }
    Ok(())
}

#[test]
fn recognized_source_ambiguity_and_hidden_invalid_values_block_recurring_transitions() -> Result<()>
{
    for extra in [
        json!({"zz_completed":["2026-10-03"]}),
        json!({"completeInstances":["2026-02-30"],"zz_completed":["2026-10-01"]}),
        json!({"completeInstances":["2026-10-01"],"zz_completed":["2026-02-30"]}),
    ] {
        for command in [
            skip("2026-10-01", true, None),
            Command::SetCompletion {
                path: PATH.into(),
                expected_revision: None,
                completed: true,
                occurrence_date: Some("2026-10-01".into()),
            },
            Command::SetStatus {
                path: PATH.into(),
                expected_revision: None,
                status: "done".into(),
                occurrence_date: Some("2026-10-01".into()),
            },
            Command::EditTask {
                path: PATH.into(),
                expected_revision: None,
                properties: serde_json::Map::new(),
                body: Some("Must not publish\n".into()),
                status: Some("done".into()),
                occurrence_date: Some("2026-10-01".into()),
            },
        ] {
            let (engine, files) = setup(":memory:")?;
            files.seed("a","tasknotes.yaml",b"title:\n  storage: frontmatter\nvalidation:\n  mode: strict\nmapping:\n  complete_instances: zz_completed\n  skipped_instances: skippedInstances\n  date_modified: dateModified\n")?;
            let original = source(extra.clone())?;
            files.seed("a", PATH, &original)?;
            assert!(matches!(
                engine.execute("a", &mutation("ambiguous-source", command)),
                Err(RuntimeError::Validation(_))
            ));
            assert_eq!(files.get("a", PATH)?, Some(original));
            assert_eq!(exchanges(&files)?, 0);
        }
    }
    Ok(())
}

#[test]
fn ordinary_writes_cannot_hide_an_invalid_recognized_source_with_a_valid_patch() -> Result<()> {
    for command in [
        write("zz_completed", json!(["2026-10-03"]), false),
        write("zz_completed", json!(["2026-10-03"]), true),
        Command::StartTime {
            path: PATH.into(),
            expected_revision: None,
        },
        Command::StopTime {
            path: PATH.into(),
            expected_revision: None,
        },
        Command::SetTimeEntries {
            path: PATH.into(),
            expected_revision: None,
            entries: vec![],
        },
        Command::Archive {
            path: PATH.into(),
            expected_revision: None,
            archived: true,
        },
    ] {
        let (engine, files) = setup(":memory:")?;
        files.seed("a","tasknotes.yaml",b"title:\n  storage: frontmatter\nvalidation:\n  mode: strict\nmapping:\n  complete_instances: zz_completed\n  skipped_instances: skippedInstances\n  date_modified: dateModified\n")?;
        let original =
            source(json!({"completeInstances":["2026-02-30"],"zz_completed":["2026-10-01"]}))?;
        files.seed("a", PATH, &original)?;
        let result = engine.execute("a", &mutation("hidden-invalid", command));
        assert!(
            matches!(result, Err(RuntimeError::Validation(_))),
            "{result:?}"
        );
        assert_eq!(files.get("a", PATH)?, Some(original));
        assert_eq!(exchanges(&files)?, 0);
    }
    Ok(())
}

#[test]
fn unknown_legacy_physical_alias_is_preserved_and_normalization_is_not_a_repair_claim() -> Result<()>
{
    let (engine, files) = setup(":memory:")?;
    let original = source(json!({"complete_instances":["not-a-day"]}))?;
    files.seed("a", PATH, &original)?;
    let preview: Value = serde_json::from_str(&engine.features_json(
        "a",
        r#"{"kind":"normalization_preview","path":"Tasks/a.md"}"#,
    )?)?;
    assert!(
        preview
            .get("issues")
            .and_then(Value::as_array)
            .ok_or(RuntimeError::NotFound)?
            .iter()
            .any(|issue| issue.get("code") == Some(&json!("alias_conflict_ignored")))
    );
    let normalized = engine.execute(
        "a",
        &mutation(
            "normalize-conflicting-unknown",
            Command::Normalize {
                path: PATH.into(),
                expected_revision: None,
            },
        ),
    )?;
    assert!(normalized.paths.is_empty());
    assert_eq!(files.get("a", PATH)?, Some(original));
    engine.execute(
        "a",
        &mutation("unknown-alias-skip", skip("2026-10-01", true, None)),
    )?;
    assert_eq!(
        doc(&files)?.frontmatter().get("complete_instances"),
        Some(&json!(["not-a-day"]))
    );
    assert_eq!(
        doc(&files)?.frontmatter().get("completeInstances"),
        Some(&json!(["2026-10-02"]))
    );
    Ok(())
}

#[test]
fn invalid_command_day_and_nonrecurring_target_fail_before_exchange() -> Result<()> {
    for (day, extra) in [
        ("2026-02-30", json!({})),
        ("20261001", json!({})),
        ("2026-10-01T12:00:00Z", json!({})),
        ("2026-10-01", json!({"recurrence":""})),
        ("2026-10-01", json!({"recurrence":"FREQ=INVENTED"})),
    ] {
        let (engine, files) = setup(":memory:")?;
        let original = source(extra)?;
        files.seed("a", PATH, &original)?;
        assert!(matches!(
            engine.execute("a", &mutation("invalid-skip", skip(day, true, None))),
            Err(RuntimeError::Validation(_))
        ));
        assert_eq!(files.get("a", PATH)?, Some(original));
        assert_eq!(exchanges(&files)?, 0);
    }
    Ok(())
}

#[test]
fn identical_recognized_sources_cannot_diverge_during_skip_or_completion() -> Result<()> {
    for primary in ["a_completed", "zz_completed"] {
        for command in [
            skip("2026-10-01", true, None),
            Command::SetCompletion {
                path: PATH.into(),
                expected_revision: None,
                completed: false,
                occurrence_date: Some("2026-10-01".into()),
            },
            Command::SetCompletion {
                path: PATH.into(),
                expected_revision: None,
                completed: true,
                occurrence_date: Some("2026-10-03".into()),
            },
        ] {
            let (engine, files) = setup(":memory:")?;
            files.seed("a", "tasknotes.yaml", format!("title:\n  storage: frontmatter\nvalidation:\n  mode: strict\nmapping:\n  complete_instances: {primary}\n  skipped_instances: skippedInstances\n  date_modified: dateModified\n").as_bytes())?;
            let extra = Value::Object(serde_json::Map::from_iter([(
                primary.to_owned(),
                json!(["2026-10-01", "2026-10-02"]),
            )]));
            let original = source(extra)?;
            files.seed("a", PATH, &original)?;
            let result = engine.execute("a", &mutation("same-source-divergence", command));
            assert!(
                matches!(result, Err(RuntimeError::Validation(_))),
                "{primary}: {result:?}"
            );
            assert_eq!(files.get("a", PATH)?, Some(original));
            assert_eq!(exchanges(&files)?, 0);
        }
    }
    Ok(())
}

#[test]
fn configured_permissive_policy_remains_distinct_from_typed_instance_safety() -> Result<()> {
    let (engine, files) = setup(":memory:")?;
    files.seed("a","tasknotes.yaml",b"title:\n  storage: frontmatter\nvalidation:\n  mode: permissive\nmapping:\n  complete_instances: completeInstances\n  skipped_instances: skippedInstances\n  date_modified: dateModified\n")?;
    let command = Command::Create { path: Some(PATH.into()), properties: json!({"title":"Permissive","recurrence":"DTSTART:20261001;FREQ=DAILY","completeInstances":["2026-02-30"]}).as_object().cloned().ok_or(RuntimeError::NotFound)?, body: None };
    let receipt = engine.execute("a", &mutation("permissive-create", command))?;
    assert!(receipt.applied);
    assert!(receipt.diagnostics.is_empty());
    assert_eq!(
        doc(&files)?.frontmatter().get("completeInstances"),
        Some(&json!(["2026-02-30"]))
    );
    let unchanged = files.get("a", PATH)?;
    let count = exchanges(&files)?;
    assert!(matches!(
        engine.execute(
            "a",
            &mutation("permissive-skip", skip("2026-10-01", true, None))
        ),
        Err(RuntimeError::Validation(_))
    ));
    assert_eq!(files.get("a", PATH)?, unchanged);
    assert_eq!(exchanges(&files)?, count);

    let (engine, files) = setup(":memory:")?;
    files.seed("a","tasknotes.yaml",b"title:\n  storage: frontmatter\nvalidation:\n  mode: permissive\nmapping:\n  complete_instances: zz_completed\n  skipped_instances: skippedInstances\n  date_modified: dateModified\n")?;
    let original =
        source(json!({"completeInstances":["2026-02-30"],"zz_completed":["2026-10-01"]}))?;
    files.seed("a", PATH, &original)?;
    let receipt = engine.execute(
        "a",
        &mutation(
            "permissive-hidden-update",
            write("zz_completed", json!(["2026-10-03"]), false),
        ),
    )?;
    assert!(receipt.applied);
    assert!(receipt.diagnostics.is_empty());
    assert_eq!(
        doc(&files)?.frontmatter().get("completeInstances"),
        Some(&json!(["2026-02-30"]))
    );
    assert_eq!(
        doc(&files)?.frontmatter().get("zz_completed"),
        Some(&json!(["2026-10-03"]))
    );
    let unchanged = files.get("a", PATH)?;
    assert!(matches!(
        engine.execute(
            "a",
            &mutation("permissive-hidden-skip", skip("2026-10-01", true, None))
        ),
        Err(RuntimeError::Validation(_))
    ));
    assert_eq!(files.get("a", PATH)?, unchanged);
    Ok(())
}
