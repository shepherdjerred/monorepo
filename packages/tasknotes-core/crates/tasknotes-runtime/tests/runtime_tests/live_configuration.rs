//! The live seed must be valid plugin settings, not a partial mapping example.

use super::{
    Arc, Command, Engine, Memory, ProfileKind, Query, Result, RuntimeError, Value, json, mutation,
    profile,
};

const PLUGIN: &str = ".obsidian/plugins/tasknotes/data.json";

#[test]
fn official_live_seed_statuses_load_tasks_without_standard_configuration() -> Result<()> {
    let corpus: Vec<Value> = serde_json::from_str(include_str!(
        "../../../../../tasknotes-fixtures/vault/upstream/config.json"
    ))?;
    let mapper_fixture = corpus
        .iter()
        .find(|fixture| fixture.get("id") == Some(&json!("config.0659")))
        .and_then(|fixture| fixture.pointer("/input/data"))
        .ok_or(RuntimeError::NotFound)?;
    let official: Value = serde_json::from_str(include_str!(
        "../../../../../tasknotes-fixtures/vault/tasknotes-4.13.8-statuses.json"
    ))?;
    assert_eq!(official.get("version"), Some(&json!("4.13.8")));
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    let mut selected = profile(ProfileKind::ObsidianSync);
    selected.approve_standard = false;
    engine.register_profile(selected)?;
    engine.ingest_remote("a", PLUGIN, Some(&serde_json::to_vec(mapper_fixture)?), "1")?;
    let note = b"---\ntitle: E2E existing task\nstatus: open\npriority: normal\ntags: [task]\ndateCreated: 2026-10-01T00:00:00Z\ndateModified: 2026-10-01T00:00:00Z\ncustom_property: preserved\n---\nLive Sync preservation sentinel.\n";
    engine.ingest_remote("a", "Tasks/Existing.md", Some(note), "2")?;
    // map_plugin accepts minimal examples; the actual plugin contract does not.
    assert!(matches!(
        engine.features_json("a", r#"{"kind":"discovery"}"#),
        Err(RuntimeError::Configuration(_))
    ));
    let mut settings = mapper_fixture
        .as_object()
        .ok_or(RuntimeError::NotFound)?
        .clone();
    settings.insert(
        "customStatuses".to_owned(),
        official
            .get("statuses")
            .ok_or(RuntimeError::NotFound)?
            .clone(),
    );
    settings.insert("storeTitleInFilename".to_owned(), json!(false));
    settings.insert(
        "taskCreationDefaults".to_owned(),
        json!({"useBodyTemplate":false}),
    );
    engine.ingest_remote("a", PLUGIN, Some(&serde_json::to_vec(&settings)?), "3")?;
    let snapshot = engine.snapshot("a", &Query::default())?;
    assert_eq!(
        snapshot.configuration.get("source"),
        Some(&json!("plugin-data-json"))
    );
    assert_eq!(snapshot.tasks.len(), 1);
    let task = snapshot.tasks.first().ok_or(RuntimeError::NotFound)?;
    assert_eq!(task.title, "E2E existing task");
    assert_eq!(task.status, "open");
    assert_eq!(task.priority, "normal");
    assert_eq!(
        task.properties.get("custom_property"),
        Some(&json!("preserved"))
    );
    engine.execute(
        "a",
        &mutation(
            "complete-live-seed",
            Command::SetStatus {
                path: task.path.clone(),
                expected_revision: Some(task.revision.clone()),
                status: "done".to_owned(),
                occurrence_date: None,
            },
        ),
    )?;
    let completed = engine.snapshot("a", &Query::default())?;
    assert_eq!(
        completed
            .tasks
            .first()
            .ok_or(RuntimeError::NotFound)?
            .status,
        "done"
    );
    let bytes = files
        .get("a", "Tasks/Existing.md")?
        .ok_or(RuntimeError::NotFound)?;
    assert!(bytes.ends_with(b"Live Sync preservation sentinel.\n"));
    Ok(())
}
