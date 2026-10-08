//! Versioned interoperability operations over production pure vault semantics.
//!
//! The request adapter never receives a fixture expectation. Callers supply
//! clock/timezone context once; storage effects belong to the durable runtime.

use chrono::NaiveDate;
use serde_json::{Map, Value, json};

use crate::{Result, VaultError, mapping::FieldMapping, relationships, temporal};

/// Temporal context resolved by the native caller for one operation.
pub struct ExecutionContext {
    /// Current local calendar day; the library never reads a clock.
    pub today: NaiveDate,
    /// Effective IANA timezone, supplied by caller/profile resolution.
    pub timezone: String,
    /// Absolute native working directory for lexical configuration paths.
    pub working_directory: String,
}

/// Whether an operation belongs to this pure interoperability adapter.
#[must_use]
pub fn supports(operation: &str) -> bool {
    OPERATIONS.contains(&operation) || crate::migration_policy::OPERATIONS.contains(&operation)
}

/// Operations backed by the pure implementation, used for capability derivation.
pub const OPERATIONS: &[&str] = &[
    "migration.normalize_aliases",
    "migration.normalize_temporal",
    "migration.resolve_instance_overlap",
    "migration.normalize_dependencies",
    "migration.normalize_reminders",
    "migration.normalize_links",
    "migration.compat_mode",
    "migration.report_summary",
    "op.update_patch",
    "op.complete_nonrecurring",
    "op.uncomplete_nonrecurring",
    "op.mutate_with_validation",
    "op.detect_conflict",
    "op.dry_run",
    "op.error_shape",
    "recurrence.uncomplete_instance",
    "recurrence.skip_instance",
    "recurrence.unskip_instance",
    "recurrence.effective_state",
    "templating.parse_sections",
    "templating.expand_variables",
    "templating.tokenize",
    "templating.merge_frontmatter",
    "templating.create_pipeline",
    "templating.handle_failure",
    "templating.config_defaults",
    "templating.profile_claim_requirements",
    "link.parse",
    "link.resolve",
    "link.update_references_on_rename",
    "time.start",
    "time.stop",
    "time.replace_entries",
    "time.remove_entry",
    "time.auto_stop_on_complete",
    "time.report_totals",
    "validation.time_entries",
    "validation.core_evaluate",
    "create_compat.create",
    "recurrence.complete",
    "recurrence.recalculate",
    "date.parse_utc",
    "date.parse_local",
    "date.validate",
    "date.get_part",
    "date.has_time",
    "date.is_same",
    "date.is_before",
    "date.resolve_operation_target",
    "date.day_in_timezone",
    "field.default_mapping",
    "field.build_mapping",
    "field.normalize",
    "field.denormalize",
    "field.is_completed_status",
    "field.default_completed_status",
    "field.resolve_display_title",
    "dependency.validate_entry",
    "dependency.validate_set",
    "dependency.missing_target_behavior",
    "dependency.add",
    "dependency.remove",
    "dependency.replace",
    "reminder.validate_entry",
    "reminder.validate_set",
    "reminder.add",
    "reminder.update",
    "reminder.remove",
    "config.resolve_collection_path",
    "config.spec_version_effective",
    "config.merge_top_level",
    "config.provider_behavior",
    "config.validate_schema",
    "config.map_tasknotes_plugin",
    "config.detect_task_file",
];

