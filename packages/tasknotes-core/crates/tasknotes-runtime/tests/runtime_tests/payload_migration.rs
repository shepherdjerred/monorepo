//! Version9 transactional staging with actual receipts, outbox, conflicts, Undo.

use super::{
    Arc, Command, Engine, Memory, ProfileKind, RuntimeError, create, mutation, profile,
    seed_binary_conflict,
};
use rusqlite::OptionalExtension;
use rusqlite::types::Value;
use std::collections::BTreeMap;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn old_tables(db: &rusqlite::Connection) -> Result<BTreeMap<String, Vec<Vec<Value>>>> {
    let mut tables = BTreeMap::new();
    for table in [
        "profiles",
        "files",
        "journals",
        "journal_files",
        "outbox",
        "conflicts",
        "conflict_archive",
        "journal_remote",
        "device_state",
        "checkpoints",
        "checkpoint_pending",
        "partial_batches",
        "partial_items",
    ] {
        let projection = if table == "journals" {
            "profile,id,fingerprint,writes,receipt,remote,effect,payload_revision,resolution_conflict"
        } else {
            "*"
        };
        let mut statement =
            db.prepare(&format!("SELECT {projection} FROM {table} ORDER BY rowid"))?;
        let names = statement
            .column_names()
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let count = statement.column_count();
        let rows = statement
            .query_map([], |row| {
                (0..count)
                    .map(|index| row.get::<_, Value>(index))
                    .collect::<rusqlite::Result<Vec<_>>>()
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut normalized = rows;
        for row in &mut normalized {
            for (name, value) in names.iter().zip(row.iter_mut()) {
                if ["receipt", "outcome", "result"].contains(&name.as_str())
                    && let Value::Text(json) = value
                {
                    let mut metadata: serde_json::Value = serde_json::from_str(json)?;
                    strip_added_empty_diagnostics(&mut metadata);
                    *json = serde_json::to_string(&metadata)?;
                }
                if ["bytes", "base", "before", "local", "remote"].contains(&name.as_str())
                    && let Value::Text(id) = value
                {
                    *value = Value::Blob(db.query_row(
                        "SELECT bytes FROM transfer_payloads WHERE profile=? AND id=?",
                        rusqlite::params!["a", id.as_str()],
                        |row| row.get(0),
                    )?);
                }
            }
        }
        tables.insert(table.to_owned(), normalized);
    }
    Ok(tables)
}

fn strip_added_empty_diagnostics(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(diagnostics) = map.remove("diagnostics") {
                assert_eq!(
                    diagnostics,
                    serde_json::json!([]),
                    "migration may only add historical empty diagnostics"
                );
            }
            for value in map.values_mut() {
                strip_added_empty_diagnostics(value);
            }
        }
        serde_json::Value::Array(items) => {
            for value in items {
                strip_added_empty_diagnostics(value);
            }
        }
        _ => {}
    }
}

