//! Exact independent outcomes, never transformed upstream expectations.

use super::TestResult;
use serde_json::{Map, Value, json};
use tasknotes_vault::VaultError;

const ROLES: &[&str] = &[
    "title",
    "status",
    "priority",
    "due",
    "scheduled",
    "completedDate",
    "tags",
    "contexts",
    "projects",
    "attachments",
    "dateCreated",
    "dateModified",
    "recurrence",
    "recurrenceAnchor",
    "completeInstances",
    "skippedInstances",
    "blockedBy",
    "reminders",
    "recurrenceParent",
    "occurrenceDate",
    "occurrenceMaterialization",
    "occurrenceNextTrigger",
    "occurrenceTemplate",
    "occurrencePastHorizon",
    "occurrenceFutureHorizon",
    "archiveTag",
    "icsEventId",
    "icsEventTag",
    "googleCalendarEventId",
    "googleCalendarExceptionEventId",
    "googleCalendarExceptionOriginalScheduled",
    "googleCalendarMovedOriginalDates",
    "sortOrder",
];
const CUSTOM_ROLES: &[&str] = &[
    "title",
    "status",
    "priority",
    "due",
    "scheduled",
    "completedDate",
    "tags",
    "contexts",
    "projects",
    "attachments",
    "dateCreated",
    "dateModified",
    "recurrence",
    "recurrenceAnchor",
    "completeInstances",
    "skippedInstances",
];

pub(super) fn no_issues() -> Value {
    json!({"hasErrors":false,"errorCodes":[],"warningCodes":[],"infoCodes":[],"allCodes":[],"issues":[]})
}

fn expected(id: &str) -> Option<Value> {
    Some(match id {
        "config.0664" | "config.0665" => json!({"value":{}}),
        "config.0668" => json!({"value":{
            "task_detection":{"method":"tag","tag":"task","default_folder":"TaskNotes/Tasks"},
            "archive":{"move_on_archive":false,"folder":"TaskNotes/Archive"},
            "title":{"storage":"filename","filename_format":"title"},
            "defaults":{"status":"open","priority":"normal"},"status":{"default":"open"}
        }}),
        "field.0011" | "field.0018" => mapping(false, true),
        "field.0029" | "field.0036" => mapping(true, true),
        "field.0090" | "field.0097" => mapping(false, false),
        "field.0123" => json!({"normalized":{"mapped_timeEstimate":"PT45M"}}),
        "field.0124" => json!({"denormalized":{"timeEstimate":"PT45M"}}),
        "field.0137" => {
            json!({"normalized":{"mapped_timeEntries":[{"startTime":"2026-08-19T10:00:00Z","endTime":"2026-08-19T10:30:00Z"}]}})
        }
        "field.0138" => {
            json!({"denormalized":{"timeEntries":[{"startTime":"2026-08-19T10:00:00Z","endTime":"2026-08-19T10:30:00Z"}]}})
        }
        "validation.0055" | "validation.0056" => no_issues(),
        _ => return None,
    })
}

fn mapping(custom: bool, reverse: bool) -> Value {
    let mut roles = Map::new();
    let mut fields = Map::new();
    for role in ROLES {
        let field = if custom && CUSTOM_ROLES.contains(role) {
            format!("custom_{role}")
        } else {
            (*role).to_owned()
        };
        roles.insert((*role).to_owned(), json!(field));
        if reverse && (!custom || CUSTOM_ROLES.contains(role)) {
            fields.insert(field, json!(role));
        }
    }
    json!({"roleToField":roles,"fieldToRole":fields,"displayNameKey":if custom {"custom_title"} else {"title"},"completedStatuses":["done","cancelled"]})
}

pub(super) fn verify_result(id: &str, result: &tasknotes_vault::Result<Value>) -> TestResult {
    if let Some(expected) = expected(id) {
        if !matches!(result, Ok(actual) if actual == &expected) {
            return Err(format!(
                "{id}: exact withdrawal outcome mismatch: {result:?}; expected {expected}"
            )
            .into());
        }
    } else {
        let error = match id {
            "config_schema.0008" | "config_schema.0020" | "config_schema.0021" => {
                if !matches!(result, Err(VaultError::Configuration(message)) if message == "config kind unsupported:time_tracking")
                {
                    return Err(format!("{id}: expected typed Configuration(config kind unsupported:time_tracking), got {result:?}").into());
                }
                return Ok(());
            }
            "validation.0057" | "validation.0058" | "validation.0059" | "validation.0060"
            | "ops.0080" | "ops.0081" | "ops.0082" | "ops.0083" | "ops.0084" | "ops.0085"
            | "ops.0086" | "ops.0087" | "ops.0088" | "ops.0089" | "ops.0090" | "ops.0091"
            | "ops.0092" | "ops.0093" | "ops.0094" | "ops.0095" | "ops.0096" | "ops.0097"
            | "ops.0098" | "ops.0099" | "ops.0100" => "unsupported_operation",
            _ => return Err(format!("unapproved timing contract ID: {id}").into()),
        };
        if !matches!(result, Err(VaultError::Document(message)) if message == error) {
            return Err(format!("{id}: expected typed Document({error}), got {result:?}").into());
        }
    }
    Ok(())
}