/// Execute one request using shared production algorithms; returns the result value.
///
/// # Errors
/// Rejects unknown operations, malformed arguments, and invalid semantic values.
pub fn execute(operation: &str, input: &Value, context: &ExecutionContext) -> Result<Value> {
    if operation.starts_with("migration.") {
        if crate::migration_policy::OPERATIONS.contains(&operation) {
            return crate::migration_policy::execute(operation, input);
        }
        return crate::migration::execute(operation, input);
    }
    if [
        "recurrence.uncomplete_instance",
        "recurrence.skip_instance",
        "recurrence.unskip_instance",
        "recurrence.effective_state",
    ]
    .contains(&operation)
    {
        return crate::operations::instance(operation, input);
    }
    if operation.starts_with("op.") {
        return crate::operations::execute(operation, input, context.today);
    }
    if operation.starts_with("templating.") {
        return crate::templating::execute(operation, input);
    }
    if operation.starts_with("link.") {
        return crate::links::execute(operation, input);
    }
    if operation == "validation.core_evaluate" {
        return crate::validation::evaluate(input);
    }
    if operation.starts_with("time.") || operation == "validation.time_entries" {
        return crate::tracking::execute(
            operation,
            input,
            context.today.and_time(chrono::NaiveTime::MIN).and_utc(),
        );
    }
    if operation == "create_compat.create" {
        let now = input
            .get("fixedNow")
            .and_then(Value::as_str)
            .map(crate::creation::timestamp)
            .transpose()?
            .unwrap_or_else(|| context.today.and_time(chrono::NaiveTime::MIN).and_utc());
        let plan = crate::creation::plan(
            required(input, "taskType")?,
            &object(input, "frontmatter"),
            now,
            &context.timezone,
        )?;
        return Ok(json!({"path":plan.path,"frontmatter":plan.frontmatter,"warnings":[]}));
    }
    if operation.starts_with("recurrence.") {
        return crate::progression::execute(operation, input);
    }
    if operation.starts_with("date.") {
        return date(operation, input, context);
    }
    if operation.starts_with("field.") {
        return field(operation, input);
    }
    if operation.starts_with("dependency.") {
        return dependency(operation, input);
    }
    if operation.starts_with("reminder.") {
        return reminder(operation, input);
    }
    if operation.starts_with("config.") {
        return crate::configuration::execute(operation, input, &context.working_directory);
    }
    Err(invalid("unsupported_operation"))
}

fn date(operation: &str, input: &Value, context: &ExecutionContext) -> Result<Value> {
    let value = text(input, "value");
    let result = match operation {
        "date.parse_utc" => json!({"date":temporal::parse_utc_day(value)?.to_string()}),
        "date.parse_local" => {
            json!({"localDate":temporal::parse_local_day(value,&context.timezone)?.to_string(),"isoDate":temporal::parse_utc_day(value)?.to_string()})
        }
        "date.validate" => json!({"value":temporal::parse_day(value)?.to_string()}),
        "date.get_part" => json!({"value":temporal::date_part(value)?.to_string()}),
        "date.has_time" => json!({"value":temporal::has_time(value)}),
        "date.is_same" | "date.is_before" => {
            let a = temporal::date_part(text(input, "a")).ok();
            let b = temporal::date_part(text(input, "b")).ok();
            json!({"value":a.zip(b).is_some_and(|(a,b)| if operation=="date.is_same" {a==b} else {a<b})})
        }
        "date.resolve_operation_target" => {
            json!({"value":temporal::operation_day(optional_text(input,"explicitDate"),optional_text(input,"scheduled"),optional_text(input,"due"),context.today)?.to_string()})
        }
        "date.day_in_timezone" => {
            json!({"value":temporal::day_in_timezone(text(input,"instant"),text(input,"timezone"))?.to_string()})
        }
        _ => return Err(invalid("unsupported_operation")),
    };
    Ok(result)
}

fn field(operation: &str, input: &Value) -> Result<Value> {
    let mapping = if operation == "field.default_mapping" {
        FieldMapping::default()
    } else {
        FieldMapping::from_fields(
            &object(input, "fields"),
            optional_text(input, "displayNameKey"),
        )?
    };
    let result = match operation {
        "field.default_mapping" | "field.build_mapping" => {
            serde_json::to_value(&mapping).map_err(|_| invalid("invalid_mapping"))?
        }
        "field.normalize" => json!({"normalized":mapping.normalize(&object(input,"frontmatter"))}),
        "field.denormalize" => {
            json!({"denormalized":mapping.denormalize(&object(input,"roleData"))})
        }
        "field.is_completed_status" => {
            json!({"value":optional_text(input,"status").is_some_and(|value|mapping.completed_statuses.iter().any(|status|status==value))})
        }
        "field.default_completed_status" => {
            json!({"value":mapping.completed_statuses.first().map_or("done", String::as_str)})
        }
        "field.resolve_display_title" => {
            json!({"value":mapping.display_title(&object(input,"frontmatter"),optional_text(input,"taskPath"))})
        }
        _ => return Err(invalid("unsupported_operation")),
    };
    Ok(result)
}

