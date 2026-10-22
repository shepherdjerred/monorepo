//! Lossless JSON scalar extraction at the actual `SQLite` reminder seam.

use super::{Arc, Engine, Memory, ProfileKind, Result, RuntimeError, Value, json, profile};

#[test]
fn malformed_reminder_scalars_are_problems_without_canceling_valid_rows() -> Result<()> {
    let files = Arc::new(Memory::default());
    for (name, reminders) in [
        ("string", json!("invalid-existing-value")),
        ("bool", json!(true)),
        ("number", json!(17)),
        ("object", json!({"id":"invalid"})),
        ("null", Value::Null),
        ("empty", json!([])),
        (
            "valid",
            json!([{"id":"r","type":"absolute","absoluteTime":"2026-11-01T12:00:00Z"}]),
        ),
    ] {
        let frontmatter = json!({"title":name,"status":"open","tags":["task"],"dateCreated":"2026-01-01T00:00:00Z","reminders":reminders});
        files.seed(
            "a",
            &format!("Tasks/{name}.md"),
            format!("---\n{frontmatter}\n---\n").as_bytes(),
        )?;
    }
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let before = files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock failed".to_owned()))?
        .exchanges;
    let request = json!({"schemaVersion":1,"kind":"reminder_plan","at":"2026-10-01T00:00:00Z","from":"2026-11-01T00:00:00Z","to":"2026-11-02T00:00:00Z","timezone":"UTC"});
    let projection: Value =
        serde_json::from_str(&engine.features_json("a", &request.to_string())?)?;
    assert_eq!(projection.get("totalCount"), Some(&json!(1)));
    assert_eq!(projection.get("problemCount"), Some(&json!(4)));
    let problems = projection
        .get("problems")
        .and_then(Value::as_array)
        .ok_or(RuntimeError::NotFound)?;
    for problem in problems {
        assert_eq!(problem.get("code"), Some(&json!("invalid_reminder_list")));
    }
    assert_eq!(
        projection.pointer("/rows/0/taskPath"),
        Some(&json!("Tasks/valid.md"))
    );
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test lock failed".to_owned()))?
            .exchanges,
        before
    );
    Ok(())
}
