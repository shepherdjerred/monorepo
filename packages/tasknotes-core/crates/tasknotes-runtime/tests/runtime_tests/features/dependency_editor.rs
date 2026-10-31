//! Cached dependency metadata, independent of provider access or mutations.

use super::*;
use tasknotes_vault::relationships::RELATIONSHIP_TYPES;

const REQUEST: &str = r#"{"schemaVersion":1,"kind":"dependency_editor"}"#;

fn metadata(engine: &Engine) -> Result<Value> {
    Ok(serde_json::from_str(&engine.features_json("a", REQUEST)?)?)
}

fn counters(files: &Memory) -> Result<(u64, u64)> {
    let state = files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock failed".into()))?;
    Ok((state.reads, state.exchanges))
}

#[test]
fn dependency_editor_choices_are_authoritative_unique_and_available_before_configuration()
-> Result<()> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    let mut selected = profile(ProfileKind::ObsidianSync);
    selected.approve_standard = false;
    engine.register_profile(selected)?;
    let result = metadata(&engine)?;
    assert_eq!(
        result,
        json!({"schemaVersion":1,"relationshipTypes":RELATIONSHIP_TYPES,"defaultReltype":null})
    );
    assert_eq!(counters(&files)?, (0, 0));
    let schema: Value = serde_json::from_str(include_str!(
        "../../../../../../tasknotes-fixtures/schema/facet-engine.schema.json"
    ))?;
    assert_eq!(
        schema.pointer("/$defs/dependencyRelationshipType/enum"),
        Some(&json!(RELATIONSHIP_TYPES))
    );
    assert_eq!(
        RELATIONSHIP_TYPES
            .iter()
            .copied()
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        4
    );
    for request in [
        r#"{"kind":"dependency_editor","path":"Tasks/private.md"}"#,
        r#"{"schemaVersion":2,"kind":"dependency_editor"}"#,
        r#"{"kind":"dependency_editor","defaultReltype":"FINISHTOSTART"}"#,
    ] {
        assert!(matches!(
            engine.features_json("a", request),
            Err(RuntimeError::Validation(_))
        ));
    }
    assert_eq!(counters(&files)?, (0, 0));
    Ok(())
}

#[test]
fn dependency_editor_defaults_are_explicit_cached_and_read_only() -> Result<()> {
    for default in std::iter::once(None).chain(RELATIONSHIP_TYPES.into_iter().map(Some)) {
        let files = Arc::new(Memory::default());
        let mut portable = String::from("title:\n  storage: frontmatter\n");
        if let Some(default) = default {
            portable.push_str("dependencies:\n  default_reltype: ");
            portable.push_str(default);
            portable.push('\n');
        }
        files.seed("a", "tasknotes.yaml", portable.as_bytes())?;
        let engine = Engine::open(":memory:", files.clone())?;
        engine.register_profile(profile(ProfileKind::LocalFolder))?;
        engine.refresh("a")?;
        let before = serde_json::to_value(engine.snapshot("a", &Query::default())?)?;
        let counter_before = counters(&files)?;
        // Unrefreshed provider changes must not alter the cached projection.
        files.seed(
            "a",
            "tasknotes.yaml",
            b"dependencies:\n  default_reltype: BLOCKS\n",
        )?;
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test lock failed".into()))?
            .fail_read = Some("tasknotes.yaml".into());
        let result = metadata(&engine)?;
        assert_eq!(result["defaultReltype"], json!(default));
        assert_eq!(result["relationshipTypes"], json!(RELATIONSHIP_TYPES));
        assert_eq!(result.as_object().map(serde_json::Map::len), Some(3));
        assert_eq!(counters(&files)?, counter_before);
        assert_eq!(
            serde_json::to_value(engine.snapshot("a", &Query::default())?)?,
            before
        );
        assert_eq!(engine.pending_uploads("a")?.len(), 0);
    }
    Ok(())
}

#[test]
fn dependency_editor_rejects_invalid_cached_default_without_provider_or_journal_effects()
-> Result<()> {
    let directory =
        tempfile::tempdir().map_err(|error| RuntimeError::Storage(error.to_string()))?;
    let database = directory.path().join("dependencies.db");
    let path = database.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    let engine = Engine::open(path, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let connection = rusqlite::Connection::open(path)?;
    let counters_before = counters(&files)?;
    for invalid in [
        json!("BLOCKS"),
        json!("finishtostart"),
        json!(""),
        json!(null),
        json!(7),
    ] {
        connection.execute("UPDATE profiles SET configuration=json_set(configuration,'$.effective.dependencies.default_reltype',json(?)) WHERE id='a'", [invalid.to_string()])?;
        assert!(
            matches!(metadata(&engine), Err(RuntimeError::Configuration(_))),
            "{invalid}"
        );
        assert_eq!(counters(&files)?, counters_before);
        let (journals, uploads, conflicts): (i64, i64, i64) = connection.query_row(
            "SELECT (SELECT count(*) FROM journals),(SELECT count(*) FROM outbox),(SELECT count(*) FROM conflicts)", [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)))?;
        assert_eq!((journals, uploads, conflicts), (0, 0, 0));
    }
    Ok(())
}
