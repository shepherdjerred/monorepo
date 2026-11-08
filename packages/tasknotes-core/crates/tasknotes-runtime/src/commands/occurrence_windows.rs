//! Explicit finite rolling generation; planning never publishes provider bytes.
use super::{Map, Result, RuntimeError, Value, occurrences, planned_view::PlannedView};
use crate::types::{Command, Mutation, VaultFiles};
use chrono::{Datelike, Days, NaiveDate};
use serde::{Deserialize, Serialize};
use tasknotes_core::recurrence::{DateWindow, Recurrence};
use tasknotes_vault::{config::TaskNotesConfiguration, reminder_schedule, temporal};

pub(crate) const MAX_NEW_CHILDREN: usize = 1000;
const MAX_WINDOW_DAYS: i64 = 100_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Entry {
    pub date: String,
    pub reads: occurrences::ReadPlan,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReadPlan {
    pub parent_path: String,
    pub parent_revision: String,
    pub reference_date: String,
    pub start: String,
    pub end: String,
    pub parent_field: String,
    pub date_field: String,
    pub entries: Vec<Entry>,
}
pub(crate) struct Plan {
    pub reads: ReadPlan,
    pub children: Vec<occurrences::Plan>,
}
fn invalid(message: &str) -> RuntimeError {
    RuntimeError::Validation(message.into())
}

fn setting<'a>(
    effective: &'a Value,
    values: &'a Map<String, Value>,
    role: &str,
    key: &str,
) -> Result<&'a str> {
    values
        .get(role)
        .or_else(|| effective.get("occurrences").and_then(|v| v.get(key)))
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("invalid_occurrence_policy"))
}

fn horizon(raw: &str) -> Result<u64> {
    let duration =
        reminder_schedule::offset(raw).map_err(|_| invalid("invalid_occurrence_horizon"))?;
    if duration < chrono::Duration::zero() {
        return Err(invalid("negative_occurrence_horizon"));
    }
    // Civil windows include a partial final day. Use the same documented fixed
    // 365/30-day year/month duration arithmetic as reminder offsets.
    let seconds = duration.num_seconds();
    let days = seconds.div_euclid(86_400)
        + i64::from(seconds.rem_euclid(86_400) != 0 || duration.subsec_nanos() != 0);
    u64::try_from(days).map_err(|_| invalid("invalid_occurrence_horizon"))
}

pub(crate) fn bounds(
    config: &TaskNotesConfiguration,
    values: &Map<String, Value>,
    reference: NaiveDate,
) -> Result<DateWindow> {
    bounds_effective(&config.effective, values, reference)
}

/// Read-only discovery shares this exact policy/window resolver with writes.
pub(crate) fn eligible_bounds(
    effective: &Value,
    values: &Map<String, Value>,
    reference: NaiveDate,
) -> Result<Option<DateWindow>> {
    if occurrences::identity(values)?.is_some() {
        return Ok(None);
    }
    if !tasknotes_vault::occurrence_policy::invalid_roles(values).is_empty() {
        return Err(invalid("invalid_occurrence_policy"));
    }
    match setting(
        effective,
        values,
        "occurrenceMaterialization",
        "default_materialization",
    )? {
        "rolling" => {}
        "manual" | "on_completion" => return Ok(None),
        _ => return Err(invalid("invalid_occurrence_policy")),
    }
    if values
        .get("recurrence")
        .is_none_or(|value| value.is_null() || value.as_str() == Some(""))
    {
        return Ok(None);
    }
    super::validate_recurrence_properties(values)?;
    let recurrence = Recurrence::parse(
        values
            .get("recurrence")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        values.get("scheduled").and_then(Value::as_str),
        values.get("dateCreated").and_then(Value::as_str),
    );
    if !recurrence.is_expandable() {
        return Err(invalid("materialization_requires_valid_seeded_parent"));
    }
    bounds_effective(effective, values, reference).map(Some)
}