fn make_version_nine(db: &rusqlite::Connection) -> Result<()> {
    remove_version_eleven_metadata(db)?;
    let counter: i64 = db
        .query_row(
            "SELECT seq FROM sqlite_sequence WHERE name='outbox'",
            [],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(0);
    // Produce a genuine old schema with raw BLOBs, not a version number over
    // new reference rows. This fixture conversion is intentionally test-only.
    for (table, binary) in [
        ("files", vec!["bytes", "base"]),
        ("journal_files", vec!["before", "bytes"]),
        ("outbox", vec!["bytes"]),
        ("conflicts", vec!["base", "local", "remote"]),
        ("conflict_archive", vec!["base", "local", "remote"]),
        ("journal_remote", vec!["base"]),
        ("refresh_stage", vec!["bytes"]),
    ] {
        let sql: String = db.query_row(
            "SELECT sql FROM sqlite_schema WHERE name=?",
            [table],
            |row| row.get(0),
        )?;
        let (_, definition) = sql.split_once('(').ok_or("missing private schema")?;
        let new = format!("{table}_v9");
        let mut schema = format!("CREATE TABLE {new} ({definition}");
        for column in &binary {
            schema = schema.replace(&format!("{column} TEXT"), &format!("{column} BLOB"));
        }
        db.execute_batch(&schema)?;
        let mut statement = db.prepare(&format!("PRAGMA table_info({table})"))?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let expressions=columns.iter().map(|column|if binary.contains(&column.as_str()) {format!("(SELECT bytes FROM transfer_payloads WHERE profile=original.profile AND id=original.{column})")}else {format!("original.{column}")}).collect::<Vec<_>>().join(",");
        db.execute(
            &format!(
                "INSERT INTO {new}({}) SELECT {expressions} FROM {table} original",
                columns.join(",")
            ),
            [],
        )?;
        db.execute_batch(&format!(
            "DROP TABLE {table}; ALTER TABLE {new} RENAME TO {table};"
        ))?;
    }
    db.execute(
        "UPDATE sqlite_sequence SET seq=? WHERE name='outbox'",
        [counter],
    )?;
    db.execute("INSERT INTO sqlite_sequence(name,seq) SELECT 'outbox',? WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='outbox')",[counter])?;
    db.execute_batch("DROP TABLE journal_stages; DROP TABLE payload_references; DROP TABLE transfer_payload_state; DROP TABLE transfer_payloads; DROP TABLE engine_metadata; DROP TABLE profile_sync_bindings; ALTER TABLE profiles DROP COLUMN lifetime; PRAGMA user_version=9;")?;
    assert_historical_columns(db, 9)?;
    Ok(())
}

#[test]
fn version_nine_payload_staging_preserves_all_receipts_and_real_undo_after_reopen() -> Result<()> {
    migration_preserves_receipts_and_real_undo(9)
}

#[test]
fn version_ten_origin_migration_preserves_all_receipts_conflicts_and_real_undo() -> Result<()> {
    migration_preserves_receipts_and_real_undo(10)
}

fn make_version_ten(db: &rusqlite::Connection) -> Result<()> {
    remove_version_eleven_metadata(db)?;
    // Small fixture conversion recreates the actual historical v10 schema.
    // Migration itself will not update/rebuild the immutable BLOB table.
    db.execute_batch("UPDATE transfer_payloads SET origin=(SELECT origin FROM transfer_payload_state WHERE transfer_payload_state.row_id=transfer_payloads.row_id); ALTER TABLE transfer_payload_state DROP COLUMN origin; PRAGMA user_version=10;")?;
    assert_historical_columns(db, 10)?;
    Ok(())
}

#[test]
fn malformed_historical_diagnostics_and_partial_shapes_roll_back_unchanged() -> Result<()> {
    for (table, column, field) in [
        ("journals", "receipt", "$.diagnostics"),
        ("partial_batches", "receipt", "$.diagnostics"),
        ("partial_items", "outcome", "$.receipt.diagnostics"),
        (
            "partial_batches",
            "result",
            "$.items[0].receipt.diagnostics",
        ),
    ] {
        for invalid in [
            "null",
            r#"[{"code":"unknown"}]"#,
            r#"[{"code":"template_missing","extra":true}]"#,
            r#"[{"code":"template_missing"},{"code":"template_missing"}]"#,
            r#"[{"code":"template_missing","code":"template_parse_failed"}]"#,
        ] {
            rejected_historical_metadata(table, column, field, invalid)?;
        }
    }
    for (field, invalid) in [
        ("$.items", "null"),
        ("$.items", "{}"),
        ("$.items", "[]"),
        ("$.items[0].receipt.mutationId", r#""foreign""#),
    ] {
        rejected_historical_metadata("partial_batches", "result", field, invalid)?;
    }
    Ok(())
}

fn rejected_historical_metadata(
    table: &str,
    column: &str,
    field: &str,
    invalid: &str,
) -> Result<()> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("invalid-v10.db");
    let path_str = path.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    let engine = Engine::open(path_str, files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    engine.execute(
        "a",
        &mutation(
            "partial",
            Command::BatchPartial {
                commands: vec![create()],
            },
        ),
    )?;
    let original = files.get("a", "Tasks/a.md")?;
    engine.close()?;
    drop(engine);
    let db = rusqlite::Connection::open(&path)?;
    make_version_ten(&db)?;
    db.execute(
        &format!(
            "UPDATE {table} SET {column}=json_set({column},?,json(?)) WHERE {column} IS NOT NULL"
        ),
        [field, invalid],
    )?;
    let before = raw_receipt_metadata(&db)?;
    assert!(
        matches!(
            Engine::open(path_str, files.clone()),
            Err(RuntimeError::Storage(_))
        ),
        "{table}.{column} {field}: {invalid}"
    );
    assert_historical_columns(&db, 10)?;
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))?,
        10
    );
    assert_eq!(raw_receipt_metadata(&db)?, before);
    assert_eq!(files.get("a", "Tasks/a.md")?, original);
    Ok(())
}

