//! Vault-boundary, preservation, and concurrency acceptance tests.

use serde_json::json;
use tasknotes_vault::{
    VaultError,
    config::{ConfigurationSource, TaskNotesConfiguration},
    document::{PropertyEdit, TaskDocument},
    path::VaultPath,
};

#[test]
fn edit_preserves_unknown_properties_comments_and_body() -> Result<(), Box<dyn std::error::Error>> {
    let source = "---\n# user's comment\nstatus: 'open' # workflow\ncustom: {a: [1, 2], b: 'yes'}\nquote: |\n  multiline text\n---\n\n# Body\n- [ ] unchanged\n";
    let document = TaskDocument::parse(VaultPath::parse("Tasks/a.md")?, source.as_bytes())?;
    let write = document.plan(
        &[PropertyEdit::Set {
            key: "status".to_owned(),
            value: json!("done"),
        }],
        None,
    )?;
    let updated = String::from_utf8(write.bytes.clone())?;
    assert!(updated.contains("# user's comment\n"));
    assert!(updated.contains("# workflow"));
    assert!(updated.contains("custom: {a: [1, 2], b: 'yes'}\nquote: |\n  multiline text\n"));
    assert_eq!(
        TaskDocument::parse(document.path().clone(), &write.bytes)?.body(),
        document.body()
    );
    assert_eq!(write.check_current(source.as_bytes()), Ok(()));
    assert_eq!(
        write.check_current(b"external edit"),
        Err(VaultError::Conflict)
    );
    Ok(())
}

#[test]
fn bom_crlf_and_unknown_scalar_spellings_survive() -> Result<(), Box<dyn std::error::Error>> {
    let source = "\u{feff}---\r\nstatus: open\r\ncode: '001'\r\n---\r\n\r\nbody\r\n";
    let document = TaskDocument::parse(VaultPath::parse("a.md")?, source.as_bytes())?;
    let write = document.plan(
        &[PropertyEdit::Set {
            key: "status".to_owned(),
            value: json!("done"),
        }],
        None,
    )?;
    let updated = String::from_utf8(write.bytes)?;
    assert!(updated.starts_with("\u{feff}---\r\n"));
    assert!(updated.contains("code: '001'\r\n"));
    assert!(updated.ends_with("---\r\n\r\nbody\r\n"));
    assert!(!updated.replace("\r\n", "").contains('\n'));
    Ok(())
}

#[test]
fn add_remove_and_replace_body_without_touching_other_keys()
-> Result<(), Box<dyn std::error::Error>> {
    let document = TaskDocument::parse(
        VaultPath::parse("a.md")?,
        b"---\ntitle: Original\nremove: old\n---\nbody",
    )?;
    let write = document.plan(
        &[
            PropertyEdit::Remove {
                key: "remove".to_owned(),
            },
            PropertyEdit::Set {
                key: "tags".to_owned(),
                value: json!(["task", "work"]),
            },
            PropertyEdit::Set {
                key: "reminders".to_owned(),
                value: json!([{"type":"absolute","absoluteTime":"2026-10-03T12:00:00Z"}]),
            },
        ],
        Some("replacement\n"),
    )?;
    let updated = TaskDocument::parse(document.path().clone(), &write.bytes)?;
    assert_eq!(updated.frontmatter().get("title"), Some(&json!("Original")));
    assert!(!updated.frontmatter().contains_key("remove"));
    assert_eq!(
        updated.frontmatter().get("tags"),
        Some(&json!(["task", "work"]))
    );
    assert_eq!(updated.body(), "replacement\n");
    Ok(())
}

#[test]
fn add_frontmatter_to_body_and_empty_frontmatter() -> Result<(), Box<dyn std::error::Error>> {
    for source in ["body\n", "---\n---\nbody\n", "\u{feff}body\n"] {
        let document = TaskDocument::parse(VaultPath::parse("a.md")?, source.as_bytes())?;
        let write = document.plan(
            &[PropertyEdit::Set {
                key: "status".to_owned(),
                value: json!("open"),
            }],
            None,
        )?;
        let result = TaskDocument::parse(document.path().clone(), &write.bytes)?;
        assert_eq!(result.frontmatter().get("status"), Some(&json!("open")));
        assert_eq!(result.body(), "body\n");
        assert_eq!(
            write.bytes.starts_with("\u{feff}".as_bytes()),
            source.starts_with('\u{feff}')
        );
    }
    Ok(())
}

#[test]
fn invalid_frontmatter_never_generates_a_write() -> Result<(), Box<dyn std::error::Error>> {
    for source in [
        "---\nstatus: [\n---\nbody",
        "---\nstatus: open\nstatus: done\n---\nbody",
        "---\n- one\n- two\n---\nbody",
        "---\nstatus: open",
    ] {
        assert!(TaskDocument::parse(VaultPath::parse("a.md")?, source.as_bytes()).is_err());
    }
    assert!(TaskDocument::parse(VaultPath::parse("a.md")?, &[255]).is_err());
    Ok(())
}