fn bounds_effective(
    effective: &Value,
    values: &Map<String, Value>,
    reference: NaiveDate,
) -> Result<DateWindow> {
    if setting(
        effective,
        values,
        "occurrenceMaterialization",
        "default_materialization",
    )? != "rolling"
    {
        return Err(invalid("rolling_materialization_requires_rolling_policy"));
    }
    let past = horizon(setting(
        effective,
        values,
        "occurrencePastHorizon",
        "past_horizon",
    )?)?;
    let future = horizon(setting(
        effective,
        values,
        "occurrenceFutureHorizon",
        "future_horizon",
    )?)?;
    let start = reference
        .checked_sub_days(Days::new(past))
        .ok_or_else(|| invalid("occurrence_window_overflow"))?;
    let end = reference
        .checked_add_days(Days::new(future))
        .ok_or_else(|| invalid("occurrence_window_overflow"))?;
    if start.year() < 1 || end.year() > 9999 {
        return Err(invalid("occurrence_window_overflow"));
    }
    if end.signed_duration_since(start).num_days() > MAX_WINDOW_DAYS {
        return Err(invalid("occurrence_window_resource_limit"));
    }
    DateWindow::new(start, end).map_err(|_| invalid("invalid_occurrence_window"))
}

pub(crate) fn plan(
    files: &dyn VaultFiles,
    profile: &str,
    config: &TaskNotesConfiguration,
    mutation: &Mutation,
) -> Result<Plan> {
    let Command::MaterializeOccurrenceWindow {
        parent_path,
        expected_parent_revision,
        reference_date,
        ..
    } = &mutation.command
    else {
        return Err(RuntimeError::Storage(
            "rolling command dispatch mismatch".into(),
        ));
    };
    let parent = occurrences::parent_document(
        files,
        profile,
        config,
        parent_path,
        expected_parent_revision,
    )?;
    let values = config.mapping.normalize(parent.frontmatter());
    let window = bounds(config, &values, temporal::parse_day(reference_date)?)?;
    let recurrence = Recurrence::parse(
        values
            .get("recurrence")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        values.get("scheduled").and_then(Value::as_str),
        values.get("dateCreated").and_then(Value::as_str),
    );
    let dates = recurrence
        .bounded_occurrences(window, crate::RECURRENCE_WORK_LIMIT)
        .map_err(|_| invalid("occurrence_expansion_resource_limit"))?;
    let target_dates = dates
        .iter()
        .map(ToString::to_string)
        .collect::<std::collections::BTreeSet<_>>();
    let mut existing = std::collections::BTreeMap::new();
    for (parent, child) in occurrences::collection_children(files, profile, config)? {
        if parent == *parent_path
            && target_dates.contains(&child.date)
            && existing.insert(child.date.clone(), child).is_some()
        {
            return Err(invalid("duplicate_occurrence_note"));
        }
    }
    if dates.len().saturating_sub(existing.len()) > MAX_NEW_CHILDREN {
        return Err(invalid(
            "occurrence_window_requires_more_than_1000_new_children",
        ));
    }
    let mut reads = ReadPlan {
        parent_path: parent_path.clone(),
        parent_revision: expected_parent_revision.clone(),
        reference_date: reference_date.clone(),
        start: window.start().to_string(),
        end: window.end().to_string(),
        parent_field: config.mapping.field("recurrenceParent").into(),
        date_field: config.mapping.field("occurrenceDate").into(),
        entries: Vec::new(),
    };
    let mut children: Vec<occurrences::Plan> = Vec::new();
    let mut writes = Vec::new();
    for date in dates {
        let mut child_mutation = mutation.clone();
        child_mutation.command = Command::MaterializeOccurrence {
            parent_path: parent_path.clone(),
            expected_parent_revision: expected_parent_revision.clone(),
            occurrence_date: date.to_string(),
            expected_occurrence_revision: None,
            properties: Map::new(),
            body: None,
        };
        let view = PlannedView {
            files,
            profile,
            writes: &writes,
        };
        let child = occurrences::plan_selected(
            &view,
            profile,
            config,
            &child_mutation,
            occurrences::Selection::Known(existing.remove(&date.to_string())),
        )?;
        writes.extend(child.writes.clone());
        reads.entries.push(Entry {
            date: date.to_string(),
            reads: child.reads.clone(),
        });
        children.push(child);
    }
    Ok(Plan { reads, children })
}
