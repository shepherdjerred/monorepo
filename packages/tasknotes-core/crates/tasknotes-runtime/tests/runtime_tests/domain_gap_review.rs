//! Pinned invariant probes retained as failures until the next slice fixes them.

use super::{
    Arc, Command, Engine, Memory, ProfileKind, Query, Result, RuntimeError, Value, json, mutation,
    profile,
};

fn setup() -> Result<(Engine, Arc<Memory>)> {
    let files = Arc::new(Memory::default());
    files.seed(
        "a",
        "tasknotes.yaml",
        b"title:\n  storage: frontmatter\nvalidation:\n  mode: strict\n",
    )?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    Ok((engine, files))
}

fn create(properties: Value) -> Result<Command> {
    let Value::Object(mut properties) = properties else {
        return Err(RuntimeError::NotFound);
    };
    properties.insert("title".into(), json!("Recurring"));
    Ok(Command::Create {
        path: Some("Tasks/a.md".into()),
        properties,
        body: Some("Unrelated body\n".into()),
    })
}

fn properties(engine: &Engine) -> Result<serde_json::Map<String, Value>> {
    Ok(engine
        .snapshot("a", &Query::default())?
        .tasks
        .first()
        .ok_or(RuntimeError::NotFound)?
        .properties
        .clone())
}

#[test]
fn strict_instance_dates_reject_impossible_days_before_effects() -> Result<()> {
    for role in ["completeInstances", "skippedInstances"] {
        let (engine, files) = setup()?;
        let mut values = json!({"recurrence":"FREQ=DAILY","scheduled":"2026-10-01"});
        values[role] = json!(["2026-02-30"]);
        let result = engine.execute("a", &mutation("invalid-day", create(values)?));
        assert!(
            matches!(result, Err(RuntimeError::Validation(_))),
            "{role} accepted impossible day: {result:?}"
        );
        assert_eq!(files.get("a", "Tasks/a.md")?, None);
    }
    Ok(())
}

#[test]
fn strict_instance_duplicates_normalize_or_reject_deterministically() -> Result<()> {
    let (engine, _) = setup()?;
    let result=engine.execute("a",&mutation("duplicates",create(json!({"recurrence":"FREQ=DAILY","scheduled":"2026-10-01","completeInstances":["2026-09-30","2026-09-30"]}))?));
    match result {
        Err(RuntimeError::Validation(_)) => (),
        Err(other) => return Err(other),
        Ok(_) => assert_eq!(
            properties(&engine)?.get("completeInstances"),
            Some(&json!(["2026-09-30"]))
        ),
    }
    Ok(())
}

#[test]
fn strict_instance_overlap_blocks_create_before_effects() -> Result<()> {
    let (engine, files) = setup()?;
    let result=engine.execute("a",&mutation("overlap",create(json!({"recurrence":"FREQ=DAILY","scheduled":"2026-10-01","completeInstances":["2026-10-02"],"skippedInstances":["2026-10-02"]}))?));
    assert!(
        matches!(result, Err(RuntimeError::Validation(_))),
        "overlap accepted: {result:?}"
    );
    assert_eq!(files.get("a", "Tasks/a.md")?, None);
    Ok(())
}

#[test]
fn recurring_create_inserts_seeded_dtstart_before_rule() -> Result<()> {
    let (engine, _) = setup()?;
    engine.execute(
        "a",
        &mutation(
            "canonical-rule",
            create(json!({"recurrence":"FREQ=DAILY","scheduled":"2026-10-01"}))?,
        ),
    )?;
    assert_eq!(
        properties(&engine)?.get("recurrence"),
        Some(&json!("DTSTART:20261001;FREQ=DAILY"))
    );
    Ok(())
}

#[test]
fn explicit_create_time_entries_write_canonical_seconds() -> Result<()> {
    let (engine, _) = setup()?;
    engine.execute("a",&mutation("canonical-entries",create(json!({"timeEntries":[{"startTime":"2026-10-01T14:00:00.750+02:00","endTime":"2026-10-01T14:01:30.999+02:00","vendor":"preserved"}]}))?))?;
    assert_eq!(
        properties(&engine)?.get("timeEntries"),
        Some(
            &json!([{"startTime":"2026-10-01T12:00:00Z","endTime":"2026-10-01T12:01:30Z","vendor":"preserved"}])
        )
    );
    Ok(())
}

#[test]
fn newly_started_time_entry_writes_seconds_from_original_clock() -> Result<()> {
    let (engine, _) = setup()?;
    engine.execute("a", &mutation("create", create(json!({}))?))?;
    let mut start = mutation(
        "start",
        Command::StartTime {
            path: "Tasks/a.md".into(),
            expected_revision: None,
        },
    );
    start.at = "2026-10-03T12:00:00.750Z".into();
    engine.execute("a", &start)?;
    assert_eq!(
        properties(&engine)?.get("timeEntries"),
        Some(&json!([{"startTime":"2026-10-03T12:00:00Z"}]))
    );
    Ok(())
}
