//! Explicit instant completion through actual `SQLite` and controlled conditional bytes.

use super::*;
use tasknotes_vault::{document::TaskDocument, path::VaultPath};

const PATH: &str = "Tasks/datetime.md";

fn setup(database: &str) -> Result<(Engine, Arc<Memory>)> {
    let files = Arc::new(Memory::default());
    files.seed("a", "tasknotes.yaml", b"title:\n  storage: frontmatter\n")?;
    files.seed("a", PATH, b"---\ntitle: Datetime\nstatus: open\npriority: normal\ntags: [task]\ndateCreated: '2026-01-01T00:00:00Z'\ndateModified: '2026-01-01T00:00:00Z'\nscheduled: '2026-10-03'\ndue: '2026-10-04'\nrecurrence: DTSTART:20261001;FREQ=DAILY;INTERVAL=2\nrecurrence_anchor: completion\ncomplete_instances: []\nskipped_instances: ['2026-10-02']\nvendor: retained\n---\nOriginal body\n")?;
    let engine = Engine::open(database, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    Ok((engine, files))
}

fn request(id: &str, target: &str, completed: bool) -> Mutation {
    let mut request = mutation(
        id,
        Command::SetCompletion {
            path: PATH.into(),
            expected_revision: None,
            completed,
            occurrence_date: Some(target.into()),
        },
    );
    request.execution_context = Some(tasknotes_runtime::types::ExecutionContext {
        today: "2026-10-03".into(),
        timezone: "America/Los_Angeles".into(),
    });
    request
}

fn document(files: &Memory) -> Result<TaskDocument> {
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

fn route(kind: u8, target: &str) -> Command {
    match kind {
        0 => Command::SetCompletion {
            path: PATH.into(),
            expected_revision: None,
            completed: true,
            occurrence_date: Some(target.into()),
        },
        1 => Command::ToggleComplete {
            path: PATH.into(),
            expected_revision: None,
            occurrence_date: Some(target.into()),
        },
        2 => Command::SetStatus {
            path: PATH.into(),
            expected_revision: None,
            status: "done".into(),
            occurrence_date: Some(target.into()),
        },
        _ => Command::EditTask {
            path: PATH.into(),
            expected_revision: None,
            properties: serde_json::Map::new(),
            body: None,
            status: Some("done".into()),
            occurrence_date: Some(target.into()),
        },
    }
}

fn seed_fields(files: &Memory, changes: Value) -> Result<()> {
    let mut fields = document(files)?.frontmatter().clone();
    let Value::Object(changes) = changes else {
        return Err(RuntimeError::NotFound);
    };
    fields.extend(changes);
    let bytes = format!(
        "---\n{}\n---\nOriginal body\n",
        serde_json::to_string(&fields)?
    );
    files.seed("a", PATH, bytes.as_bytes())
}

fn completed_day(files: &Memory, day: &str) -> Result<()> {
    assert_eq!(
        document(files)?.frontmatter().get("complete_instances"),
        Some(&json!([day]))
    );
    Ok(())
}

#[test]
fn actual_sqlite_explicit_datetime_uses_local_day_and_utc_anchor_for_next_occurrence() -> Result<()>
{
    let (engine, files) = setup(":memory:")?;
    engine.execute(
        "a",
        &request("complete", "2026-10-03T00:15:00.999999999Z", true),
    )?;
    let task = document(&files)?;
    assert_eq!(
        task.frontmatter().get("complete_instances"),
        Some(&json!(["2026-10-02"]))
    );
    assert_eq!(
        task.frontmatter().get("skipped_instances"),
        Some(&json!([]))
    );
    assert_eq!(
        task.frontmatter().get("recurrence"),
        Some(&json!("DTSTART:20261003T001500Z;FREQ=DAILY;INTERVAL=2"))
    );
    assert_eq!(
        task.frontmatter().get("scheduled"),
        Some(&json!("2026-10-05"))
    );
    assert_eq!(task.frontmatter().get("due"), Some(&json!("2026-10-06")));
    assert_eq!(task.frontmatter().get("status"), Some(&json!("open")));
    assert_eq!(task.frontmatter().get("vendor"), Some(&json!("retained")));
    assert_eq!(task.body(), "Original body\n");
    Ok(())
}

#[test]
fn all_completion_routes_resolve_offset_target_independently_of_mutation_day() -> Result<()> {
    for kind in 0..4 {
        let (engine, files) = setup(":memory:")?;
        let mut command = request("offset", "unused", true);
        command.command = route(kind, "2027-01-01T01:00:00.123456789+02:00");
        engine.execute("a", &command)?;
        completed_day(&files, "2026-12-31")?;
        assert_eq!(
            document(&files)?.frontmatter().get("recurrence"),
            Some(&json!("DTSTART:20261231T230000Z;FREQ=DAILY;INTERVAL=2"))
        );
        assert_eq!(
            document(&files)?.frontmatter().get("scheduled"),
            Some(&json!("2027-01-02"))
        );
    }
    Ok(())
}

#[test]
fn dst_repeated_wall_times_use_absolute_offsets_and_supplied_zone() -> Result<()> {
    for target in ["2026-11-01T01:30:00-07:00", "2026-11-01T01:30:00-08:00"] {
        let (engine, files) = setup(":memory:")?;
        engine.execute("a", &request("dst", target, true))?;
        completed_day(&files, "2026-11-01")?;
        let expected = if target.ends_with("-07:00") {
            "DTSTART:20261101T083000Z;FREQ=DAILY;INTERVAL=2"
        } else {
            "DTSTART:20261101T093000Z;FREQ=DAILY;INTERVAL=2"
        };
        assert_eq!(
            document(&files)?.frontmatter().get("recurrence"),
            Some(&json!(expected))
        );
        assert_eq!(
            document(&files)?.frontmatter().get("scheduled"),
            Some(&json!("2026-11-03"))
        );
        assert_eq!(
            document(&files)?.frontmatter().get("due"),
            Some(&json!("2026-11-04"))
        );
    }
    Ok(())
}

#[test]
fn scheduled_anchor_preserves_seed_and_components_while_using_local_instance_day() -> Result<()> {
    let (engine, files) = setup(":memory:")?;
    seed_fields(
        &files,
        json!({"recurrence_anchor":"scheduled", "recurrence":"RRULE:DTSTART:20261001;FREQ=DAILY;INTERVAL=2;COUNT=10"}),
    )?;
    engine.refresh("a")?;
    engine.execute(
        "a",
        &request("scheduled", "2026-10-03T00:15:00.999999999Z", true),
    )?;
    completed_day(&files, "2026-10-02")?;
    assert_eq!(
        document(&files)?.frontmatter().get("recurrence"),
        Some(&json!("DTSTART:20261001;FREQ=DAILY;INTERVAL=2;COUNT=10"))
    );
    assert_eq!(
        document(&files)?.frontmatter().get("scheduled"),
        Some(&json!("2026-10-03"))
    );
    Ok(())
}

#[test]
fn editor_staged_recurrence_anchor_is_used_atomically_with_body_and_title() -> Result<()> {
    let (engine, files) = setup(":memory:")?;
    let mut edit = request("editor", "unused", true);
    edit.command = Command::EditTask {
        path: PATH.into(),
        expected_revision: Some(document(&files)?.revision().as_str().into()),
        properties: serde_json::Map::from_iter([
            ("title".into(), json!("Edited")),
            ("recurrence".into(), json!("FREQ=DAILY;INTERVAL=3;COUNT=10")),
            ("recurrenceAnchor".into(), json!("completion")),
        ]),
        body: Some("Edited body\n".into()),
        status: Some("done".into()),
        occurrence_date: Some("2026-10-03T00:15:00.999999999Z".into()),
    };
    engine.execute("a", &edit)?;
    completed_day(&files, "2026-10-02")?;
    assert_eq!(
        document(&files)?.frontmatter().get("recurrence"),
        Some(&json!(
            "DTSTART:20261003T001500Z;FREQ=DAILY;INTERVAL=3;COUNT=10"
        ))
    );
    assert_eq!(
        document(&files)?.frontmatter().get("title"),
        Some(&json!("Edited"))
    );
    assert_eq!(document(&files)?.body(), "Edited body\n");
    assert_eq!(exchanges(&files)?, 1);
    Ok(())
}

#[test]
fn date_only_completion_and_absent_target_behavior_remain_exact() -> Result<()> {
    for kind in 0..4 {
        let (engine, files) = setup(":memory:")?;
        let mut command = request("date", "unused", true);
        command.command = route(kind, "2026-10-02");
        command.execution_context = None;
        engine.execute("a", &command)?;
        completed_day(&files, "2026-10-02")?;
        assert_eq!(
            document(&files)?.frontmatter().get("recurrence"),
            Some(&json!("DTSTART:20261002;FREQ=DAILY;INTERVAL=2"))
        );
    }
    for kind in 0..4 {
        let (engine, files) = setup(":memory:")?;
        let mut command = request("absent", "unused", true);
        command.command = route(kind, "unused");
        match &mut command.command {
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
            } => *occurrence_date = None,
            _ => return Err(RuntimeError::NotFound),
        }
        engine.execute("a", &command)?;
        completed_day(&files, "2026-10-03")?;
    }
    Ok(())
}

#[test]
fn invalid_datetime_context_and_target_fail_without_bytes_journal_or_upload_effects() -> Result<()>
{
    for kind in 0..4 {
        for target in [
            "2026-10-03T01:00:00",
            "2026-02-30T01:00:00Z",
            "2026-10-03 01:00:00Z",
            "2026-10-03T01:00:60Z",
            "2026-10-03T01:00:00+25:00",
        ] {
            let (engine, files) = setup(":memory:")?;
            let original = files.get("a", PATH)?;
            let pending = serde_json::to_value(engine.pending_uploads("a")?)?;
            let mut command = request("bad", "unused", true);
            command.command = route(kind, target);
            assert!(matches!(
                engine.execute("a", &command),
                Err(RuntimeError::Validation(_))
            ));
            assert_eq!(files.get("a", PATH)?, original);
            assert_eq!(exchanges(&files)?, 0);
            assert_eq!(serde_json::to_value(engine.pending_uploads("a")?)?, pending);
            assert_eq!(
                receipt_state(&engine, "bad")?.get("state"),
                Some(&json!("absent"))
            );
        }
        for zone in [None, Some("Unknown/Zone")] {
            let (engine, files) = setup(":memory:")?;
            let original = files.get("a", PATH)?;
            let mut command = request("context", "unused", true);
            command.command = route(kind, "2026-10-03T00:15:00Z");
            if let Some(zone) = zone {
                if let Some(context) = &mut command.execution_context {
                    context.timezone = zone.into();
                }
            } else {
                command.execution_context = None;
            }
            assert!(matches!(
                engine.execute("a", &command),
                Err(RuntimeError::Validation(_))
            ));
            assert_eq!(files.get("a", PATH)?, original);
            assert_eq!(exchanges(&files)?, 0);
            assert_eq!(
                receipt_state(&engine, "context")?.get("state"),
                Some(&json!("absent"))
            );
        }
    }
    Ok(())
}

#[test]
fn completed_local_day_is_noop_for_equivalent_or_different_explicit_instants() -> Result<()> {
    let (engine, files) = setup(":memory:")?;
    engine.execute(
        "a",
        &request("first", "2026-10-03T00:15:00.999999999Z", true),
    )?;
    let saved = files.get("a", PATH)?;
    let count = exchanges(&files)?;
    for target in [
        "2026-10-02T17:15:00.123456789-07:00",
        "2026-10-03T01:00:00Z",
    ] {
        let receipt = engine.execute("a", &request(target, target, true))?;
        assert!(receipt.paths.is_empty());
        assert_eq!(files.get("a", PATH)?, saved);
        assert_eq!(exchanges(&files)?, count);
    }
    Ok(())
}

#[test]
fn toggle_uncomplete_retains_anchor_and_recompletion_sets_new_explicit_anchor() -> Result<()> {
    let (engine, files) = setup(":memory:")?;
    engine.execute("a", &request("first", "2026-10-03T00:15:00Z", true))?;
    let mut toggle = request("toggle", "unused", false);
    toggle.command = route(1, "2026-10-02T17:15:00-07:00");
    engine.execute("a", &toggle)?;
    assert_eq!(
        document(&files)?.frontmatter().get("complete_instances"),
        Some(&json!([]))
    );
    assert_eq!(
        document(&files)?.frontmatter().get("recurrence"),
        Some(&json!("DTSTART:20261003T001500Z;FREQ=DAILY;INTERVAL=2"))
    );
    engine.execute("a", &request("again", "2026-10-03T01:00:00Z", true))?;
    completed_day(&files, "2026-10-02")?;
    assert_eq!(
        document(&files)?.frontmatter().get("recurrence"),
        Some(&json!("DTSTART:20261003T010000Z;FREQ=DAILY;INTERVAL=2"))
    );
    Ok(())
}

#[test]
fn datetime_completion_reopens_replays_original_precision_fences_cas_and_undo_exactly() -> Result<()>
{
    for kind in 0..4 {
        let directory =
            tempfile::tempdir().map_err(|error| RuntimeError::Storage(error.to_string()))?;
        let database = directory.path().join("datetime.sqlite");
        let database = database.to_str().ok_or(RuntimeError::NotFound)?;
        let (engine, files) = setup(database)?;
        let original = files.get("a", PATH)?;
        let mut command = request("durable", "unused", true);
        command.command = route(kind, "2026-10-03T00:15:00.999999999Z");
        let receipt = serde_json::to_value(engine.execute("a", &command)?)?;
        let saved = files.get("a", PATH)?;
        let count = exchanges(&files)?;
        drop(engine);
        let engine = Engine::open(database, files.clone())?;
        assert_eq!(
            serde_json::to_value(engine.execute("a", &command)?)?,
            receipt
        );
        assert_eq!(exchanges(&files)?, count);
        let mut changed = command.clone();
        match &mut changed.command {
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
            } => *occurrence_date = Some("2026-10-03T00:15:00.111111111Z".into()),
            _ => return Err(RuntimeError::NotFound),
        }
        assert!(matches!(
            engine.execute("a", &changed),
            Err(RuntimeError::Validation(_))
        ));
        assert_eq!(files.get("a", PATH)?, saved);
        engine.execute(
            "a",
            &mutation(
                "undo",
                Command::Undo {
                    receipt_id: "durable".into(),
                },
            ),
        )?;
        assert_eq!(files.get("a", PATH)?, original);
        let mut stale = request("stale", "2026-10-03T00:15:00Z", true);
        if let Command::SetCompletion {
            expected_revision, ..
        } = &mut stale.command
        {
            *expected_revision = Some("stale".into());
        }
        assert!(matches!(
            engine.execute("a", &stale),
            Err(RuntimeError::Conflict)
        ));
        assert_eq!(files.get("a", PATH)?, original);
    }
    Ok(())
}

