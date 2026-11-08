//! Known absent prior-schema receipt fields are added within the schema transaction.
//! Existing values are validated, and immutable payload BLOB tables are not touched.

use super::{Connection, Receipt, Result, RuntimeError};
use crate::types::{Diagnostic, deserialize_diagnostics};
use serde::{Deserialize, Serialize};

// Only prior-schema migration permits the historically absent field. Normal
// Receipt deserialization remains strict, including after this transaction.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoricalReceipt {
    mutation_id: String,
    applied: bool,
    #[serde(default)]
    cleanup_pending: bool,
    #[serde(default, deserialize_with = "deserialize_diagnostics")]
    diagnostics: Vec<Diagnostic>,
    #[serde(default)]
    task_path: Option<String>,
    paths: Vec<String>,
    pending_count: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoricalItem {
    mutation_id: String,
    applied: bool,
    receipt: Option<HistoricalReceipt>,
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoricalResult {
    schema_version: u32,
    mutation_id: String,
    total: usize,
    succeeded: usize,
    failed: usize,
    items: Vec<HistoricalItem>,
}

fn corrupt() -> RuntimeError {
    RuntimeError::Storage("invalid historical receipt metadata".into())
}

fn validate_receipt(receipt: &HistoricalReceipt, expected: &str) -> Result<()> {
    if receipt.mutation_id != expected {
        return Err(corrupt());
    }
    let _: Receipt =
        serde_json::from_value(serde_json::to_value(receipt)?).map_err(|_| corrupt())?;
    Ok(())
}

fn validate_item(item: &HistoricalItem) -> Result<()> {
    if item.applied != item.receipt.as_ref().is_some_and(|receipt| receipt.applied) {
        return Err(corrupt());
    }
    if let Some(receipt) = &item.receipt {
        validate_receipt(receipt, &item.mutation_id)?;
        if item.applied != receipt.applied {
            return Err(corrupt());
        }
    }
    Ok(())
}

fn validate_historical(db: &Connection) -> Result<()> {
    let mut query=db.prepare("SELECT 'receipt',id,receipt FROM journals WHERE receipt IS NOT NULL UNION ALL SELECT 'receipt',id,receipt FROM partial_batches WHERE receipt IS NOT NULL UNION ALL SELECT 'item',json_extract(mutation,'$.mutationId'),outcome FROM partial_items WHERE outcome IS NOT NULL UNION ALL SELECT 'result',id,result FROM partial_batches WHERE result IS NOT NULL")?;
    let mut rows = query.query([])?;
    while let Some(row) = rows.next()? {
        let kind: String = row.get(0)?;
        let expected: String = row.get(1)?;
        let json: String = row.get(2)?;
        match kind.as_str() {
            "receipt" => {
                let receipt: HistoricalReceipt =
                    serde_json::from_str(&json).map_err(|_| corrupt())?;
                validate_receipt(&receipt, &expected)?;
            }
            "item" => {
                let item: HistoricalItem = serde_json::from_str(&json).map_err(|_| corrupt())?;
                if item.mutation_id != expected {
                    return Err(corrupt());
                }
                validate_item(&item)?;
            }
            "result" => {
                let result: HistoricalResult =
                    serde_json::from_str(&json).map_err(|_| corrupt())?;
                if result.schema_version != 1
                    || result.mutation_id != expected
                    || result.total != result.items.len()
                    || result.succeeded != result.items.iter().filter(|item| item.applied).count()
                    || result.failed != result.total.saturating_sub(result.succeeded)
                {
                    return Err(corrupt());
                }
                for item in &result.items {
                    validate_item(item)?;
                }
            }
            _ => return Err(corrupt()),
        }
    }
    Ok(())
}

const MIGRATE:&str="
UPDATE journals SET receipt=json_insert(receipt,'$.diagnostics',json('[]')) WHERE receipt IS NOT NULL;
UPDATE partial_batches SET receipt=json_insert(receipt,'$.diagnostics',json('[]')) WHERE receipt IS NOT NULL;
UPDATE partial_items SET outcome=json_insert(outcome,'$.receipt.diagnostics',json('[]')) WHERE json_type(outcome,'$.receipt')='object';
UPDATE partial_batches SET result=json_set(result,'$.items',json((SELECT json_group_array(CASE WHEN json_type(value,'$.receipt')='object' THEN json_insert(value,'$.receipt.diagnostics',json('[]')) ELSE json(value) END) FROM json_each(result,'$.items')))) WHERE result IS NOT NULL;
UPDATE journals SET diagnostics=json_extract(receipt,'$.diagnostics') WHERE receipt IS NOT NULL;
";

pub(super) fn migrate(db: &Connection) -> Result<()> {
    validate_historical(db)?;
    db.execute_batch(MIGRATE)?;
    // Stream bounded receipt metadata; do not collect a vault's journal history.
    let mut query=db.prepare("SELECT receipt FROM journals WHERE receipt IS NOT NULL UNION ALL SELECT receipt FROM partial_batches WHERE receipt IS NOT NULL UNION ALL SELECT json_extract(outcome,'$.receipt') FROM partial_items WHERE json_type(outcome,'$.receipt')='object' UNION ALL SELECT json_extract(value,'$.receipt') FROM partial_batches,json_each(partial_batches.result,'$.items') WHERE json_type(value,'$.receipt')='object'")?;
    let mut rows = query.query([])?;
    while let Some(row) = rows.next()? {
        let json: String = row.get(0)?;
        let _: Receipt = serde_json::from_str(&json)
            .map_err(|_| RuntimeError::Storage("invalid historical receipt metadata".into()))?;
    }
    Ok(())
}