fn dependency(operation: &str, input: &Value) -> Result<Value> {
    match operation {
        "dependency.validate_entry" => {
            relationships::validate_dependency(required(input, "entry")?)?;
            Ok(json!({"value":"valid"}))
        }
        "dependency.validate_set" => {
            relationships::validate_dependencies(
                array(input, "entries"),
                optional_text(input, "taskUid"),
            )?;
            Ok(json!({"value":"valid_set"}))
        }
        "dependency.missing_target_behavior" => {
            relationships::validate_dependency(required(input, "entry")?)?;
            if boolean(input, "onWrite") && boolean(input, "requireResolvedUidOnWrite") {
                return Err(invalid("unresolved_dependency_target"));
            }
            Ok(
                json!({"blocked":boolean(input,"treatMissingTargetAsBlocked"),"issue":"unresolved_dependency_target","severity":optional_text(input,"unresolvedTargetSeverity").unwrap_or("warning")}),
            )
        }
        "dependency.add" => {
            let entry = required(input, "entry")?.clone();
            relationships::validate_dependency(&entry)?;
            let mut next = array(input, "current").to_vec();
            next.push(entry);
            Ok(json!({"value":next}))
        }
        "dependency.remove" => {
            let uid = relationships::dependency_identity(text(input, "uid"))?;
            let next = array(input, "current")
                .iter()
                .filter(|entry| {
                    relationships::validate_dependency(entry).ok().as_ref() != Some(&uid)
                })
                .cloned()
                .collect::<Vec<_>>();
            Ok(json!({"value":next}))
        }
        "dependency.replace" => {
            relationships::validate_dependencies(
                array(input, "entries"),
                optional_text(input, "taskUid"),
            )?;
            Ok(json!({"value":array(input,"entries")}))
        }
        _ => Err(invalid("unsupported_operation")),
    }
}

fn reminder(operation: &str, input: &Value) -> Result<Value> {
    match operation {
        "reminder.validate_entry" => {
            relationships::validate_reminder(required(input, "entry")?)?;
            Ok(json!({"value":"valid"}))
        }
        "reminder.validate_set" => {
            relationships::validate_reminders(
                array(input, "entries"),
                &object(input, "frontmatter"),
            )?;
            Ok(json!({"value":"valid_set"}))
        }
        "reminder.add" => {
            let entry = required(input, "entry")?.clone();
            relationships::validate_reminder(&entry)?;
            let mut next = array(input, "current").to_vec();
            next.push(entry);
            Ok(json!({"value":next}))
        }
        "reminder.update" => {
            let mut next = array(input, "current").to_vec();
            let target = next
                .iter_mut()
                .find(|entry| text(entry, "id") == text(input, "id"))
                .ok_or_else(|| invalid("reminder_not_found"))?;
            let object = target
                .as_object_mut()
                .ok_or_else(|| invalid("invalid_reminder_entry"))?;
            object.extend(self::object(input, "patch"));
            relationships::validate_reminder(target)?;
            Ok(json!({"value":next}))
        }
        "reminder.remove" => Ok(
            json!({"value":array(input,"current").iter().filter(|entry|text(entry,"id")!=text(input,"id")).collect::<Vec<_>>()}),
        ),
        _ => Err(invalid("unsupported_operation")),
    }
}

fn text<'a>(input: &'a Value, key: &str) -> &'a str {
    optional_text(input, key).unwrap_or_default()
}
fn optional_text<'a>(input: &'a Value, key: &str) -> Option<&'a str> {
    input.get(key).and_then(Value::as_str)
}
fn object(input: &Value, key: &str) -> Map<String, Value> {
    input
        .get(key)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}
fn array<'a>(input: &'a Value, key: &str) -> &'a [Value] {
    input
        .get(key)
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}
fn boolean(input: &Value, key: &str) -> bool {
    input.get(key).and_then(Value::as_bool) == Some(true)
}
fn required<'a>(input: &'a Value, key: &str) -> Result<&'a Value> {
    input
        .get(key)
        .ok_or_else(|| invalid("invalid_request_schema"))
}
fn invalid(message: &str) -> VaultError {
    VaultError::Document(message.to_owned())
}
