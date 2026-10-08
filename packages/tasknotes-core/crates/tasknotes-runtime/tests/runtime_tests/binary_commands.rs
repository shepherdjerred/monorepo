//! Binary moves/deletes share immutable images and genuine durable Undo plans.

use super::{Arc, Command, Engine, Memory, ProfileKind, RuntimeError, mutation, profile};
use tasknotes_vault::document::ContentRevision;
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[test]
fn binary_rename_delete_and_undo_keep_one_image_without_inline_planning() -> Result<()> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("binary.db");
    let files = Arc::new(Memory::default());
    let bytes = vec![2; 1024 * 1024 + 17];
    files.seed("a", "asset.bin", &bytes)?;
    let engine = Engine::open(path.to_str().ok_or(RuntimeError::NotFound)?, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let db = rusqlite::Connection::open(path)?;
    let image: String = db.query_row(
        "SELECT bytes FROM files WHERE profile='a' AND path='asset.bin'",
        [],
        |row| row.get(0),
    )?;
    engine.execute(
        "a",
        &mutation(
            "move",
            Command::Rename {
                path: "asset.bin".into(),
                new_path: "renamed.bin".into(),
                expected_revision: Some(ContentRevision::of(&bytes).as_str().to_owned()),
            },
        ),
    )?;
    assert_eq!(files.get("a", "asset.bin")?, None);
    assert_eq!(files.get("a", "renamed.bin")?, Some(bytes.clone()));
    assert_eq!(
        db.query_row(
            "SELECT bytes FROM files WHERE profile='a' AND path='renamed.bin'",
            [],
            |row| row.get::<_, String>(0)
        )?,
        image
    );
    engine.execute(
        "a",
        &mutation(
            "delete",
            Command::Delete {
                path: "renamed.bin".into(),
                expected_revision: Some(ContentRevision::of(&bytes).as_str().to_owned()),
            },
        ),
    )?;
    assert_eq!(files.get("a", "renamed.bin")?, None);
    engine.execute(
        "a",
        &mutation(
            "undo-delete",
            Command::Undo {
                receipt_id: "delete".into(),
            },
        ),
    )?;
    assert_eq!(files.get("a", "renamed.bin")?, Some(bytes));
    assert_eq!(
        db.query_row("SELECT count(*) FROM transfer_payloads", [], |row| row
            .get::<_, i64>(0))?,
        1,
        "same captured bytes must not become SQL BLOB copies"
    );
    Ok(())
}

#[test]
fn atomic_binary_moves_plan_virtual_paths_before_a_single_durable_journal() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed("a", "asset.bin", b"opaque\0binary")?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let receipt = engine.execute(
        "a",
        &mutation(
            "chain",
            Command::Batch {
                commands: vec![
                    Command::Rename {
                        path: "asset.bin".into(),
                        new_path: "middle.bin".into(),
                        expected_revision: None,
                    },
                    Command::Rename {
                        path: "middle.bin".into(),
                        new_path: "final.bin".into(),
                        expected_revision: None,
                    },
                ],
            },
        ),
    )?;
    assert!(receipt.applied);
    assert_eq!(files.get("a", "asset.bin")?, None);
    assert_eq!(files.get("a", "middle.bin")?, None);
    assert_eq!(
        files.get("a", "final.bin")?,
        Some(b"opaque\0binary".to_vec())
    );
    engine.execute(
        "a",
        &mutation(
            "undo-chain",
            Command::Undo {
                receipt_id: "chain".into(),
            },
        ),
    )?;
    assert_eq!(
        files.get("a", "asset.bin")?,
        Some(b"opaque\0binary".to_vec())
    );
    assert_eq!(files.get("a", "final.bin")?, None);
    Ok(())
}