#[test]
fn historical_nanoseconds_reminders_and_tracking_ranges_remain_original() -> Result<()> {
    let (engine, files) = setup(":memory:")?;
    let historical = json!([{"id":"historical","type":"absolute","absoluteTime":"2026-09-30T23:59:59.999999999-02:00","vendor":true}]);
    seed_fields(
        &files,
        json!({"reminders":historical,"dateCreated":"2026-01-01T00:00:00.987654321Z","timeEntries":[{"startTime":"2026-10-03T11:00:00.987654321Z","endTime":"2026-10-03T11:00:01.123456789Z"}]}),
    )?;
    engine.refresh("a")?;
    let old = document(&files)?.frontmatter().clone();
    engine.execute(
        "a",
        &request("historical", "2026-10-03T00:15:00.999999999Z", true),
    )?;
    let saved = document(&files)?;
    for key in ["reminders", "timeEntries", "dateCreated", "vendor"] {
        assert_eq!(saved.frontmatter().get(key), old.get(key));
    }
    Ok(())
}

#[test]
fn atomic_and_partial_datetime_batches_keep_validation_and_child_receipts_distinct() -> Result<()> {
    for partial in [false, true] {
        let (engine, files) = setup(":memory:")?;
        let original = files.get("a", PATH)?;
        let commands = vec![
            route(2, "2026-10-03T00:15:00.999999999Z"),
            route(3, "2026-10-03T01:00:00"),
        ];
        let mut command = request("batch", "unused", true);
        command.command = if partial {
            Command::BatchPartial { commands }
        } else {
            Command::Batch { commands }
        };
        let result = engine.execute("a", &command);
        // Shared contract rejection happens before either batch starts.
        assert!(matches!(result, Err(RuntimeError::Validation(_))));
        assert_eq!(files.get("a", PATH)?, original);
        assert_eq!(exchanges(&files)?, 0);
    }
    Ok(())
}