fn raw_receipt_metadata(db: &rusqlite::Connection) -> Result<Vec<Option<String>>> {
    Ok(db.prepare("SELECT receipt FROM journals UNION ALL SELECT receipt FROM partial_batches UNION ALL SELECT outcome FROM partial_items UNION ALL SELECT result FROM partial_batches")?
        .query_map([], |row| row.get(0))?.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn assert_historical_columns(db: &rusqlite::Connection, version: u32) -> Result<()> {
    // Exact column orders from the frozen v1..v10 DDL, including all binary owners.
    let mut columns = vec![
        ("profiles", "id,json,configuration,version"),
        (
            "files",
            "profile,path,bytes,base,revision,remote_revision,task,problem,created_ms,modified_ms,related_path,remote_content_hash",
        ),
        (
            "journals",
            "profile,id,fingerprint,writes,receipt,remote,effect,payload_revision,resolution_conflict",
        ),
        (
            "outbox",
            "sequence,profile,id,path,bytes,revision,remote_revision,created_ms,modified_ms,related_path",
        ),
        (
            "conflicts",
            "profile,id,path,json,base,local,remote,base_revision,local_revision,remote_payload_revision",
        ),
        ("checkpoints", "profile,json"),
        ("displaced", "profile,id"),
        ("refresh_stage", "profile,path,bytes,revision,task,problem"),
        ("checkpoint_pending", "profile,uid,json"),
        ("device_state", "profile,device,json"),
        (
            "journal_files",
            "profile,id,ordinal,path,expected,before,bytes",
        ),
        (
            "conflict_archive",
            "profile,journal_id,conflict_id,path,json,base,local,remote,base_revision,local_revision,remote_payload_revision",
        ),
        (
            "journal_remote",
            "profile,journal_id,path,uid,metadata,base",
        ),
        ("partial_batches", "profile,id,fingerprint,receipt,result"),
        ("partial_items", "profile,id,ordinal,mutation,outcome"),
    ];
    if version == 10 {
        columns.retain(|(table, _)| *table != "profiles");
        columns.extend([
            ("profiles", "id,json,configuration,version,lifetime"),
            (
                "transfer_payloads",
                "row_id,profile,id,size,revision,origin,bytes",
            ),
            ("transfer_payload_state", "row_id,written,sealed"),
            (
                "payload_references",
                "profile,payload_id,kind,owner,expected_previous",
            ),
            ("engine_metadata", "key,value"),
            ("profile_sync_bindings", "profile,vault_id,binding_epoch"),
            (
                "journal_stages",
                "profile,id,ordinal,operation_id,stage_id,backup_id,cleanup_pending",
            ),
        ]);
    }
    for (table, expected) in columns {
        let actual = db
            .prepare(&format!("PRAGMA table_info({table})"))?
            .query_map([], |r| r.get::<_, String>(1))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        assert_eq!(
            actual.join(","),
            expected,
            "genuine historical v{version} columns for {table}"
        );
    }
    Ok(())
}

fn remove_version_eleven_metadata(db: &rusqlite::Connection) -> Result<()> {
    db.execute_batch("UPDATE journals SET receipt=json_remove(receipt,'$.diagnostics') WHERE receipt IS NOT NULL; UPDATE partial_batches SET receipt=json_remove(receipt,'$.diagnostics') WHERE receipt IS NOT NULL; UPDATE partial_items SET outcome=json_remove(outcome,'$.receipt.diagnostics') WHERE outcome IS NOT NULL; ALTER TABLE journals DROP COLUMN diagnostics; ALTER TABLE journals DROP COLUMN title_plans; DROP TABLE title_lineage;")?;
    let rows=db.prepare("SELECT profile,id,json_array_length(result,'$.items') FROM partial_batches WHERE result IS NOT NULL")?.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,u32>(2)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
    for (profile, id, count) in rows {
        for index in 0..count {
            db.execute(
                "UPDATE partial_batches SET result=json_remove(result,?) WHERE profile=? AND id=?",
                rusqlite::params![format!("$.items[{index}].receipt.diagnostics"), profile, id],
            )?;
        }
    }
    let columns = db
        .prepare("PRAGMA table_info(journals)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    assert_eq!(
        columns,
        [
            "profile",
            "id",
            "fingerprint",
            "writes",
            "receipt",
            "remote",
            "effect",
            "payload_revision",
            "resolution_conflict"
        ]
    );
    Ok(())
}

fn migration_preserves_receipts_and_real_undo(version: u32) -> Result<()> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("v9.db");
    let path_str = path.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    files.seed("a", "tasknotes.yaml", b"title:\n  storage: frontmatter\n")?;
    let engine = Engine::open(path_str, files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("original-create", create()))?;
    let original = files.get("a", "Tasks/a.md")?;
    let edit = mutation(
        "original-edit",
        Command::Update {
            path: "Tasks/a.md".to_owned(),
            expected_revision: None,
            properties: serde_json::Map::from_iter([(
                "contexts".to_owned(),
                serde_json::json!(["changed"]),
            )]),
            body: None,
        },
    );
    let receipt = engine.execute("a", &edit)?;
    let partial = mutation(
        "historical-partial",
        Command::BatchPartial {
            commands: vec![Command::Update {
                path: "Tasks/a.md".into(),
                expected_revision: None,
                properties: serde_json::Map::new(),
                body: None,
            }],
        },
    );
    engine.execute("a", &partial)?;
    let conflict = seed_binary_conflict(&engine, &files)?;
    engine.close()?;
    drop(engine);
    let db = rusqlite::Connection::open(&path)?;
    if version == 9 {
        make_version_nine(&db)?;
    } else {
        make_version_ten(&db)?;
    }
    let before = old_tables(&db)?;
    let engine = Engine::open(path_str, files.clone())?;
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))?,
        11
    );
    assert_eq!(old_tables(&db)?, before);
    assert_migrated_receipt_metadata(&db, &engine, &partial)?;
    assert_eq!(
        serde_json::to_value(engine.execute("a", &edit)?)?,
        serde_json::to_value(&receipt)?
    );
    assert_eq!(
        engine.conflicts("a")?.first().map(|item| &item.id),
        Some(&conflict.id)
    );
    let retained = retained_before_image(&db, &engine)?;
    let original = original.ok_or(RuntimeError::NotFound)?;
    let mut actual = vec![0; usize::try_from(retained.size)?];
    engine.read_payload_into("a", &retained.id, 0, &mut actual)?;
    assert_eq!(actual, original);
    engine.execute(
        "a",
        &mutation(
            "undo-after-migration",
            Command::Undo {
                receipt_id: receipt.mutation_id,
            },
        ),
    )?;
    assert_eq!(files.get("a", "Tasks/a.md")?, Some(original));
    Ok(())
}

