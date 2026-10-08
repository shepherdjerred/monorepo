//! Independent adversarial probes against the rebuilt production helpers.

use serde_json::{Map, Value, json};
use tasknotes_vault::{Result, filename, templating, temporal};

fn object(value: Value) -> Result<Map<String, Value>> {
    match value {
        Value::Object(value) => Ok(value),
        _ => Err(tasknotes_vault::VaultError::Document(
            "review expected object".to_owned(),
        )),
    }
}

#[test]
fn production_custom_time_retains_seconds() -> Result<()> {
    let now = temporal::parse_instant("2026-10-07T19:01:23Z")?;
    let actual = filename::basename(
        "Task",
        &json!({"filename_format":"custom","custom_filename_template":"{time}"}),
        &Map::new(),
        now,
        "America/Los_Angeles",
        None,
    )?;
    assert_eq!(actual, "120123");
    Ok(())
}

#[test]
fn production_custom_project_context_and_short_priority_are_present() -> Result<()> {
    let now = temporal::parse_instant("2026-10-07T19:01:23Z")?;
    let properties = object(
        json!({"contexts":["Work"],"projects":["[[Projects/Alpha|Alpha]]"],"priority":"high","status":"open"}),
    )?;
    let actual = filename::basename(
        "Task",
        &json!({"filename_format":"custom","custom_filename_template":"{context}-{project}-{projectId}-{priorityShort}"}),
        &properties,
        now,
        "UTC",
        None,
    )?;
    assert_eq!(actual, "Work-Alpha-ALPH-H");
    Ok(())
}

#[test]
fn production_custom_title_kebab_retains_punctuation_like_official_sanitized_title() -> Result<()> {
    let now = temporal::parse_instant("2026-10-07T19:01:23Z")?;
    let properties = object(json!({"title":"Café @ Home"}))?;
    let actual = filename::basename(
        "Café @ Home",
        &json!({"filename_format":"custom","custom_filename_template":"{titleKebab}"}),
        &properties,
        now,
        "UTC",
        None,
    )?;
    assert_eq!(actual, "café-@-home");
    Ok(())
}

#[test]
fn yaml_template_key_tokens_never_publish_private_mask_identifiers() -> Result<()> {
    let values = object(json!({"title":"RealKey"}))?;
    let result = templating::expand_frontmatter(
        "{{title}}: value\nnested:\n  '{{title}}': child\n",
        &values,
        "preserve",
    )?;
    assert_eq!(result.get("RealKey"), Some(&json!("value")));
    assert_eq!(result.get("nested"), Some(&json!({"RealKey":"child"})));
    assert!(
        !Value::Object(result)
            .to_string()
            .contains("FACET_TEMPLATE_SCALAR_")
    );
    Ok(())
}

#[test]
fn yaml_safe_values_keep_structure_and_inserted_tokens_literal() -> Result<()> {
    let values = object(json!({"title":"A: B\nadmin: true # {{status}}","status":"open"}))?;
    let value = templating::expand_frontmatter(
        "title: {{title}}\nlist: [{{title}}]\n",
        &values,
        "preserve",
    )?;
    assert_eq!(value.len(), 2);
    assert_eq!(value.get("title"), values.get("title"));
    Ok(())
}

#[test]
fn collision_boundaries_cover_999_names_then_clock_fallback() -> Result<()> {
    let mut visits = Vec::new();
    let result = filename::select("Tasks", "Title", "Title", 1234, |path| {
        visits.push(path.to_owned());
        Ok(path != "Tasks/Title-ya.md")
    })?;
    assert_eq!(result.path, "Tasks/Title-ya.md");
    assert_eq!(visits.len(), 1000);
    assert_eq!(visits.last(), Some(&"Tasks/Title-ya.md".to_owned()));
    Ok(())
}