fn omit_target(command: &mut Command) -> Result<()> {
    match command {
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
        } => *occurrence_date = None,
        _ => return Err(RuntimeError::NotFound),
    }
    Ok(())
}

#[test]
fn configured_physical_completion_roles_preserve_unknown_properties_and_order() -> Result<()> {
    let (engine, files) = setup(":memory:")?;
    files.seed("a","tasknotes.yaml",b"title:\n  storage: frontmatter\nmapping:\n  scheduled: agenda\n  due: deadline\n  recurrence: cycle\n  recurrenceAnchor: basis\n  completeInstances: finished\n  skippedInstances: omitted\n")?;
    let mut fields = document(&files)?.frontmatter().clone();
    for (old, new) in [
        ("scheduled", "agenda"),
        ("due", "deadline"),
        ("recurrence", "cycle"),
        ("recurrence_anchor", "basis"),
        ("complete_instances", "finished"),
        ("skipped_instances", "omitted"),
    ] {
        let value = fields.remove(old).ok_or(RuntimeError::NotFound)?;
        fields.insert(new.into(), value);
    }
    fields.insert("finished".into(), json!(["2026-09-28"]));
    fields.insert("vendor_due".into(), json!("historical opaque"));
    files.seed(
        "a",
        PATH,
        format!(
            "---\n{}\n---\nOriginal body\n",
            serde_json::to_string(&fields)?
        )
        .as_bytes(),
    )?;
    engine.refresh("a")?;
    engine.execute(
        "a",
        &request("mapped", "2026-10-03T00:15:00.999999999Z", true),
    )?;
    let saved = document(&files)?;
    assert_eq!(
        saved.frontmatter().get("finished"),
        Some(&json!(["2026-09-28", "2026-10-02"]))
    );
    assert_eq!(saved.frontmatter().get("omitted"), Some(&json!([])));
    assert_eq!(
        saved.frontmatter().get("cycle"),
        Some(&json!("DTSTART:20261003T001500Z;FREQ=DAILY;INTERVAL=2"))
    );
    assert_eq!(
        saved.frontmatter().get("agenda"),
        Some(&json!("2026-10-05"))
    );
    assert_eq!(
        saved.frontmatter().get("deadline"),
        Some(&json!("2026-10-06"))
    );
    assert_eq!(
        saved.frontmatter().get("vendor_due"),
        Some(&json!("historical opaque"))
    );
    assert_eq!(saved.body(), "Original body\n");
    Ok(())
}

