//! Independent production creation checks against the actual `SQLite` engine.

use super::{
    Arc, Command, Engine, Memory, ProfileKind, Result, RuntimeError, json, mutation, profile,
};
use tasknotes_vault::{document::TaskDocument, path::VaultPath};

const PLUGIN: &str = ".obsidian/plugins/tasknotes/data.json";

#[test]
fn review_explicit_destination_and_generated_collision_preserve_original_title() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed(
        "a",
        PLUGIN,
        br#"{"tasksFolder":"Tasks","storeTitleInFilename":true}"#,
    )?;
    files.seed("a", "Tasks/AB.md", b"occupied unrelated file")?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    for (id, path, expected) in [
        ("review-generated", None, "Tasks/AB-2.md"),
        (
            "review-explicit",
            Some("Manual/original.md".to_owned()),
            "Manual/original.md",
        ),
    ] {
        let receipt = engine.execute(
            "a",
            &mutation(
                id,
                Command::Create {
                    path,
                    properties: json!({"title":"A/B"})
                        .as_object()
                        .cloned()
                        .ok_or(RuntimeError::NotFound)?,
                    body: Some("Original caller body".into()),
                },
            ),
        )?;
        assert_eq!(receipt.task_path.as_deref(), Some(expected));
        let bytes = files.get("a", expected)?.ok_or(RuntimeError::NotFound)?;
        let document = TaskDocument::parse(VaultPath::parse(expected)?, &bytes)?;
        assert_eq!(document.frontmatter().get("title"), Some(&json!("A/B")));
        assert_eq!(document.body(), "Original caller body");
    }
    Ok(())
}

#[test]
fn review_custom_filename_details_uses_caller_body() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed("a", PLUGIN, br#"{"tasksFolder":"Tasks","storeTitleInFilename":false,"taskFilenameFormat":"custom","customFilenameTemplate":"{details}"}"#)?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let receipt = engine.execute(
        "a",
        &mutation(
            "review-caller-details",
            Command::Create {
                path: None,
                properties: json!({"title":"Semantic"})
                    .as_object()
                    .cloned()
                    .ok_or(RuntimeError::NotFound)?,
                body: Some("Caller details".into()),
            },
        ),
    )?;
    assert_eq!(
        receipt.task_path.as_deref(),
        Some("Tasks/Caller details.md")
    );
    Ok(())
}

#[test]
fn review_section_origins_preserve_portable_pattern_and_plugin_title_policy() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed("a", "tasknotes.yaml", b"task_type:\n  fields: {}\n  path_pattern: Portable/{title}.md\ntitle:\n  storage: filename\n  filename_format: title\n")?;
    files.seed("a", PLUGIN, br#"{"tasksFolder":"Plugin","storeTitleInFilename":false,"taskFilenameFormat":"timestamp"}"#)?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    let snapshot = engine.refresh("a")?;
    assert_eq!(
        snapshot
            .configuration
            .pointer("/extra/sectionOrigins/task_type"),
        Some(&json!("tasknotes-yaml"))
    );
    assert_eq!(
        snapshot
            .configuration
            .pointer("/extra/sectionOrigins/title"),
        Some(&json!("plugin-data-json"))
    );
    assert_eq!(
        snapshot.configuration.pointer("/effective/title/storage"),
        Some(&json!("frontmatter"))
    );
    let receipt = engine.execute(
        "a",
        &mutation(
            "review-provider-origins",
            Command::Create {
                path: None,
                properties: json!({"title":"Semantic"})
                    .as_object()
                    .cloned()
                    .ok_or(RuntimeError::NotFound)?,
                body: None,
            },
        ),
    )?;
    assert_eq!(receipt.task_path.as_deref(), Some("Portable/Semantic.md"));
    let bytes = files
        .get("a", "Portable/Semantic.md")?
        .ok_or(RuntimeError::NotFound)?;
    let document = TaskDocument::parse(VaultPath::parse("Portable/Semantic.md")?, &bytes)?;
    assert_eq!(
        document.frontmatter().get("title"),
        Some(&json!("Semantic"))
    );
    Ok(())
}

#[test]
fn review_production_template_preserves_raw_yaml_values_and_expands_body_once() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed("a", PLUGIN, br#"{"tasksFolder":"Tasks","storeTitleInFilename":true,"taskCreationDefaults":{"useBodyTemplate":true,"bodyTemplate":"Templates/Default.md"}}"#)?;
    files.seed("a", "Templates/Default.md", b"---\nreviewTitle: {{title}}\nreviewParent: '{{parentNote}}'\n---\n{{titleKebab}} | {{priorityShort}} | {{details}}")?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let receipt = engine.execute(
        "a",
        &mutation(
            "review-template-safe",
            Command::Create {
                path: None,
                properties:
                    json!({"title":"Café @ Home", "priority":"high", "parentNote":"[[Inbox]]"})
                        .as_object()
                        .cloned()
                        .ok_or(RuntimeError::NotFound)?,
                body: Some("user {{status}}".into()),
            },
        ),
    )?;
    let path = receipt.task_path.as_deref().ok_or(RuntimeError::NotFound)?;
    let bytes = files.get("a", path)?.ok_or(RuntimeError::NotFound)?;
    let document = TaskDocument::parse(VaultPath::parse(path)?, &bytes)?;
    assert_eq!(
        document.frontmatter().get("reviewTitle"),
        Some(&json!("Café @ Home"))
    );
    assert_eq!(
        document.frontmatter().get("reviewParent"),
        Some(&json!("[[Inbox]]"))
    );
    assert_eq!(document.body(), "café-@-home | H | user {{status}}");
    Ok(())
}