fn assert_migrated_receipt_metadata(
    db: &rusqlite::Connection,
    engine: &Engine,
    partial: &tasknotes_runtime::types::Mutation,
) -> Result<()> {
    assert!(
        serde_json::to_value(engine.execute("a", partial)?)?
            .get("diagnostics")
            .is_some()
    );
    let result: serde_json::Value = serde_json::from_str(&engine.features_json(
        "a",
        r#"{"kind":"batch_outcome","mutationId":"historical-partial"}"#,
    )?)?;
    assert_eq!(
        result.pointer("/items/0/receipt/diagnostics"),
        Some(&serde_json::json!([]))
    );
    let child: serde_json::Value = serde_json::from_str(&db.query_row(
        "SELECT outcome FROM partial_items WHERE id='historical-partial'",
        [],
        |r| r.get::<_, String>(0),
    )?)?;
    assert_eq!(
        child.pointer("/receipt/diagnostics"),
        Some(&serde_json::json!([]))
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM journals WHERE diagnostics<>'[]' OR title_plans<>'[]'",
            [],
            |r| r.get::<_, i64>(0)
        )?,
        0
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM title_lineage", [], |r| r
            .get::<_, i64>(0))?,
        0
    );
    let canonical: serde_json::Value = serde_json::from_str(&engine.features_json(
        "a",
        r#"{"kind":"mutation_receipt","mutationId":"original-edit"}"#,
    )?)?;
    assert_eq!(
        canonical.pointer("/receipt/diagnostics"),
        Some(&serde_json::json!([]))
    );
    Ok(())
}

