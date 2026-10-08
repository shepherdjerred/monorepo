//! Journal-owned Undo eligibility; native draft order never establishes LIFO.

use super::{Engine, Result, RuntimeError};
use rusqlite::OptionalExtension;
use serde_json::{Value, json};

pub(super) struct Entry {
    pub(super) id: String,
    at: Option<String>,
    kind: String,
}

impl Engine {
    pub(super) fn latest_undo(&self, profile: &str) -> Result<Option<Entry>> {
        self.database(|db| {
            let entry=db.query_row(
                "WITH eligible AS (
                   SELECT j.*,j.rowid AS sequence,
                     CASE WHEN json_valid(j.fingerprint) THEN json_extract(j.fingerprint,'$.command.kind')
                       WHEN substr(j.fingerprint,1,11)='resolution:' AND json_valid(substr(j.fingerprint,12)) THEN 'resolve_conflict'
                       ELSE '__invalid__' END AS kind,
                     CASE WHEN json_valid(j.fingerprint) THEN json_extract(j.fingerprint,'$.at') ELSE NULL END AS at
                   FROM journals j WHERE j.profile=?1 AND j.remote=0
                 )
                 SELECT j.id,j.at,j.kind FROM eligible j
                 WHERE j.receipt IS NOT NULL
                   AND json_extract(j.receipt,'$.applied')=1
                   AND j.kind NOT IN ('undo','pomodoro')
                   AND EXISTS(SELECT 1 FROM journal_files f WHERE f.profile=j.profile AND f.id=j.id)
                   AND NOT EXISTS(SELECT 1 FROM journals u WHERE u.profile=j.profile AND u.remote=0
                       AND json_extract(CASE WHEN json_valid(u.fingerprint) THEN u.fingerprint ELSE '{}' END,'$.command.kind')='undo'
                       AND json_extract(CASE WHEN json_valid(u.fingerprint) THEN u.fingerprint ELSE '{}' END,'$.command.receiptId')=j.id
                       AND u.receipt IS NOT NULL AND json_extract(u.receipt,'$.applied')=1)
                 ORDER BY j.sequence DESC LIMIT 1",
                [profile],
                |row| Ok(Entry { id:row.get(0)?,at:row.get(1)?,kind:row.get(2)? }),
            ).optional()?;
            if entry.as_ref().is_some_and(|entry|entry.kind=="__invalid__") {
                return Err(RuntimeError::Storage("Undo journal fingerprint is invalid".to_owned()));
            }
            Ok(entry)
        })
    }

    pub(super) fn undo_available(&self, profile: &str) -> Result<Value> {
        let entry = self.latest_undo(profile)?;
        Ok(
            json!({"schemaVersion":1,"canUndo":entry.is_some(),"receiptId":entry.as_ref().map(|entry|entry.id.as_str()),"at":entry.as_ref().and_then(|entry|entry.at.as_deref()),"commandKind":entry.as_ref().map(|entry|entry.kind.as_str())}),
        )
    }
}
