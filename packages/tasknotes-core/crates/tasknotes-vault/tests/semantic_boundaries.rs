//! External configuration and pure context failures beyond the pinned corpus.
use serde_json::json;
use tasknotes_vault::{configuration, creation, temporal};

#[test]
fn known_configuration_sections_require_objects() {
    for kind in [
        "status",
        "title",
        "validation",
        "links",
        "dependencies",
        "templating",
        "time_tracking",
        "reminders",
        "task_detection",
    ] {
        for value in [json!(null), json!(42), json!([]), json!("invalid")] {
            assert!(
                configuration::validate_schema(kind, &value).is_err(),
                "{kind}: {value}"
            );
        }
    }
    for value in [
        json!({"values":42}),
        json!({"values":"open"}),
        json!({"default":42}),
    ] {
        assert!(configuration::validate_schema("status", &value).is_err());
    }
}

#[test]
fn creation_clock_and_timezone_are_explicit() -> Result<(), Box<dyn std::error::Error>> {
    let now = temporal::parse_instant("2026-02-21T01:00:00Z")?;
    let fields = json!({"title":"A task"});
    let fm = fields.as_object().ok_or("frontmatter missing")?;
    let values = creation::template_values(fm, now, "America/Los_Angeles")?;
    assert_eq!(values.get("date").map(String::as_str), Some("2026-02-20"));
    assert!(creation::template_values(fm, now, "Missing/Zone").is_err());
    Ok(())
}

#[test]
fn creation_storage_success_and_fallback_keep_exact_order() -> Result<(), Box<dyn std::error::Error>>
{
    let now = temporal::parse_instant("2026-02-20T10:20:30Z")?;
    let task_type = json!({"fields":{"status":{"default":"open"},"dateCreated":{"type":"datetime"}},"path_pattern":"Tasks/{title}"});
    let input = json!({"title":"A task","vendor":{"id":42}});
    let input = input.as_object().ok_or("input missing")?;
    let mut calls = Vec::new();
    let successful = creation::create_with(&task_type, input, now, "UTC", |path, fm| {
        calls.push(path.map(str::to_owned));
        Ok(creation::CreationPlan {
            path: "Provider/Chosen.md".into(),
            frontmatter: fm.clone(),
        })
    })?;
    assert_eq!(successful.path, "Provider/Chosen.md");
    assert_eq!(calls, vec![None]);
    assert_eq!(successful.frontmatter.get("status"), Some(&json!("open")));
    calls.clear();
    let fallback = creation::create_with(&task_type, input, now, "UTC", |path, fm| {
        calls.push(path.map(str::to_owned));
        let Some(path) = path else {
            return Err(tasknotes_vault::VaultError::Document(
                "path_required".into(),
            ));
        };
        Ok(creation::CreationPlan {
            path: path.into(),
            frontmatter: fm.clone(),
        })
    })?;
    assert_eq!(calls, vec![None, Some("Tasks/A task.md".into())]);
    assert_eq!(fallback.frontmatter.get("vendor"), Some(&json!({"id":42})));
    for error in ["permission_denied", "validation_error"] {
        let mut count = 0;
        let result = creation::create_with(&task_type, input, now, "UTC", |_, _| {
            count += 1;
            Err(tasknotes_vault::VaultError::Document(error.into()))
        });
        assert!(
            matches!(result,Err(tasknotes_vault::VaultError::Document(message))if message==error)
        );
        assert_eq!(count, 1);
    }
    Ok(())
}

#[test]
fn tracking_preserves_fractional_instants_before_rounding() -> Result<(), Box<dyn std::error::Error>>
{
    let entries = tasknotes_vault::tracking::normalize(
        &json!([{"startTime":"2026-02-20T11:00:00.750+01:00","endTime":"2026-02-20T10:00:30.249Z","vendor":"preserved"}]),
    )?;
    let first = entries.first().ok_or("entry missing")?;
    assert_eq!(
        first.get("startTime"),
        Some(&json!("2026-02-20T10:00:00.750Z"))
    );
    assert_eq!(
        first.get("endTime"),
        Some(&json!("2026-02-20T10:00:30.249Z"))
    );
    assert_eq!(first.get("vendor"), Some(&json!("preserved")));
    let totals = tasknotes_vault::tracking::totals(
        &entries,
        temporal::parse_instant("2026-02-20T10:10:00Z")?,
    )?;
    assert_eq!(totals, (0, 0));
    Ok(())
}

#[test]
fn templating_claim_requires_every_supported_behavior() -> Result<(), Box<dyn std::error::Error>> {
    let keys = [
        "supports_create_time_templating",
        "supports_failure_mode",
        "supports_variable_set",
    ];
    let mut flags = serde_json::Map::new();
    for key in keys {
        flags.insert(key.to_owned(), json!(true));
    }
    assert_eq!(
        tasknotes_vault::templating::execute(
            "templating.profile_claim_requirements",
            &json!(flags)
        )?,
        json!({"value":"claim_valid"})
    );
    for key in keys {
        let mut missing = flags.clone();
        missing.remove(key);
        assert!(
            matches!(tasknotes_vault::templating::execute("templating.profile_claim_requirements",&json!(missing)),Err(tasknotes_vault::VaultError::Document(code)) if code=="nonconformant_templating_claim")
        );
        let mut disabled = flags.clone();
        disabled.insert(key.to_owned(), json!(false));
        assert!(
            matches!(tasknotes_vault::templating::execute("templating.profile_claim_requirements",&json!(disabled)),Err(tasknotes_vault::VaultError::Document(code)) if code=="nonconformant_templating_claim")
        );
    }
    Ok(())
}