fn retained_before_image(
    db: &rusqlite::Connection,
    engine: &Engine,
) -> Result<tasknotes_runtime::types::PayloadInfo> {
    let image_count: i64 = db.query_row(
        "SELECT count(*) FROM transfer_payloads WHERE bytes IS NOT NULL",
        [],
        |row| row.get(0),
    )?;
    let reference_count:i64=db.query_row("SELECT (SELECT count(*) FROM files WHERE bytes IS NOT NULL)+(SELECT count(*) FROM files WHERE base IS NOT NULL)+(SELECT count(*) FROM journal_files WHERE before IS NOT NULL)+(SELECT count(*) FROM journal_files WHERE bytes IS NOT NULL)+(SELECT count(*) FROM outbox WHERE bytes IS NOT NULL)+(SELECT count(*) FROM conflicts WHERE base IS NOT NULL)+(SELECT count(*) FROM conflicts WHERE local IS NOT NULL)+(SELECT count(*) FROM conflicts WHERE remote IS NOT NULL)",[],|row|row.get(0))?;
    assert!(
        reference_count > image_count,
        "equal immutable images should share their profile-owned payload row"
    );
    let keys = serde_json::to_string(&["original-edit", "0"])?;
    let actual_keys: String = db.query_row(
        "SELECT json_array(id,ordinal) FROM journal_files WHERE id='original-edit' AND ordinal=0",
        [],
        |row| row.get(0),
    )?;
    assert_ne!(
        keys, actual_keys,
        "ordinal JSON must retain its numeric type"
    );
    let image: String = db.query_row(
        "SELECT before FROM journal_files WHERE profile='a' AND id='original-edit' AND ordinal=0",
        [],
        |row| row.get(0),
    )?;
    let retained = engine.payload_info("a", &image)?;
    assert!(matches!(
        engine.discard_payload("a", &image),
        Err(RuntimeError::Conflict)
    ));
    Ok(retained)
}

#[test]
fn migration_failure_rolls_back_schema_and_every_prior_image_then_retries_exactly() -> Result<()> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("failed-v9.db");
    let path_str = path.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    let engine = Engine::open(path_str, files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("original-create", create()))?;
    engine.ingest_remote("a", "broken.bin", Some(b"valid original"), "1")?;
    engine.close()?;
    drop(engine);
    let db = rusqlite::Connection::open(&path)?;
    make_version_nine(&db)?;
    db.execute("UPDATE files SET bytes=7 WHERE path='broken.bin'", [])?;
    let before = old_tables(&db)?;
    assert!(matches!(
        Engine::open(path_str, files.clone()),
        Err(RuntimeError::Storage(_))
    ));
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))?,
        9
    );
    assert_eq!(old_tables(&db)?, before);
    let new_tables:i64=db.query_row("SELECT count(*) FROM sqlite_schema WHERE type='table' AND name IN ('transfer_payloads','payload_references','engine_metadata')",[],|row|row.get(0))?;
    assert_eq!(new_tables, 0);
    db.execute(
        "UPDATE files SET bytes=? WHERE path='broken.bin'",
        [b"valid original".as_slice()],
    )?;
    let repaired = old_tables(&db)?;
    let engine = Engine::open(path_str, files)?;
    assert_eq!(old_tables(&db)?, repaired);
    assert_eq!(
        engine
            .payload_info(
                "a",
                &format!(
                    "blob:{}",
                    tasknotes_vault::document::ContentRevision::of(b"valid original").as_str()
                )
            )?
            .written,
        u64::try_from(b"valid original".len())?
    );
    Ok(())
}

