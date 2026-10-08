//! Configured method combinations exercised through real loading and mutations.

use super::{
    Arc, Command, Engine, Memory, ProfileKind, Query, Result, RuntimeError, Value, create, json,
    mutation, profile,
};

fn config(combine: &str) -> Vec<u8> {
    format!("task_detection:\n  method: property\n  methods: [tag, property]\n  combine: {combine}\n  tag: task\n  property_name: kind\n  property_value: task\n  excluded_folders: [Excluded]\n").into_bytes()
}

fn note(fields: &str, body: &str) -> Vec<u8> {
    format!("---\ntitle: Seed\nstatus: open\ndateCreated: 2026-01-01T00:00:00Z\ndateModified: 2026-01-01T00:00:00Z\n{fields}---\n{body}").into_bytes()
}

#[test]
fn multi_method_detection_loads_real_documents_with_combinators_and_exclusions() -> Result<()> {
    for (combine, paths) in [
        ("and", vec!["Tasks/both.md", "Tasks/inline.md"]),
        (
            "or",
            vec![
                "Tasks/both.md",
                "Tasks/inline.md",
                "Tasks/property.md",
                "Tasks/tag.md",
            ],
        ),
    ] {
        let files = Arc::new(Memory::default());
        files.seed("a", "tasknotes.yaml", &config(combine))?;
        for (path, fields, body) in [
            ("Tasks/tag.md", "tags: ['#TASK']\n", ""),
            ("Tasks/property.md", "kind: task\n", ""),
            ("Tasks/both.md", "kind: task\ntags: [task]\n", ""),
            ("Tasks/inline.md", "kind: task\n", "#task\n"),
            (
                "Tasks/code.md",
                "kind: note\n",
                "`#task` #tasking\n```md\n#task\n```\n",
            ),
            ("Excluded/task.md", "kind: task\ntags: [task]\n", ""),
        ] {
            files.seed("a", path, &note(fields, body))?;
        }
        let engine = Engine::open(":memory:", files)?;
        engine.register_profile(profile(ProfileKind::LocalFolder))?;
        engine.refresh("a")?;
        let mut found = engine
            .snapshot("a", &Query::default())?
            .tasks
            .into_iter()
            .map(|task| task.path)
            .collect::<Vec<_>>();
        found.sort();
        assert_eq!(found, paths);
    }
    Ok(())
}

#[test]
fn creation_and_edit_validation_share_the_effective_multi_method_policy() -> Result<()> {
    for combine in ["and", "or"] {
        let files = Arc::new(Memory::default());
        files.seed("a", "tasknotes.yaml", &config(combine))?;
        let engine = Engine::open(":memory:", files.clone())?;
        engine.register_profile(profile(ProfileKind::LocalFolder))?;
        engine.refresh("a")?;
        engine.execute("a", &mutation("create", create()))?;
        let snapshot = engine.snapshot("a", &Query::default())?;
        let task = snapshot.tasks.first().ok_or(RuntimeError::NotFound)?;
        assert_eq!(
            task.properties.get("kind").and_then(Value::as_str),
            if combine == "and" { Some("task") } else { None }
        );
        let original = files.get("a", "Tasks/a.md")?;
        let request = mutation(
            "remove-detection",
            Command::Update {
                path: "Tasks/a.md".to_owned(),
                expected_revision: None,
                properties: json!({"tags":[],"kind":null})
                    .as_object()
                    .cloned()
                    .ok_or(RuntimeError::NotFound)?,
                body: None,
            },
        );
        assert!(matches!(
            engine.execute("a", &request),
            Err(RuntimeError::Validation(_))
        ));
        assert_eq!(files.get("a", "Tasks/a.md")?, original);
    }
    Ok(())
}

#[test]
fn presence_only_property_detection_creates_a_present_value_not_a_removed_null() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed(
        "a",
        "tasknotes.yaml",
        b"task_detection:\n  methods: [property]\n  property_name: kind\n",
    )?;
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("create", create()))?;
    assert_eq!(
        engine
            .snapshot("a", &Query::default())?
            .tasks
            .first()
            .ok_or(RuntimeError::NotFound)?
            .properties
            .get("kind"),
        Some(&Value::String(String::new()))
    );
    Ok(())
}

#[test]
fn mapped_tag_detection_loads_and_creates_the_same_physical_field() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed("a", "tasknotes.yaml", b"mapping:\n  tags: labels\ntask_detection:\n  methods: [tag, property]\n  combine: and\n  property_name: kind\n  property_value: task\n")?;
    files.seed(
        "a",
        "Tasks/seed.md",
        &note("labels: [task]\nkind: task\n", ""),
    )?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    assert_eq!(engine.refresh("a")?.tasks.len(), 1);
    engine.execute("a", &mutation("mapped-create", create()))?;
    assert_eq!(engine.snapshot("a", &Query::default())?.tasks.len(), 2);
    let bytes = files
        .get("a", "Tasks/a.md")?
        .ok_or(RuntimeError::NotFound)?;
    let raw = tasknotes_vault::document::TaskDocument::parse(
        tasknotes_vault::path::VaultPath::parse("Tasks/a.md")?,
        &bytes,
    )?;
    assert_eq!(raw.frontmatter().get("labels"), Some(&json!(["task"])));
    assert_eq!(raw.frontmatter().get("tags"), None);
    Ok(())
}