#[test]
fn production_custom_camel_and_pascal_preserve_original_unicode_and_punctuation() -> Result<()> {
    let now = temporal::parse_instant("2026-10-07T19:01:23Z")?;
    let properties = object(json!({"title":"Café @ Home"}))?;
    for (template, expected) in [
        ("{titleCamel}", "café@Home"),
        ("{titlePascal}", "Café@Home"),
    ] {
        let actual = filename::basename(
            "Café @ Home",
            &json!({"filename_format":"custom","custom_filename_template":template}),
            &properties,
            now,
            "UTC",
            None,
        )?;
        assert_eq!(actual, expected);
    }
    Ok(())
}

#[test]
fn production_custom_details_uses_truncated_caller_text_and_parent_note_sanitizes() -> Result<()> {
    let now = temporal::parse_instant("2026-10-07T19:01:23Z")?;
    let properties = object(json!({"details":"x".repeat(80),"parentNote":"[[Parents/Inbox]]"}))?;
    let actual = filename::basename(
        "Task",
        &json!({"filename_format":"custom","custom_filename_template":"{details}-{parentNote}"}),
        &properties,
        now,
        "UTC",
        None,
    )?;
    assert_eq!(actual, format!("{}-ParentsInbox", "x".repeat(50)));
    Ok(())
}

#[test]
fn production_custom_unknown_syntax_tokens_clean_up_without_becoming_filename_text() -> Result<()> {
    let now = temporal::parse_instant("2026-10-07T19:01:23Z")?;
    let actual = filename::basename(
        "Task",
        &json!({"filename_format":"custom","custom_filename_template":"literal-{unsupported-name}"}),
        &Map::new(),
        now,
        "UTC",
        None,
    )?;
    assert_eq!(actual, "literal-");
    Ok(())
}

#[test]
fn production_zettel_accepts_a_valid_day_with_midnight_dst_gap() -> Result<()> {
    let now = temporal::parse_instant("2026-09-06T04:30:00Z")?;
    let values = templating::production_values(&Map::new(), "", now, "America/Santiago")?;
    assert_eq!(values.get("zettel"), Some(&json!("2609061e0")));
    Ok(())
}

#[test]
fn production_case_variants_follow_ascii_boundaries_inside_punctuation_and_unicode() -> Result<()> {
    let now = temporal::parse_instant("2026-10-07T19:01:23Z")?;
    for (title, camel, pascal) in [
        ("hello-world Foo", "hello-WorldFoo", "Hello-WorldFoo"),
        ("Café résumé", "caféRéSumé", "CaféRéSumé"),
        ("@Home base", "@HomeBase", "@HomeBase"),
        ("1 task", "1Task", "1Task"),
    ] {
        for (template, expected) in [("{titleCamel}", camel), ("{titlePascal}", pascal)] {
            assert_eq!(
                filename::basename(
                    title,
                    &json!({"filename_format":"custom","custom_filename_template":template}),
                    &Map::new(),
                    now,
                    "UTC",
                    None
                )?,
                expected
            );
        }
    }
    Ok(())
}

#[test]
fn details_limit_counts_utf16_without_splitting_unicode_scalars() -> Result<()> {
    let now = temporal::parse_instant("2026-10-07T19:01:23Z")?;
    let properties = object(json!({"details":"😀".repeat(30)}))?;
    assert_eq!(
        filename::basename(
            "Title",
            &json!({"filename_format":"custom","custom_filename_template":"{details}"}),
            &properties,
            now,
            "UTC",
            None
        )?,
        "😀".repeat(25)
    );
    Ok(())
}

#[test]
fn filename_inserted_token_text_is_not_recursively_cleaned_or_expanded() -> Result<()> {
    let now = temporal::parse_instant("2026-10-07T19:01:23Z")?;
    assert_eq!(
        filename::basename(
            "A {status}",
            &json!({"filename_format":"custom","custom_filename_template":"{title}"}),
            &object(json!({"status":"done"}))?,
            now,
            "UTC",
            None
        )?,
        "A {status}"
    );
    Ok(())
}

