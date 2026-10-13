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

#[test]
fn review_template_default_context_preserves_explicit_inputs_and_template_precedence() -> Result<()>
{
    for (id, properties, template_fields, scheduled, contexts, expansion) in [
        (
            "defaults",
            json!({"title":"Default context","contexts":[]}),
            "",
            "2026-10-09",
            json!(["work", "home"]),
            "2026-10-09 | work, home",
        ),
        (
            "explicit",
            json!({"title":"Explicit context","scheduled":"2026-10-10","contexts":["personal"]}),
            "scheduled: '2026-10-11'\ncontexts: [template]\n",
            "2026-10-10",
            json!(["personal"]),
            "2026-10-10 | personal",
        ),
        (
            "template-precedence",
            json!({"title":"Template precedence"}),
            "scheduled: '2026-10-11'\ncontexts: [template]\n",
            "2026-10-11",
            json!(["template"]),
            "2026-10-09 | work, home",
        ),
    ] {
        let files = Arc::new(Memory::default());
        files.seed("a", "tasknotes.yaml", b"title:\n  storage: frontmatter\ndefaults:\n  scheduled: 2026-10-09\n  contexts: [work, home]\ntemplating:\n  enabled: true\n  template_path: Templates/context.md\n  failure_mode: error_abort\n")?;
        let template = format!(
            "---\n{template_fields}reviewExpansion: '{{{{scheduledDate}}}} | {{{{contexts}}}}'\n---\n{{{{scheduledDate}}}} | {{{{contexts}}}} | {{{{date}}}} {{{{time}}}}"
        );
        files.seed("a", "Templates/context.md", template.as_bytes())?;
        let engine = Engine::open(":memory:", files.clone())?;
        engine.register_profile(profile(ProfileKind::LocalFolder))?;
        engine.refresh("a")?;
        let mut request = mutation(
            id,
            Command::Create {
                path: Some("Tasks/context.md".into()),
                properties: properties
                    .as_object()
                    .cloned()
                    .ok_or(RuntimeError::NotFound)?,
                body: None,
            },
        );
        request.at = "2026-10-04T00:30:00Z".into();
        request.execution_context = Some(tasknotes_runtime::types::ExecutionContext {
            today: "2026-10-03".into(),
            timezone: "America/Los_Angeles".into(),
        });
        let receipt = engine.execute("a", &request)?;
        assert_eq!(receipt.task_path.as_deref(), Some("Tasks/context.md"));
        let bytes = files
            .get("a", "Tasks/context.md")?
            .ok_or(RuntimeError::NotFound)?;
        let document = TaskDocument::parse(VaultPath::parse("Tasks/context.md")?, &bytes)?;
        assert_eq!(
            document.frontmatter().get("scheduled"),
            Some(&json!(scheduled))
        );
        assert_eq!(document.frontmatter().get("contexts"), Some(&contexts));
        assert_eq!(
            document.frontmatter().get("reviewExpansion"),
            Some(&json!(expansion))
        );
        assert_eq!(document.body(), format!("{expansion} | 2026-10-03 17:30"));
        assert_eq!(
            document.frontmatter().get("dateCreated"),
            Some(&json!("2026-10-04T00:30:00Z"))
        );
        assert_eq!(
            document.frontmatter().get("dateModified"),
            Some(&json!("2026-10-04T00:30:00Z"))
        );
    }
    Ok(())
}
