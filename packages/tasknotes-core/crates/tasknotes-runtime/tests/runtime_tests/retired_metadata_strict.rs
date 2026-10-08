//! Closed-schema writes preserve recognized historical data without timing semantics.

use super::*;

const PATH: &str = "Tasks/legacy.md";
const PLUGIN_SETTINGS: &[u8] = br#"{"storeTitleInFilename":false,"fieldMapping":{"timeEstimate":"budget","timeEntries":"work_log","pomodoros":"rounds"}}"#;

#[test]
fn strict_reads_edits_and_completion_preserve_standard_retired_fields() -> Result<()> {
    preserve_retired_metadata(false, false)
}

#[test]
fn strict_reads_edits_and_completion_preserve_portable_mapped_retired_fields() -> Result<()> {
    preserve_retired_metadata(true, false)
}

#[test]
fn strict_reads_edits_and_completion_preserve_plugin_mapped_retired_fields() -> Result<()> {
    preserve_retired_metadata(true, true)
}

fn seed_settings(files: &Memory, custom: bool, plugin: bool) -> Result<Vec<u8>> {
    let mut settings = "title:\n  storage: frontmatter\nvalidation:\n  mode: strict\n  reject_unknown_fields: true\n".to_owned();
    if custom && !plugin {
        settings.push_str(
            "mapping:\n  time_estimate: budget\n  time_entries: work_log\n  pomodoros: rounds\n",
        );
    }
    files.seed("a", "tasknotes.yaml", settings.as_bytes())?;
    if plugin {
        files.seed(
            "a",
            ".obsidian/plugins/tasknotes/data.json",
            PLUGIN_SETTINGS,
        )?;
    }
    Ok(settings.into_bytes())
}

fn preserve_retired_metadata(custom: bool, plugin: bool) -> Result<()> {
    let files = Arc::new(Memory::default());
    let settings = seed_settings(&files, custom, plugin)?;
    let keys = if custom {
        ["budget", "work_log", "rounds"]
    } else {
        ["timeEstimate", "timeEntries", "pomodoros"]
    };
    // Deliberately invalid old timing values must remain uninterpreted.
    let legacy = [
        json!({"vendor":"opaque estimate"}),
        json!({"startTime":"not a timestamp","vendor":["keep"]}),
        json!(["opaque count"]),
    ];
    let mut properties = serde_json::from_value::<serde_json::Map<String, Value>>(json!({
        "title":"Legacy","status":"open","tags":["task"],
        "dateCreated":"2026-01-01T00:00:00Z","dateModified":"2026-01-01T00:00:00Z",
        "due":"2026-10-04","scheduled":"2026-10-03"
    }))?;
    for (key, value) in keys.iter().zip(&legacy) {
        properties.insert((*key).to_owned(), value.clone());
    }
    let note = format!(
        "---\n{}\n---\nOriginal body\n",
        serde_json::to_string(&properties)?
    )
    .into_bytes();
    files.seed("a", PATH, &note)?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let snapshot = engine.snapshot("a", &Query::default())?;
    assert_eq!(snapshot.tasks.len(), 1);
    let task = snapshot.tasks.first().ok_or(RuntimeError::NotFound)?;
    assert_eq!(
        snapshot
            .configuration
            .get("effective")
            .and_then(|value| value.pointer("/validation/reject_unknown_fields")),
        Some(&Value::Bool(true))
    );
    for (key, value) in keys.iter().zip(&legacy) {
        assert_eq!(task.properties.get(*key), Some(value));
    }
    engine.execute(
        "a",
        &mutation(
            "edit",
            Command::EditTask {
                path: PATH.into(),
                expected_revision: Some(task.revision.clone()),
                properties: serde_json::from_value(json!({"priority":"high"}))?,
                body: Some("Edited body\n".into()),
                status: None,
                occurrence_date: None,
            },
        ),
    )?;
    let edited = files.get("a", PATH)?.ok_or(RuntimeError::NotFound)?;
    engine.execute(
        "a",
        &mutation(
            "complete",
            Command::SetStatus {
                path: PATH.into(),
                expected_revision: None,
                status: "done".into(),
                occurrence_date: None,
            },
        ),
    )?;
    let completed = files.get("a", PATH)?.ok_or(RuntimeError::NotFound)?;
    let document = tasknotes_vault::document::TaskDocument::parse(
        tasknotes_vault::path::VaultPath::parse(PATH)?,
        &completed,
    )?;
    for (key, value) in keys.iter().zip(&legacy) {
        assert_eq!(document.frontmatter().get(*key), Some(value));
    }
    assert_eq!(document.frontmatter().get("status"), Some(&json!("done")));
    assert_eq!(document.frontmatter().get("due"), properties.get("due"));
    assert_eq!(
        document.frontmatter().get("scheduled"),
        properties.get("scheduled")
    );
    assert_eq!(document.body(), "Edited body\n");
    check_closed_schema_and_undo(&engine, &files, edited, completed, note)?;
    assert_eq!(files.get("a", "tasknotes.yaml")?, Some(settings));
    if plugin {
        assert_eq!(
            files.get("a", ".obsidian/plugins/tasknotes/data.json")?,
            Some(PLUGIN_SETTINGS.to_vec())
        );
    }
    Ok(())
}

fn check_closed_schema_and_undo(
    engine: &Engine,
    files: &Memory,
    edited: Vec<u8>,
    completed: Vec<u8>,
    note: Vec<u8>,
) -> Result<()> {
    // Recognition is bounded: an unrelated property still blocks publication.
    let result = engine.execute(
        "a",
        &mutation(
            "unknown",
            Command::Update {
                path: PATH.into(),
                expected_revision: None,
                properties: serde_json::from_value(json!({"unmapped_vendor":"rejected"}))?,
                body: None,
            },
        ),
    );
    assert!(
        matches!(result, Err(RuntimeError::Validation(ref message)) if message.contains("unknown_field") && message.contains("unmapped_vendor"))
    );
    assert_eq!(files.get("a", PATH)?, Some(completed));
    engine.execute(
        "a",
        &mutation(
            "undo-complete",
            Command::Undo {
                receipt_id: "complete".into(),
            },
        ),
    )?;
    assert_eq!(files.get("a", PATH)?, Some(edited));
    engine.execute(
        "a",
        &mutation(
            "undo-edit",
            Command::Undo {
                receipt_id: "edit".into(),
            },
        ),
    )?;
    assert_eq!(files.get("a", PATH)?, Some(note));
    Ok(())
}
