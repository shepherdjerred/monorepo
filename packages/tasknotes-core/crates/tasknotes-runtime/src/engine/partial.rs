//! Durable partial-success orchestration; each item uses the normal file journal.

use super::{
    Engine, Mutation, Receipt, Result, RuntimeError, checked_stored_receipt, count, lock_profile,
    validate_identity,
};
use crate::types::Command;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Item {
    mutation_id: String,
    applied: bool,
    receipt: Option<Receipt>,
    error: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BatchResult {
    schema_version: u32,
    mutation_id: String,
    total: usize,
    succeeded: usize,
    failed: usize,
    items: Vec<Item>,
}

impl Engine {
    pub(super) fn execute_partial(
        &self,
        id: &str,
        mutation: &Mutation,
        commands: &[Command],
    ) -> Result<Receipt> {
        let fingerprint = serde_json::to_string(mutation)?;
        {
            let coordinator = self.coordinator(id)?;
            let _operation = lock_profile(&coordinator)?;
            self.profile(id)?;
            if let Some(receipt) =
                self.existing_receipt(id, &mutation.mutation_id, &fingerprint, None)?
            {
                return Ok(receipt);
            }
            self.prepare_partial(id, mutation, commands, &fingerprint)?;
        }
        // Every item obtains the ordinary profile operation guard. An uncertain
        // item stays pending, so a restarted batch retries its original receipt
        // before advancing. Partial success does not imply a group transaction.
        let mut items = Vec::with_capacity(commands.len());
        for ordinal in 0..commands.len() {
            items.push(self.execute_partial_item(id, &mutation.mutation_id, ordinal)?);
        }
        self.complete_partial(id, &mutation.mutation_id, &items)
    }

    fn prepare_partial(
        &self,
        id: &str,
        mutation: &Mutation,
        commands: &[Command],
        fingerprint: &str,
    ) -> Result<()> {
        self.database(|db| {
            let tx = db.transaction()?;
            let exists: i64 = tx.query_row(
                "SELECT count(*) FROM journals WHERE profile=? AND id=?",
                params![id, mutation.mutation_id],
                |row| row.get(0),
            )?;
            if exists != 0 {
                return Err(RuntimeError::Validation(
                    "mutation identity belongs to a file journal".to_owned(),
                ));
            }
            let previous: Option<String> = tx
                .query_row(
                    "SELECT fingerprint FROM partial_batches WHERE profile=? AND id=?",
                    params![id, mutation.mutation_id],
                    |row| row.get(0),
                )
                .optional()?;
            if let Some(previous) = previous {
                if previous != fingerprint {
                    return Err(RuntimeError::Validation(
                        "partial batch identity was reused with different input".to_owned(),
                    ));
                }
            } else {
                tx.execute(
                    "INSERT INTO partial_batches(profile,id,fingerprint) VALUES(?,?,?)",
                    params![id, mutation.mutation_id, fingerprint],
                )?;
                for (ordinal, command) in commands.iter().enumerate() {
                    let child = Mutation {
                        mutation_id: format!("partial:{}:{ordinal}", mutation.mutation_id),
                        command: command.clone(),
                        ..mutation.clone()
                    };
                    validate_identity(&child.mutation_id)?;
                    tx.execute(
                        "INSERT INTO partial_items(profile,id,ordinal,mutation) VALUES(?,?,?,?)",
                        params![
                            id,
                            mutation.mutation_id,
                            i64::try_from(ordinal).map_err(|_| RuntimeError::Validation(
                                "batch ordinal overflow".to_owned()
                            ))?,
                            serde_json::to_string(&child)?
                        ],
                    )?;
                }
            }
            tx.commit()?;
            Ok(())
        })
    }

    fn execute_partial_item(&self, id: &str, batch: &str, ordinal: usize) -> Result<Item> {
        let ordinal = i64::try_from(ordinal)
            .map_err(|_| RuntimeError::Validation("batch ordinal overflow".to_owned()))?;
        let (mutation, outcome): (String, Option<String>) = self.database(|db| {
            Ok(db.query_row(
                "SELECT mutation,outcome FROM partial_items WHERE profile=? AND id=? AND ordinal=?",
                params![id, batch, ordinal],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?)
        })?;
        if let Some(outcome) = outcome {
            let item: Item = serde_json::from_str(&outcome)
                .map_err(|_| RuntimeError::Storage("invalid stored partial item".into()))?;
            self.validate_partial_item(id, &item)?;
            return Ok(item);
        }
        let mutation: Mutation = serde_json::from_str(&mutation)?;
        let item = match self.execute(id, &mutation) {
            Ok(receipt) => Item {
                mutation_id: mutation.mutation_id.clone(),
                applied: receipt.applied,
                error: (!receipt.applied).then(|| RuntimeError::Conflict.to_string()),
                receipt: Some(receipt),
            },
            Err(error) => {
                let state = self.mutation_receipt(id, &mutation.mutation_id)?;
                if state.get("state").and_then(Value::as_str) == Some("pending") {
                    return Err(error);
                }
                Item {
                    mutation_id: mutation.mutation_id.clone(),
                    applied: false,
                    receipt: None,
                    error: Some(error.to_string()),
                }
            }
        };
        self.database(|db| {
            db.execute("UPDATE partial_items SET outcome=coalesce(outcome,?) WHERE profile=? AND id=? AND ordinal=?",params![serde_json::to_string(&item)?,id,batch,ordinal])?;
            Ok(())
        })?;
        Ok(item)
    }

    fn validate_partial_item(&self, profile: &str, item: &Item) -> Result<()> {
        if item.applied != item.receipt.as_ref().is_some_and(|receipt| receipt.applied) {
            return Err(RuntimeError::Storage(
                "invalid stored partial application".into(),
            ));
        }
        if let Some(receipt) = &item.receipt {
            self.database(|db| {
                checked_stored_receipt(
                    db,
                    profile,
                    &item.mutation_id,
                    &serde_json::to_string(receipt)?,
                )
                .map(|_| ())
            })?;
        }
        Ok(())
    }

    fn complete_partial(&self, id: &str, batch: &str, items: &[Item]) -> Result<Receipt> {
        let paths = items
            .iter()
            .filter(|item| item.applied)
            .filter_map(|item| item.receipt.as_ref())
            .flat_map(|receipt| receipt.paths.iter().cloned())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        let succeeded = items.iter().filter(|item| item.applied).count();
        self.database(|db| {
            let tx=db.transaction()?;
            let receipt=Receipt {mutation_id:batch.to_owned(),applied:true,task_path:None,diagnostics:Vec::new(),cleanup_pending:items.iter().filter_map(|item|item.receipt.as_ref()).any(|receipt|receipt.cleanup_pending),paths,pending_count:count(&tx,"outbox",id)?};
            let result=json!({"schemaVersion":1,"mutationId":batch,"total":items.len(),"succeeded":succeeded,"failed":items.len()-succeeded,"items":items});
            tx.execute("UPDATE partial_batches SET receipt=?,result=? WHERE profile=? AND id=?",params![serde_json::to_string(&receipt)?,serde_json::to_string(&result)?,id,batch])?;
            tx.commit()?;Ok(receipt)
        })
    }

    pub(super) fn partial_outcome(&self, id: &str, batch: &str) -> Result<Value> {
        validate_identity(batch)?;
        let result: Option<String> = self.database(|db| {
            db.query_row(
                "SELECT result FROM partial_batches WHERE profile=? AND id=?",
                params![id, batch],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(RuntimeError::NotFound)
        })?;
        let parsed: BatchResult = serde_json::from_str(&result.ok_or(RuntimeError::Conflict)?)
            .map_err(|_| RuntimeError::Storage("invalid stored partial result".into()))?;
        if parsed.schema_version != 1
            || parsed.mutation_id != batch
            || parsed.total != parsed.items.len()
            || parsed.succeeded != parsed.items.iter().filter(|item| item.applied).count()
            || parsed.failed != parsed.total.saturating_sub(parsed.succeeded)
        {
            return Err(RuntimeError::Storage(
                "invalid stored partial identity".into(),
            ));
        }
        for item in &parsed.items {
            self.validate_partial_item(id, item)?;
        }
        let mut result = serde_json::to_value(parsed)?;
        if let Some(items) = result.get_mut("items").and_then(Value::as_array_mut) {
            for item in items {
                if let Some(receipt) = item.get_mut("receipt").filter(|value| !value.is_null()) {
                    let canonical: Receipt =
                        serde_json::from_value(receipt.clone()).map_err(|_| {
                            RuntimeError::Storage("invalid stored child receipt".into())
                        })?;
                    *receipt = serde_json::to_value(canonical)?;
                    receipt
                        .as_object_mut()
                        .ok_or_else(|| RuntimeError::Storage("partial receipt is corrupt".into()))?
                        .insert("schemaVersion".to_owned(), json!(1));
                }
            }
        }
        Ok(result)
    }
}