#[test]
fn duplicate_expanded_yaml_keys_fail_including_nested_maps() -> Result<()> {
    let values = object(json!({"title":"same","status":"same"}))?;
    for raw in [
        "{{title}}: one\n{{status}}: two\n",
        "parent:\n  {{title}}: one\n  same: two\n",
    ] {
        assert_eq!(
            templating::expand_frontmatter(raw, &values, "preserve").err(),
            Some(tasknotes_vault::VaultError::Document(
                "template_parse_failed".into()
            ))
        );
    }
    Ok(())
}

#[test]
fn component_and_total_path_boundaries_keep_lossy_title_explicit() -> Result<()> {
    for title in ["x".repeat(252), "é".repeat(126), "😀".repeat(63)] {
        let plan = filename::select("", &title, &title, 42, |_| Ok(false))?;
        assert_eq!(plan.path, format!("{title}.md"));
        assert!(!plan.retain_title);
        assert!(!plan.shortened);
    }
    for title in ["x".repeat(253), "é".repeat(127), "😀".repeat(64)] {
        let plan = filename::select("", &title, &title, 42, |_| Ok(false))?;
        assert_eq!(plan.path, "task-16.md");
        assert!(plan.retain_title);
        assert!(plan.shortened);
    }
    let title = "x".repeat(252);
    assert_eq!(
        filename::select("1234", &title, &title, 42, |_| Ok(false))?
            .path
            .encode_utf16()
            .count(),
        260
    );
    let plan = filename::select("12345", &title, &title, 42, |_| Ok(false))?;
    assert_eq!(plan.path, "12345/task-16.md");
    assert!(plan.shortened);
    Ok(())
}

#[test]
fn collision_provider_failures_and_exhausted_fallback_are_not_hidden() -> Result<()> {
    assert_eq!(
        filename::select("Tasks", "Title", "Title", 42, |_| Err(
            tasknotes_vault::VaultError::Path
        ))
        .err(),
        Some(tasknotes_vault::VaultError::Path)
    );
    assert_eq!(
        filename::select("Tasks", "Title", "Title", 42, |_| Ok(true)).err(),
        Some(tasknotes_vault::VaultError::Conflict)
    );
    for title in ["A/B", "  Title  ", "CON", "COM1.txt", "lpt²"] {
        let name = filename::sanitize(title);
        assert!(filename::select("Tasks", &name, title, 42, |_| Ok(false))?.retain_title);
    }
    Ok(())
}

#[test]
fn local_sunday_weeks_and_fold_elapsed_seconds_follow_pinned_reference() -> Result<()> {
    for (at, zone, expected) in [
        ("2025-12-27T12:00:00Z", "UTC", "52"),
        ("2025-12-28T12:00:00Z", "UTC", "01"),
        ("2026-01-03T12:00:00Z", "UTC", "01"),
        ("2026-01-04T12:00:00Z", "UTC", "02"),
        ("2022-12-25T12:00:00Z", "UTC", "53"),
        ("2025-12-28T00:30:00Z", "America/Los_Angeles", "52"),
        ("2025-12-28T00:30:00Z", "Asia/Tokyo", "01"),
    ] {
        let values =
            templating::production_values(&Map::new(), "", temporal::parse_instant(at)?, zone)?;
        assert_eq!(values.get("week"), Some(&json!(expected)), "{at} in {zone}");
    }
    for (at, expected) in [
        ("2026-11-01T08:30:00Z", "261101460"),
        ("2026-11-01T09:30:00Z", "2611016y0"),
    ] {
        let values = templating::production_values(
            &Map::new(),
            "",
            temporal::parse_instant(at)?,
            "America/Los_Angeles",
        )?;
        assert_eq!(values.get("zettel"), Some(&json!(expected)));
    }
    Ok(())
}