#[test]
fn omitted_targets_choose_literal_scheduled_then_due_then_immutable_civil_today() -> Result<()> {
    for kind in 0..4 {
        for (fields, day) in [
            (
                json!({"scheduled":"2026-10-02T23:30:00.999999999-02:00","due":"2026-10-04"}),
                "2026-10-02",
            ),
            (
                json!({"scheduled":null,"due":"2026-10-02T23:30:00.999999999-02:00"}),
                "2026-10-02",
            ),
            (json!({"scheduled":null,"due":null}), "2026-10-03"),
        ] {
            let (engine, files) = setup(":memory:")?;
            seed_fields(&files, fields)?;
            engine.refresh("a")?;
            let mut command = request("fallback", "unused", true);
            command.command = route(kind, "unused");
            omit_target(&mut command.command)?;
            engine.execute("a", &command)?;
            completed_day(&files, day)?;
            assert_eq!(
                document(&files)?.frontmatter().get("recurrence"),
                Some(&json!(format!(
                    "DTSTART:{};FREQ=DAILY;INTERVAL=2",
                    day.replace('-', "")
                )))
            );
        }
    }
    Ok(())
}

#[test]
fn corrupt_known_fallbacks_fail_both_modes_and_staged_editor_repair_remains_allowed() -> Result<()>
{
    for mode in ["strict", "permissive"] {
        for fields in [
            json!({"scheduled":"2026-10-03Tgarbage"}),
            json!({"scheduled":7}),
            json!({"scheduled":""}),
            json!({"scheduled":null,"due":"2026-02-30"}),
            json!({"due":"2026-10-03Tgarbage"}),
        ] {
            let (engine, files) = setup(":memory:")?;
            files.seed(
                "a",
                "tasknotes.yaml",
                format!("title:\n  storage: frontmatter\nvalidation:\n  mode: {mode}\n").as_bytes(),
            )?;
            seed_fields(&files, fields)?;
            engine.refresh("a")?;
            let original = files.get("a", PATH)?;
            for explicit in [false, true] {
                let mut command = request(
                    if explicit { "explicit" } else { "fallback" },
                    "2026-10-03T00:15:00Z",
                    true,
                );
                if !explicit {
                    omit_target(&mut command.command)?;
                }
                assert!(matches!(
                    engine.execute("a", &command),
                    Err(RuntimeError::Validation(_))
                ));
                assert_eq!(files.get("a", PATH)?, original);
                assert_eq!(exchanges(&files)?, 0);
                assert_eq!(
                    receipt_state(&engine, &command.mutation_id)?.get("state"),
                    Some(&json!("absent"))
                );
            }
            let mut repair = request("repair", "unused", true);
            repair.command = Command::EditTask {
                path: PATH.into(),
                expected_revision: None,
                properties: serde_json::Map::from_iter([
                    ("scheduled".into(), json!("2026-10-02")),
                    ("due".into(), json!("2026-10-04")),
                ]),
                body: None,
                status: Some("done".into()),
                occurrence_date: None,
            };
            engine.execute("a", &repair)?;
            completed_day(&files, "2026-10-02")?;
        }
    }
    Ok(())
}

