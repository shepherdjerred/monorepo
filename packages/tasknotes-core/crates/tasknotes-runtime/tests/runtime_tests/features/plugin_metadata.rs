//! Current plugin metadata survives strict ordinary edits and exact Undo.

use super::*;

const PATH: &str = "Tasks/assigned.md";
const PLUGIN: &str = ".obsidian/plugins/tasknotes/data.json";
const YAML: &[u8] = b"validation:\n  mode: strict\n  reject_unknown_fields: true\n";

#[test]
fn plugin_extension_metadata_survives_strict_edits_and_undo() -> Result<()> {
    preserve_metadata(false)
}

#[test]
fn portable_extension_metadata_survives_strict_edits_and_undo() -> Result<()> {
    preserve_metadata(true)
}

fn preserve_metadata(portable: bool) -> Result<()> {
    let files = Arc::new(Memory::default());
    let settings = if portable {
        b"title:\n  storage: frontmatter\nvalidation:\n  mode: strict\n  reject_unknown_fields: true\nmapping:\n  assignees: owners\n  recurrence_original_date: original_day\n".to_vec()
    } else {
        YAML.to_vec()
    };
    files.seed("a", "tasknotes.yaml", &settings)?;
    let plugin = serde_json::to_vec(&json!({
        "storeTitleInFilename":false,
        "fieldMapping":{"assignees":"owners","recurrenceOriginalDate":"original_day"}
    }))?;
    if !portable {
        files.seed("a", PLUGIN, &plugin)?;
    }
    let original = b"---\ntitle: Assigned\nstatus: open\npriority: normal\ntags: [task]\ndateCreated: 2026-10-01T00:00:00Z\ndateModified: 2026-10-01T00:00:00Z\nowners: ['[[People/Alex]]', 'vendor@example.invalid']\noriginal_day: 2026-10-01\n---\nPreserved body.\n";
    files.seed("a", PATH, original)?;
    let engine = Engine::open(":memory:", files.clone())?;
    let mut selected = profile(ProfileKind::LocalFolder);
    selected.approve_standard = false;
    engine.register_profile(selected)?;
    engine.refresh("a")?;
    let snapshot = engine.snapshot("a", &Query::default())?;
    assert!(snapshot.problems.is_empty(), "{:?}", snapshot.problems);
    assert_eq!(snapshot.tasks.len(), 1);
    assert_eq!(
        snapshot
            .configuration
            .pointer("/effective/validation/reject_unknown_fields"),
        Some(&json!(true))
    );
    let task = snapshot.tasks.first().ok_or(RuntimeError::NotFound)?;
    let owners = task
        .properties
        .get("owners")
        .ok_or(RuntimeError::NotFound)?
        .clone();
    let day = task
        .properties
        .get("original_day")
        .ok_or(RuntimeError::NotFound)?
        .clone();
    engine.execute(
        "a",
        &mutation(
            "edit",
            Command::EditTask {
                path: PATH.into(),
                expected_revision: Some(task.revision.clone()),
                properties: serde_json::from_value(json!({"priority":"high"}))?,
                body: Some("Edited body.\n".into()),
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
    assert_eq!(document.frontmatter().get("owners"), Some(&owners));
    assert_eq!(document.frontmatter().get("original_day"), Some(&day));
    assert_eq!(document.frontmatter().get("status"), Some(&json!("done")));
    assert_eq!(document.body(), "Edited body.\n");
    assert_unknown_rejected_and_undo(&engine, &files, edited, completed, original)?;
    assert_eq!(files.get("a", "tasknotes.yaml")?, Some(settings));
    if !portable {
        assert_eq!(files.get("a", PLUGIN)?, Some(plugin));
    }
    Ok(())
}

fn assert_unknown_rejected_and_undo(
    engine: &Engine,
    files: &Memory,
    edited: Vec<u8>,
    completed: Vec<u8>,
    original: &[u8],
) -> Result<()> {
    let rejected = engine.execute(
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
        matches!(rejected, Err(RuntimeError::Validation(ref message)) if message.contains("unknown_field") && message.contains("unmapped_vendor"))
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
    assert_eq!(files.get("a", PATH)?, Some(original.to_vec()));
    Ok(())
}
