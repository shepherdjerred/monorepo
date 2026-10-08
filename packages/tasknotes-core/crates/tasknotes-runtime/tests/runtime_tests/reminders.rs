//! Actual cached `SQLite` reminder projection, paging and provider independence.

use super::{
    Arc, Command, Engine, Memory, ProfileKind, Result, RuntimeError, Value, json, mutation, profile,
};

fn seed(files: &Memory, id: &str, path: &str, properties: Value) -> Result<()> {
    let mut fields=json!({"title":"Reminder","status":"open","tags":["task"],"dateCreated":"2026-01-01T00:00:00Z","dateModified":"2026-01-01T00:00:00Z"}).as_object().cloned().ok_or(RuntimeError::NotFound)?;
    let Value::Object(properties) = properties else {
        return Err(RuntimeError::NotFound);
    };
    fields.extend(properties);
    files.seed(
        id,
        path,
        format!("---\n{}\n---\n", serde_json::to_string(&fields)?).as_bytes(),
    )
}

fn request() -> Value {
    json!({"schemaVersion":1,"kind":"reminder_plan","at":"2026-10-01T00:00:00Z","from":"2026-10-31T00:00:00Z","to":"2026-11-02T00:00:00Z","timezone":"America/Los_Angeles","limit":128})
}
fn plan(engine: &Engine, id: &str, request: &Value) -> Result<Value> {
    Ok(serde_json::from_str(
        &engine.features_json(id, &request.to_string())?,
    )?)
}

#[test]
fn reminder_plan_resolves_mapped_roles_local_anchor_and_exact_instant_sorting() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed("a","tasknotes.yaml",b"mapping:\n  due: deadline\n  reminders: alerts\nreminders:\n  date_only_anchor_time: '09:30'\n")?;
    seed(
        &files,
        "a",
        "Tasks/a.md",
        json!({"deadline":"2026-11-01","alerts":[
            {"id":"b","type":"absolute","absoluteTime":"2026-11-01T19:15:00+02:00","description":"Absolute"},
            {"id":"a","type":"relative","relatedTo":"due","offset":"-PT15M","vendor":{"kept":true}}
        ]}),
    )?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let before = files.get("a", "Tasks/a.md")?;
    let projection = plan(&engine, "a", &request())?;
    println!("ACTUAL_REMINDER_PLAN {projection}");
    assert_eq!(projection.get("totalCount"), Some(&json!(2)));
    let rows = projection
        .get("rows")
        .and_then(Value::as_array)
        .ok_or(RuntimeError::NotFound)?;
    assert_eq!(
        rows.first().and_then(|row| row.get("reminderId")),
        Some(&json!("a"))
    );
    for row in rows {
        assert_eq!(row.get("fireAt"), Some(&json!("2026-11-01T17:15:00Z")));
        assert_eq!(row.get("occurrenceDate"), Some(&Value::Null));
        assert!(
            row.get("notificationId")
                .and_then(Value::as_str)
                .is_some_and(|id| id.starts_with("facet:") && id.len() == 70)
        );
    }
    assert_eq!(projection.get("problemCount"), Some(&json!(0)));
    assert_eq!(files.get("a", "Tasks/a.md")?, before);
    Ok(())
}