#[test]
fn prefixed_duplicate_and_invalid_seeds_fail_before_effects() -> Result<()> {
    for rule in [
        "RRULE:DTSTART:20261001;DTSTART:20261002;FREQ=DAILY",
        "RRULE:DTSTART:20260230;FREQ=DAILY",
        "RRULE:DTSTART:20261001T120060Z;FREQ=DAILY",
    ] {
        let (engine, files) = setup(":memory:")?;
        seed_fields(&files, json!({"recurrence":rule}))?;
        engine.refresh("a")?;
        let original = files.get("a", PATH)?;
        assert!(matches!(
            engine.execute("a", &request("seed", "2026-10-03T00:15:00Z", true)),
            Err(RuntimeError::Validation(_))
        ));
        assert_eq!(files.get("a", PATH)?, original);
        assert_eq!(exchanges(&files)?, 0);
        assert_eq!(
            receipt_state(&engine, "seed")?.get("state"),
            Some(&json!("absent"))
        );
    }
    Ok(())
}

#[test]
fn nonrecurring_targets_validate_without_requiring_context_or_changing_completion_day() -> Result<()>
{
    for kind in 0..4 {
        for target in ["2027-01-01T00:15:00.999999999Z", "2026-10-02"] {
            let (engine, files) = setup(":memory:")?;
            seed_fields(
                &files,
                json!({"recurrence":null,"recurrence_anchor":null,"complete_instances":[],"skipped_instances":[]}),
            )?;
            engine.refresh("a")?;
            let mut command = request("ordinary", "unused", true);
            command.command = route(kind, target);
            command.execution_context = None;
            engine.execute("a", &command)?;
            assert_eq!(
                document(&files)?.frontmatter().get("completedDate"),
                Some(&json!("2026-10-03"))
            );
        }
        let (engine, files) = setup(":memory:")?;
        seed_fields(&files, json!({"recurrence":null}))?;
        engine.refresh("a")?;
        let original = files.get("a", PATH)?;
        let mut command = request("bad", "unused", true);
        command.command = route(kind, "opaque");
        assert!(matches!(
            engine.execute("a", &command),
            Err(RuntimeError::Validation(_))
        ));
        assert_eq!(files.get("a", PATH)?, original);
        assert_eq!(exchanges(&files)?, 0);
    }
    Ok(())
}