#[test]
fn filename_formats_keep_original_clock_and_require_caller_uuid_entropy() -> Result<()> {
    let now = temporal::parse_instant("2026-10-07T19:01:23Z")?;
    assert_eq!(
        filename::basename(
            "A/B",
            &json!({"storage":"filename","filename_format":"uuid"}),
            &Map::new(),
            now,
            "UTC",
            None
        )?,
        "AB"
    );
    assert_eq!(
        filename::basename(
            "Title",
            &json!({"filename_format":"timestamp"}),
            &Map::new(),
            now,
            "America/Los_Angeles",
            None
        )?,
        "2026-10-07-120123"
    );
    assert!(
        filename::basename(
            "Title",
            &json!({"filename_format":"uuid"}),
            &Map::new(),
            now,
            "UTC",
            None
        )
        .is_err()
    );
    assert!(
        filename::basename(
            "Title",
            &json!({"filename_format":"uuid"}),
            &Map::new(),
            now,
            "UTC",
            Some("entropy")
        )
        .is_err()
    );
    let uuid = "A01B2C3D-1234-5678-9012-123456789ABC";
    assert_eq!(
        filename::basename(
            "Title",
            &json!({"filename_format":"uuid"}),
            &Map::new(),
            now,
            "UTC",
            Some(uuid)
        )?,
        uuid.to_ascii_lowercase()
    );
    Ok(())
}

#[test]
fn folder_component_exceeding_utf8_platform_limit_is_rejected() {
    assert!(filename::select(&"é".repeat(128), "Title", "Title", 42, |_| Ok(false)).is_err());
}

#[test]
fn production_body_variants_use_raw_title_and_official_short_role_values() -> Result<()> {
    let now = temporal::parse_instant("2026-10-07T19:01:23Z")?;
    let properties = object(json!({"title":"Café @ Home", "priority":"high", "status":"open"}))?;
    let values = templating::production_values(&properties, "user {{status}}", now, "UTC")?;
    for (key, expected) in [
        ("priorityShort", "H"),
        ("statusShort", "O"),
        ("titleKebab", "café-@-home"),
        ("titleSnake", "café_@_home"),
        ("titleCamel", "café@Home"),
        ("titlePascal", "Café@Home"),
        ("details", "user {{status}}"),
    ] {
        assert_eq!(values.get(key), Some(&json!(expected)), "{key}");
    }
    Ok(())
}

#[test]
fn production_project_variable_skips_empty_display_names_before_first_selection() -> Result<()> {
    let now = temporal::parse_instant("2026-10-07T19:01:23Z")?;
    let properties = object(json!({"projects":["", "   ", "[[Projects/Alpha|Alpha]]"]}))?;
    assert_eq!(
        filename::basename(
            "Title",
            &json!({"filename_format":"custom", "custom_filename_template":"{project}-{projects}-{projectId}"}),
            &properties,
            now,
            "UTC",
            None
        )?,
        "Alpha-Alpha-ALPH"
    );
    Ok(())
}

#[test]
fn production_sanitization_uses_js_whitespace_boundary_before_control_removal() {
    assert_eq!(filename::sanitize("Task\u{0085}Name"), "TaskName");
    assert_eq!(
        filename::sanitize("\u{feff}Task\u{feff}Name\u{feff}"),
        "Task Name"
    );
}

#[test]
fn production_sections_require_whole_delimiters_and_preserve_body_blank_lines() -> Result<()> {
    assert!(templating::production_sections("---\ntitle: Example\n---oops\nbody").is_err());
    assert_eq!(
        templating::production_sections(
            "\u{feff}---\r\ntitle: Example\r\n\u{feff}--- \r\n\r\nbody"
        )?,
        ("title: Example".into(), "\nbody".into())
    );
    assert_eq!(
        templating::production_sections("---\nlabel: |\n  ---oops\n---\n\nbody")?,
        ("label: |\n  ---oops".into(), "\nbody".into())
    );
    Ok(())
}
