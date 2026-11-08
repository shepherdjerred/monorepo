//! Real receipts, replay and user Undo ownership for automatic windows.
use super::{Command, Fixture, PARENT, Result, json, mutation, request};
use tasknotes_runtime::types::{Mutation, OccurrenceWindowOrigin};

fn window(f: &Fixture, id: &str, origin: Option<OccurrenceWindowOrigin>) -> Result<Mutation> {
    let mut command = request(f, id)?;
    let Command::MaterializeOccurrenceWindow { origin: value, .. } = &mut command.command else {
        return Err("window command".into());
    };
    *value = origin;
    Ok(command)
}

fn parent_only() -> Result<Fixture> {
    let f = Fixture::new()?;
    let original = String::from_utf8(f.bytes(PARENT)?)?;
    let bytes = original.replace(
        "---\r\nParent body\r\n",
        "occurrence_materialization: rolling\r\n---\r\nParent body\r\n",
    );
    f.files.seed("a", PARENT, bytes.as_bytes())?;
    f.engine.refresh("a")?;
    Ok(f)
}

#[test]
fn automatic_window_preserves_user_undo_after_reopen_and_exact_replay() -> Result {
    let f = Fixture::new()?;
    let first = f.series("rolling", "scheduled", "completion")?;
    let owner = f.feature(&json!({"kind":"undo_available"}))?;
    assert_eq!(owner["receiptId"], "first-child");
    let command = window(
        &f,
        "automatic",
        Some(OccurrenceWindowOrigin::AutomaticMaintenance),
    )?;
    let receipt = f.engine.execute("a", &command)?;
    assert_ne!(receipt.paths.len(), 0);
    assert_eq!(f.feature(&json!({"kind":"undo_available"}))?, owner);
    let counts = f.counts()?;
    let exchanges = f.exchanges()?;
    let f = f.reopen()?;
    assert_eq!(
        serde_json::to_value(f.engine.execute("a", &command)?)?,
        serde_json::to_value(&receipt)?
    );
    assert_eq!(f.counts()?, counts);
    assert_eq!(f.exchanges()?, exchanges);
    assert_eq!(f.feature(&json!({"kind":"undo_available"}))?, owner);
    f.engine.execute(
        "a",
        &mutation(
            "undo-user",
            Command::Undo {
                receipt_id: "first-child".into(),
            },
        ),
    )?;
    assert!(f.files.get("a", &first)?.is_none());
    for child in receipt.paths {
        assert!(f.files.get("a", &child)?.is_some());
    }
    Ok(())
}

#[test]
fn automatic_only_has_no_user_undo_but_explicit_window_owns_its_children() -> Result {
    for origin in [
        None,
        Some(OccurrenceWindowOrigin::User),
        Some(OccurrenceWindowOrigin::AutomaticMaintenance),
    ] {
        let f = parent_only()?;
        let request = window(&f, "window", origin)?;
        let receipt = f.engine.execute("a", &request)?;
        assert_ne!(receipt.paths.len(), 0);
        let f = f.reopen()?;
        let available = f.feature(&json!({"kind":"undo_available"}))?;
        if origin == Some(OccurrenceWindowOrigin::AutomaticMaintenance) {
            assert_eq!(available["canUndo"], false);
            assert!(available["receiptId"].is_null());
            assert!(
                f.engine
                    .execute(
                        "a",
                        &mutation(
                            "forbidden-undo",
                            Command::Undo {
                                receipt_id: "window".into()
                            }
                        )
                    )
                    .is_err()
            );
            for child in receipt.paths {
                assert!(f.files.get("a", &child)?.is_some());
            }
        } else {
            assert_eq!(available["receiptId"], "window");
            f.engine.execute(
                "a",
                &mutation(
                    "undo-window",
                    Command::Undo {
                        receipt_id: "window".into(),
                    },
                ),
            )?;
            for child in receipt.paths {
                assert!(f.files.get("a", &child)?.is_none());
            }
        }
    }
    Ok(())
}

#[test]
fn origin_omission_retains_legacy_fingerprint_and_explicit_origin_is_immutable() -> Result {
    let f = parent_only()?;
    let request = window(&f, "legacy", None)?;
    let encoded = serde_json::to_string(&request)?;
    assert!(!encoded.contains("origin"));
    let receipt = f.engine.execute("a", &request)?;
    let db = rusqlite::Connection::open(&f.database)?;
    let fingerprint: String = db.query_row(
        "SELECT fingerprint FROM journals WHERE id='legacy'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(fingerprint, encoded);
    drop(db);
    let f = f.reopen()?;
    let decoded: Mutation = serde_json::from_str(&fingerprint)?;
    assert_eq!(
        serde_json::to_value(f.engine.execute("a", &decoded)?)?,
        serde_json::to_value(receipt)?
    );
    assert!(
        f.engine
            .execute(
                "a",
                &window(&f, "legacy", Some(OccurrenceWindowOrigin::User))?
            )
            .is_err()
    );
    Ok(())
}

#[test]
fn unknown_null_wrong_type_and_wrong_operation_origins_fail_before_effects() -> Result {
    let f = parent_only()?;
    let request = serde_json::to_value(window(&f, "invalid-origin", None)?)?;
    let counts = f.counts()?;
    let exchanges = f.exchanges()?;
    let parent = f.bytes(PARENT)?;
    for origin in [json!("bypass_undo"), json!(null), json!(true), json!(7)] {
        let mut invalid = request.clone();
        invalid["command"]["origin"] = origin;
        assert!(serde_json::from_value::<Mutation>(invalid).is_err());
    }
    for command in [
        json!({"kind":"create","properties":{"title":"Never created"},"origin":"automatic_maintenance"}),
        json!({"kind":"repair_occurrence_progression","progressionId":"x","expectedParentRevision":"a".repeat(64),"expectedChildRevision":"a".repeat(64),"origin":"automatic_maintenance"}),
    ] {
        let mut invalid = request.clone();
        invalid["command"] = command;
        assert!(serde_json::from_value::<Mutation>(invalid).is_err());
    }
    assert_eq!(f.counts()?, counts);
    assert_eq!(f.exchanges()?, exchanges);
    assert_eq!(f.bytes(PARENT)?, parent);
    Ok(())
}