#[test]
fn actual_planning_failure_keeps_atomic_batch_empty_and_partial_batch_one_success() -> Result<()> {
    for partial in [false, true] {
        let (engine, files) = setup(":memory:")?;
        let original = files.get("a", PATH)?.ok_or(RuntimeError::NotFound)?;
        let bad = String::from_utf8(original.clone())
            .map_err(|error| RuntimeError::Storage(error.to_string()))?
            .replace("DTSTART:20261001;FREQ", "DTSTART:20260230;FREQ");
        files.seed("a", "Tasks/bad.md", bad.as_bytes())?;
        engine.refresh("a")?;
        let commands = vec![
            route(2, "2026-10-03T00:15:00.999999999Z"),
            Command::SetCompletion {
                path: "Tasks/bad.md".into(),
                expected_revision: None,
                completed: true,
                occurrence_date: Some("2026-10-03T00:15:00Z".into()),
            },
        ];
        let mut command = request("planning-batch", "unused", true);
        command.command = if partial {
            Command::BatchPartial { commands }
        } else {
            Command::Batch { commands }
        };
        let result = engine.execute("a", &command);
        if partial {
            result?;
            completed_day(&files, "2026-10-02")?;
            let outcome: Value = serde_json::from_str(&engine.features_json(
                "a",
                r#"{"kind":"batch_outcome","mutationId":"planning-batch"}"#,
            )?)?;
            assert_eq!(outcome.get("succeeded"), Some(&json!(1)));
            assert_eq!(outcome.get("failed"), Some(&json!(1)));
            assert_eq!(exchanges(&files)?, 1);
        } else {
            assert!(matches!(result, Err(RuntimeError::Validation(_))));
            assert_eq!(files.get("a", PATH)?, Some(original));
            assert_eq!(exchanges(&files)?, 0);
        }
        assert_eq!(files.get("a", "Tasks/bad.md")?, Some(bad.into_bytes()));
    }
    Ok(())
}