#[test]
fn reminder_eligibility_uses_anchor_instance_not_offset_day_and_reports_bad_entries() -> Result<()>
{
    let files = Arc::new(Memory::default());
    let relative = json!([{"id":"r","type":"relative","relatedTo":"scheduled","offset":"-P1D"}]);
    for (path, extra) in [
        (
            "Tasks/complete.md",
            json!({"recurrence":"FREQ=DAILY;DTSTART=20261101","completeInstances":["2026-11-01"]}),
        ),
        (
            "Tasks/skipped.md",
            json!({"recurrence":"FREQ=DAILY;DTSTART=20261101","skippedInstances":["2026-11-01"]}),
        ),
        (
            "Tasks/parent-done.md",
            json!({"recurrence":"FREQ=DAILY;DTSTART=20261101","status":"done","completedDate":"2026-10-30"}),
        ),
        (
            "Tasks/nonrec-done.md",
            json!({"status":"done","completedDate":"2026-10-30"}),
        ),
        ("Tasks/archived.md", json!({"archiveTag":true})),
    ] {
        let mut properties = extra.as_object().cloned().ok_or(RuntimeError::NotFound)?;
        properties.insert("scheduled".to_owned(), json!("2026-11-01"));
        properties.insert("reminders".to_owned(), relative.clone());
        seed(&files, "a", path, Value::Object(properties))?;
    }
    seed(
        &files,
        "a",
        "Tasks/bad.md",
        json!({"reminders":[{"id":"missing","type":"relative","relatedTo":"due","offset":"PT1H"},{"id":"mixed","type":"absolute","absoluteTime":"2026-11-01T12:00:00Z","offset":"PT1H"}]}),
    )?;
    seed(
        &files,
        "a",
        "Tasks/duplicate.md",
        json!({"reminders":[{"id":"same","type":"absolute","absoluteTime":"2026-11-01T12:00:00Z"},{"id":"same","type":"absolute","absoluteTime":"2026-11-01T13:00:00Z"}]}),
    )?;
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let projection = plan(&engine, "a", &request())?;
    assert_eq!(projection.get("totalCount"), Some(&json!(1)));
    let row = projection
        .get("rows")
        .and_then(Value::as_array)
        .and_then(|rows| rows.first())
        .ok_or(RuntimeError::NotFound)?;
    assert_eq!(row.get("taskPath"), Some(&json!("Tasks/parent-done.md")));
    assert_eq!(row.get("occurrenceDate"), Some(&json!("2026-11-01")));
    assert_eq!(row.get("fireAt"), Some(&json!("2026-10-31T07:00:00Z")));
    assert_eq!(projection.get("problemCount"), Some(&json!(3)));
    Ok(())
}

#[test]
fn reminder_pages_are_bounded_cached_version_fenced_and_stable_across_reopen() -> Result<()> {
    let directory =
        tempfile::tempdir().map_err(|error| RuntimeError::Storage(error.to_string()))?;
    let database = directory.path().join("reminders.db");
    let database = database.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    for n in 0..129 {
        seed(
            &files,
            "a",
            &format!("Tasks/{n:03}.md"),
            json!({"reminders":[{"id":"same","type":"absolute","absoluteTime":"2026-11-01T12:00:00Z"}]}),
        )?;
    }
    let engine = Engine::open(database, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock failed".to_owned()))?
        .fail_read = Some(".obsidian/plugins/tasknotes/data.json".to_owned());
    let mut query = request();
    query["limit"] = json!(64);
    let first = plan(&engine, "a", &query)?;
    assert_eq!(first.get("totalCount"), Some(&json!(129)));
    assert_eq!(
        first.get("rows").and_then(Value::as_array).map(Vec::len),
        Some(64)
    );
    query["after"] = first
        .get("nextCursor")
        .cloned()
        .ok_or(RuntimeError::NotFound)?;
    assert!(matches!(
        plan(&engine, "a", &query),
        Err(RuntimeError::Validation(_))
    ));
    query["expectedVersion"] = first
        .get("version")
        .cloned()
        .ok_or(RuntimeError::NotFound)?;
    let second = plan(&engine, "a", &query)?;
    assert_eq!(
        second.get("rows").and_then(Value::as_array).map(Vec::len),
        Some(64)
    );
    query["after"] = second
        .get("nextCursor")
        .cloned()
        .ok_or(RuntimeError::NotFound)?;
    let third = plan(&engine, "a", &query)?;
    assert_eq!(
        third.get("rows").and_then(Value::as_array).map(Vec::len),
        Some(1)
    );
    assert_eq!(third.get("nextCursor"), Some(&Value::Null));
    drop(engine);
    let engine = Engine::open(database, files.clone())?;
    assert_eq!(plan(&engine, "a", &query)?, third);
    files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock failed".to_owned()))?
        .fail_read = None;
    engine.execute(
        "a",
        &mutation(
            "change",
            Command::Update {
                path: "Tasks/000.md".to_owned(),
                expected_revision: None,
                properties: json!({"contexts":["changed"]})
                    .as_object()
                    .cloned()
                    .ok_or(RuntimeError::NotFound)?,
                body: None,
            },
        ),
    )?;
    assert!(matches!(
        plan(&engine, "a", &query),
        Err(RuntimeError::Conflict)
    ));
    Ok(())
}

#[test]
fn reminder_delivery_reports_dst_gap_and_rejects_bad_or_waiting_requests() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed(
        "a",
        "tasknotes.yaml",
        b"reminders:\n  date_only_anchor_time: '02:30'\n",
    )?;
    seed(
        &files,
        "a",
        "Tasks/gap.md",
        json!({"due":"2026-03-08","reminders":[{"id":"gap","type":"relative","relatedTo":"due","offset":"PT0S"}]}),
    )?;
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let mut query = request();
    query["at"] = json!("2026-03-01T00:00:00Z");
    query["from"] = json!("2026-03-08T00:00:00Z");
    query["to"] = json!("2026-03-09T00:00:00Z");
    let projection = plan(&engine, "a", &query)?;
    assert_eq!(projection.get("problemCount"), Some(&json!(1)));
    assert_eq!(
        projection.pointer("/problems/0/code"),
        Some(&json!("nonexistent_reminder_local_time"))
    );
    for (key, bad) in [
        ("timezone", json!("not-a-zone")),
        ("limit", json!(0)),
        ("limit", json!(129)),
        ("to", json!("2027-03-10T00:00:00Z")),
        ("from", json!("bad")),
    ] {
        let mut invalid = query.clone();
        invalid[key] = bad;
        assert!(matches!(
            plan(&engine, "a", &invalid),
            Err(RuntimeError::Validation(_))
        ));
    }
    let mut waiting = profile(ProfileKind::ObsidianSync);
    waiting.id = "waiting".to_owned();
    waiting.approve_standard = false;
    engine.register_profile(waiting)?;
    assert!(matches!(
        plan(&engine, "waiting", &request()),
        Err(RuntimeError::Configuration(_))
    ));
    Ok(())
}