#[test]
fn migration_preserves_deleted_upload_sequence_high_water() -> Result<()> {
    migration_preserves_high_water(9)
}

#[test]
fn origin_migration_preserves_deleted_upload_sequence_high_water() -> Result<()> {
    migration_preserves_high_water(10)
}

fn migration_preserves_high_water(version: u32) -> Result<()> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("sequence-v9.db");
    let path_str = path.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    let engine = Engine::open(path_str, files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    for (id, path) in [("first", "Tasks/a.md"), ("second", "Tasks/b.md")] {
        let mut command = create();
        if let Command::Create { path: target, .. } = &mut command {
            *target = Some(path.to_owned());
        }
        engine.execute("a", &mutation(id, command))?;
        let head = engine
            .pending_upload_metadata("a")?
            .into_iter()
            .next()
            .ok_or(RuntimeError::NotFound)?;
        engine.acknowledge_upload(
            "a",
            &head.mutation_id,
            head.content_revision
                .as_deref()
                .ok_or(RuntimeError::NotFound)?,
        )?;
    }
    engine.close()?;
    drop(engine);
    let db = rusqlite::Connection::open(&path)?;
    let high_water: i64 = db.query_row(
        "SELECT seq FROM sqlite_sequence WHERE name='outbox'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(high_water, 2);
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM sqlite_sequence WHERE name='outbox'",
            [],
            |row| row.get::<_, i64>(0)
        )?,
        1
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM outbox", [], |row| row
            .get::<_, i64>(0))?,
        0
    );
    if version == 9 {
        make_version_nine(&db)?;
    } else {
        make_version_ten(&db)?;
    }
    let engine = Engine::open(path_str, files)?;
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM sqlite_sequence WHERE name='outbox'",
            [],
            |row| row.get::<_, i64>(0)
        )?,
        1
    );
    assert_eq!(
        db.query_row(
            "SELECT seq FROM sqlite_sequence WHERE name='outbox'",
            [],
            |row| row.get::<_, i64>(0)
        )?,
        high_water
    );
    let mut command = create();
    if let Command::Create { path, .. } = &mut command {
        *path = Some("Tasks/c.md".to_owned());
    }
    engine.execute("a", &mutation("third", command))?;
    assert_eq!(
        db.query_row("SELECT sequence FROM outbox", [], |row| row
            .get::<_, i64>(0))?,
        high_water + 1
    );
    Ok(())
}

#[test]
fn identical_content_after_disposition_gets_a_new_image_without_reviving_retired_identity()
-> Result<()> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("retired.db");
    let files = Arc::new(Memory::default());
    let engine = Engine::open(path.to_str().ok_or(RuntimeError::NotFound)?, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    files.seed("a", "asset.bin", b"same immutable content")?;
    engine.refresh("a")?;
    let db = rusqlite::Connection::open(&path)?;
    let old: String = db.query_row(
        "SELECT bytes FROM files WHERE path='asset.bin'",
        [],
        |row| row.get(0),
    )?;
    files
        .state
        .lock()
        .unwrap()
        .files
        .remove(&("a".into(), "asset.bin".into()));
    engine.refresh("a")?;
    engine.discard_payload("a", &old)?;
    assert_eq!(
        engine.payload_info("a", &old)?.state,
        tasknotes_runtime::types::PayloadState::Discarded
    );
    files.seed("a", "asset.bin", b"same immutable content")?;
    engine.refresh("a")?;
    let new: String = db.query_row(
        "SELECT bytes FROM files WHERE path='asset.bin'",
        [],
        |row| row.get(0),
    )?;
    assert_ne!(new, old);
    assert_eq!(
        engine.payload_info("a", &new)?.revision,
        engine.payload_info("a", &old)?.revision
    );
    assert_eq!(
        engine.payload_info("a", &old)?.state,
        tasknotes_runtime::types::PayloadState::Discarded
    );
    assert!(matches!(
        engine.discard_payload("a", &new),
        Err(RuntimeError::Conflict)
    ));
    Ok(())
}