#[test]
fn configuration_precedence_is_explicit_and_corruption_is_fatal()
-> Result<(), Box<dyn std::error::Error>> {
    assert!(TaskNotesConfiguration::resolve(None, None, false).is_err());
    assert_eq!(
        TaskNotesConfiguration::resolve(None, None, true)?.source,
        ConfigurationSource::Standard
    );
    assert_eq!(
        TaskNotesConfiguration::resolve(Some(b"{}"), Some(b"not: [valid"), false)?.source,
        ConfigurationSource::PluginDataJson
    );
    assert!(TaskNotesConfiguration::resolve(Some(b"not json"), None, true).is_err());
    assert!(
        TaskNotesConfiguration::resolve(Some(br#"{"customStatuses":[]}"#), None, true).is_err()
    );
    assert!(TaskNotesConfiguration::resolve(None, Some(b"not: [valid"), true).is_err());
    assert!(
        TaskNotesConfiguration::resolve(
            Some(br#"{"fieldMapping":{"status":"title"}}"#),
            None,
            true
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn custom_workflow_completion_and_cycle_do_not_use_fixed_enums()
-> Result<(), Box<dyn std::error::Error>> {
    let settings = json!({"customStatuses":[
        {"id":"doing","value":"working","label":"Working","color":"#abc","order":1,"isCompleted":false,"nextStatus":"finished"},
        {"id":"done","value":"finished","label":"Finished","color":"#abc","order":2,"isCompleted":true,"excludeFromCycle":true},
        {"id":"todo","value":"backlog","label":"Backlog","color":"#abc","order":0,"isCompleted":false}
    ], "fieldMapping":{"status":"state"}});
    let config =
        TaskNotesConfiguration::resolve(Some(&serde_json::to_vec(&settings)?), None, false)?;
    assert_eq!(config.mapping.field("status"), "state");
    assert_eq!(config.is_completed("finished"), Ok(true));
    assert_eq!(config.is_completed("working"), Ok(false));
    assert!(config.is_completed("done").is_err());
    assert_eq!(config.next_status("backlog")?, "working");
    assert_eq!(config.next_status("working")?, "finished");
    assert_eq!(config.next_status("finished")?, "backlog");
    assert_eq!(config.default_status, None);
    Ok(())
}

#[test]
fn reject_unsafe_paths_without_normalizing_valid_names() -> Result<(), Box<dyn std::error::Error>> {
    for path in [
        "",
        "/absolute",
        "a/../b",
        "a/./b",
        "a//b",
        "C:/vault",
        "a\\b",
        "a\0b",
    ] {
        assert_eq!(VaultPath::parse(path), Err(VaultError::Path));
    }
    assert_eq!(VaultPath::parse("Tasks/Con.md")?.as_str(), "Tasks/Con.md");
    let path: VaultPath = serde_json::from_str("\"Tasks/é.md\"")?;
    assert_eq!(path.as_str(), "Tasks/é.md");
    assert!(serde_json::from_str::<VaultPath>("\"../escape\"").is_err());
    Ok(())
}

#[test]
fn body_only_and_semantically_unchanged_edits_preserve_the_exact_header()
-> Result<(), Box<dyn std::error::Error>> {
    for source in [
        "\u{feff}--- \r\n# hello\r\nstatus: 'open'\ncustom: &a {x: 1}\nalias: *a\n...\r\nold body",
        "---\n# only a comment\n---\nold body",
        "old body",
    ] {
        let document = TaskDocument::parse(VaultPath::parse("a.md")?, source.as_bytes())?;
        let write = document.plan(&[], Some("new body"))?;
        assert_eq!(
            String::from_utf8(write.bytes)?,
            source.replace("old body", "new body")
        );
        if document.frontmatter().contains_key("status") {
            let unchanged = document.plan(
                &[PropertyEdit::Set {
                    key: "status".to_owned(),
                    value: json!("open"),
                }],
                None,
            )?;
            assert_eq!(unchanged.bytes, source.as_bytes());
        }
    }
    Ok(())
}

#[test]
fn editing_comment_only_frontmatter_keeps_its_comment() -> Result<(), Box<dyn std::error::Error>> {
    let document = TaskDocument::parse(VaultPath::parse("a.md")?, b"---\n# retained\n---\nbody")?;
    let write = document.plan(
        &[PropertyEdit::Set {
            key: "status".to_owned(),
            value: json!("open"),
        }],
        None,
    )?;
    assert!(String::from_utf8(write.bytes.clone())?.contains("# retained\n"));
    assert_eq!(
        TaskDocument::parse(document.path().clone(), &write.bytes)?
            .frontmatter()
            .get("status"),
        Some(&json!("open"))
    );
    Ok(())
}

#[test]
fn patch_conflicts_and_invalid_keys_fail_before_writing() -> Result<(), Box<dyn std::error::Error>>
{
    let document = TaskDocument::parse(VaultPath::parse("a.md")?, b"---\nstatus: open\n---\nbody")?;
    for edits in [
        vec![
            PropertyEdit::Set {
                key: "status".to_owned(),
                value: json!("done"),
            },
            PropertyEdit::Remove {
                key: "status".to_owned(),
            },
        ],
        vec![PropertyEdit::Set {
            key: String::new(),
            value: json!(1),
        }],
        vec![PropertyEdit::Remove {
            key: "a\nb".to_owned(),
        }],
    ] {
        assert!(document.plan(&edits, None).is_err());
    }
    let unchanged = document.plan(
        &[PropertyEdit::Remove {
            key: "missing".to_owned(),
        }],
        None,
    )?;
    assert_eq!(unchanged.bytes, document.bytes());
    Ok(())
}

proptest::proptest! {
    #[test]
    fn unchanged_document_roundtrips_exactly(body in "[a-zA-Z0-9\\n #_-]{0,200}") {
        let source = format!("---\nstatus: open\ncustom: '001'\n---\n{body}");
        let path = VaultPath::parse("a.md").map_err(|e| proptest::test_runner::TestCaseError::fail(e.to_string()))?;
        let document = TaskDocument::parse(path, source.as_bytes()).map_err(|e| proptest::test_runner::TestCaseError::fail(e.to_string()))?;
        let write = document.plan(&[], None).map_err(|e| proptest::test_runner::TestCaseError::fail(e.to_string()))?;
        proptest::prop_assert_eq!(write.bytes, source.into_bytes());
    }
}