#[test]
fn reminder_ids_are_profile_qualified_and_problem_metadata_is_bounded() -> Result<()> {
    let files = Arc::new(Memory::default());
    let valid = json!({"reminders":[{"id":"same","type":"absolute","absoluteTime":"2026-11-01T12:00:00Z"}]});
    for id in ["a", "b"] {
        seed(&files, id, "Tasks/same.md", valid.clone())?;
    }
    for n in 0..129 {
        seed(
            &files,
            "a",
            &format!("Tasks/bad{n:03}.md"),
            json!({"reminders":[{"id":"bad","type":"relative","relatedTo":"due","offset":"PT1H"}]}),
        )?;
    }
    let engine = Engine::open(":memory:", files)?;
    for id in ["a", "b"] {
        let mut selected = profile(ProfileKind::LocalFolder);
        id.clone_into(&mut selected.id);
        engine.register_profile(selected)?;
        engine.refresh(id)?;
    }
    let a = plan(&engine, "a", &request())?;
    let b = plan(&engine, "b", &request())?;
    assert_eq!(a.get("problemCount"), Some(&json!(129)));
    assert_eq!(
        a.get("problems").and_then(Value::as_array).map(Vec::len),
        Some(128)
    );
    assert_eq!(a.get("totalCount"), Some(&json!(1)));
    assert_ne!(
        a.pointer("/rows/0/notificationId"),
        b.pointer("/rows/0/notificationId")
    );
    assert_eq!(a, plan(&engine, "a", &request())?);
    Ok(())
}

#[test]
fn wrong_type_existing_recurrence_never_becomes_a_nonrecurring_notification() -> Result<()> {
    let files = Arc::new(Memory::default());
    for (name, recurrence) in [
        ("bool", json!(true)),
        ("array", json!(["FREQ=DAILY"])),
        ("null", Value::Null),
        ("empty", json!("")),
    ] {
        seed(
            &files,
            "a",
            &format!("Tasks/{name}.md"),
            json!({"recurrence":recurrence,"reminders":[{"id":"r","type":"absolute","absoluteTime":"2026-11-01T12:00:00Z"}]}),
        )?;
    }
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let projection = plan(&engine, "a", &request())?;
    assert_eq!(projection.get("totalCount"), Some(&json!(2)));
    assert_eq!(projection.get("problemCount"), Some(&json!(2)));
    assert_eq!(
        projection.pointer("/problems/0/code"),
        Some(&json!("invalid_recurrence_rule"))
    );
    assert_eq!(
        projection.pointer("/problems/1/code"),
        Some(&json!("invalid_recurrence_rule"))
    );
    Ok(())
}
