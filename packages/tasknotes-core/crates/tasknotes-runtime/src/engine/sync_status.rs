//! Content-free durable synchronization progress, read without provider I/O.

use super::{Engine, Profile, ProfileKind, Result, RuntimeError, Value};
use crate::types::SyncStatus;

impl Engine {
    pub(super) fn sync_status(&self, profile: &Profile) -> Result<Value> {
        self.database(|db| {
            // One SQLite statement gives all counts and the barrier from one
            // read snapshot, including when another connection owns the writer.
            let mut status = db.query_row(
                "SELECT version,
                    (SELECT json FROM checkpoints WHERE profile=?1),
                    (SELECT count(*) FROM checkpoint_pending WHERE profile=?1),
                    (SELECT count(*) FROM outbox WHERE profile=?1),
                    (SELECT count(*) FROM conflicts WHERE profile=?1),
                    (SELECT count(*) FROM journals j WHERE profile=?1 AND receipt IS NULL AND NOT EXISTS(SELECT 1 FROM occurrence_successors s WHERE s.profile=j.profile AND s.id=j.id))
                        +(SELECT count(*) FROM partial_batches WHERE profile=?1 AND receipt IS NULL)
                        +(SELECT count(*) FROM occurrence_successors WHERE profile=?1 AND state='pending')
                 FROM profiles WHERE id=?1",
                [&profile.id],
                |row| {
                    Ok((
                        SyncStatus {
                            schema_version: 1,
                            profile_id: profile.id.clone(),
                            profile_kind: profile.kind,
                            version: unsigned(row, 0)?,
                            initial_sync_complete: false,
                            pending_remote_count: unsigned(row, 2)?,
                            pending_upload_count: unsigned(row, 3)?,
                            conflict_count: unsigned(row, 4)?,
                            pending_mutation_count: unsigned(row, 5)?,
                        },
                        row.get::<_, Option<String>>(1)?,
                    ))
                },
            )?;
            let checkpoint = status
                .1
                .as_deref()
                .map(serde_json::from_str::<obsidian_sync::session::Checkpoint>)
                .transpose()
                .map_err(|_| RuntimeError::Storage("invalid durable Sync checkpoint".into()))?;
            if let Some(checkpoint) = &checkpoint {
                checkpoint
                    .validate()
                    .map_err(|_| RuntimeError::Storage("invalid durable Sync checkpoint".into()))?;
                if !checkpoint.pending.is_empty() {
                    return Err(RuntimeError::Storage(
                        "durable Sync checkpoint pending rows are not normalized".into(),
                    ));
                }
            } else if status.0.pending_remote_count != 0 {
                return Err(RuntimeError::Storage(
                    "durable Sync notices have no checkpoint".into(),
                ));
            }
            status.0.initial_sync_complete = profile.kind == ProfileKind::LocalFolder
                || (checkpoint.is_some_and(|checkpoint| !checkpoint.initial)
                    && status.0.pending_remote_count == 0);
            Ok(serde_json::to_value(status.0)?)
        })
    }
}

fn unsigned(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<u64> {
    let value: i64 = row.get(index)?;
    u64::try_from(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Integer,
            Box::new(error),
        )
    })
}
