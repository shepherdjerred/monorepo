//! Nullable tracking request defaults and continuation fences in actual `SQLite`.

use super::{
    Arc, Command, Engine, Memory, ProfileKind, Result, RuntimeError, Value, json, mutation, profile,
};

#[test]
fn nullable_defaults_match_absence_and_cursor_requires_nonnull_version() -> Result<()> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    engine.execute(
        "a",
        &mutation(
            "tracking-schema-create",
            Command::Create {
                path: Some("Tasks/Tracked.md".into()),
                properties: json!({"title":"Tracked"})
                    .as_object()
                    .cloned()
                    .ok_or(RuntimeError::NotFound)?,
                body: None,
            },
        ),
    )?;
    engine.execute(
        "a",
        &mutation(
            "tracking-schema-start",
            Command::StartTime {
                path: "Tasks/Tracked.md".into(),
                expected_revision: None,
            },
        ),
    )?;
    for (kind, cursor) in [
        (
            "tracking_sessions",
            json!({"taskPath":"Tasks/Tracked.md", "at":"2026-10-03T12:00:00Z"}),
        ),
        (
            "tracking_history",
            json!({"entryIndex":0, "at":"2026-10-03T12:00:00Z"}),
        ),
    ] {
        let mut request = json!({"kind":kind, "at":"2026-10-03T12:00:00Z"});
        if kind == "tracking_history" {
            request["path"] = json!("Tasks/Tracked.md");
        }
        let baseline: Value =
            serde_json::from_str(&engine.features_json("a", &request.to_string())?)?;
        request["limit"] = Value::Null;
        request["expectedVersion"] = Value::Null;
        request["after"] = Value::Null;
        let nullable: Value =
            serde_json::from_str(&engine.features_json("a", &request.to_string())?)?;
        assert_eq!(nullable, baseline);
        request["after"] = cursor;
        assert!(matches!(
            engine.features_json("a", &request.to_string()),
            Err(RuntimeError::Validation(_))
        ));
        request
            .as_object_mut()
            .ok_or(RuntimeError::NotFound)?
            .remove("expectedVersion");
        assert!(matches!(
            engine.features_json("a", &request.to_string()),
            Err(RuntimeError::Validation(_))
        ));
        request["expectedVersion"] = baseline["version"].clone();
        let continuation: Value =
            serde_json::from_str(&engine.features_json("a", &request.to_string())?)?;
        assert_eq!(continuation["rows"], json!([]));
        assert_eq!(continuation["nextCursor"], Value::Null);
    }
    Ok(())
}
