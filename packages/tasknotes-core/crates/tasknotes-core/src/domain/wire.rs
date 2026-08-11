//! The `/v2` wire boundary.
//!
//! The upstream TaskNotes plugin's HTTP contract, parsed and transformed into
//! the app's internal domain shapes. Only this module knows the wire spelling;
//! everything inland speaks the camelCase domain vocabulary with validated ids
//! and defaulted collections — which is also why changing the wire spelling
//! needs no cache or queue migration.
//!
//! **The wire is not a case convention.** It is camelCase *except* for a
//! four-entry rename table, which is small enough to be data:
//!
//! | domain | wire |
//! |---|---|
//! | `recurrenceAnchor` | `recurrence_anchor` |
//! | `completeInstances` | `complete_instances` |
//! | `skippedInstances` | `skipped_instances` |
//! | `extraFields` | `customProperties` |
//!
//! Inbound, the table is expressed as `#[serde(rename = …)]` on [`WireTask`];
//! outbound it is [`WIRE_FIELD_RENAMES`], applied by [`to_wire_task_fields`].
//! A test asserts the two agree, so the table cannot rot in one direction only.
//!
//! **Unknown fields are accepted and discarded.** The Zod schemas here are
//! `z.looseObject`, which admits unknown keys — but every one of them is
//! followed by a `.transform` that builds an explicit object, so an unknown
//! top-level key never reaches the domain type. Serde's default behaviour is
//! exactly that, so there is deliberately no `#[serde(flatten)]` catch-all
//! here: adding one would *change* behaviour by preserving keys the reference
//! implementation drops. The only bag that is genuinely preserved is
//! `customProperties`, which is an explicit field.
//!
//! Statuses and priorities stay **closed** enums on purpose; see
//! [`super::status::TaskStatus`].

use indexmap::IndexMap;
use serde_json::{Map, Value};

use super::{
    ids::{ContextName, ProjectName, TagName, TaskId},
    priority::Priority,
    query::FilterOptions,
    report::{
        ApiResponse, CalendarEvent, NlpParseResult, Pagination, QueryResponse, TaskList, TaskTime,
        TimeSummary, TopTask, VaultInfo,
    },
    request::{CreateTaskRequest, UpdateTaskRequest},
    serde_ext::present_only,
    status::TaskStatus,
    task::{
        BlockedByEntry, ExtraFields, InlineTimeEntry, RecurrenceAnchor, Reminder, ReminderKind,
    },
};
use crate::{Error, Result};

/// The complete domain-to-wire field rename table.
///
/// Four entries, and the only four. Everything else is spelled identically on
/// both sides, which is why this is a lookup rather than a case transform —
/// blanket-snake-casing an outbound payload would rename ten fields the server
/// does not recognise.
pub const WIRE_FIELD_RENAMES: [(&str, &str); 4] = [
    ("recurrenceAnchor", "recurrence_anchor"),
    ("completeInstances", "complete_instances"),
    ("skippedInstances", "skipped_instances"),
    ("extraFields", "customProperties"),
];

/// Rename the domain field names in an outbound task payload to their wire
/// spellings.
///
/// The TypeScript original also drops `undefined` values. That step has no
/// analogue here and needs none: JSON has no `undefined`, and the payload is
/// produced by serializing a request whose absent fields are already omitted by
/// `skip_serializing_if`. An explicit `null` — which is how
/// [`super::serde_ext::FieldUpdate::Clear`] renders — passes straight through,
/// because `null` is the server's instruction to delete a frontmatter key and
/// dropping it would silently turn "clear the due date" into a no-op.
#[must_use]
pub fn to_wire_task_fields(fields: Map<String, Value>) -> Map<String, Value> {
    fields
        .into_iter()
        .map(|(key, value)| {
            let renamed = WIRE_FIELD_RENAMES
                .into_iter()
                .find_map(|(domain, wire)| (domain == key).then_some(wire));
            match renamed {
                Some(wire) => (wire.to_owned(), value),
                None => (key, value),
            }
        })
        .collect()
}

/// Render a create payload as the wire body to POST.
///
/// # Errors
///
/// Returns [`Error::Invariant`] if the request cannot be serialized, which for
/// an already-validated request means a broken invariant rather than bad input.
pub fn create_task_body(request: &CreateTaskRequest) -> Result<Map<String, Value>> {
    to_body(request)
}

/// Render an update payload as the wire body to PUT.
///
/// # Errors
///
/// Returns [`Error::Invariant`] if the request cannot be serialized.
pub fn update_task_body(request: &UpdateTaskRequest) -> Result<Map<String, Value>> {
    to_body(request)
}

/// Serialize a request and apply the rename table.
fn to_body<T: serde::Serialize>(request: &T) -> Result<Map<String, Value>> {
    match serde_json::to_value(request) {
        Ok(Value::Object(fields)) => Ok(to_wire_task_fields(fields)),
        Ok(other) => Err(Error::invariant(format!(
            "a task payload must serialize to a JSON object, got {other}"
        ))),
        Err(error) => Err(Error::invariant(format!(
            "could not serialize a task payload: {error}"
        ))),
    }
}

/// A task exactly as the `/v2` endpoints spell it.
///
/// Parse this, then convert with [`TryFrom`]; do not hand it to the rest of the
/// app. Field order follows the upstream schema.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireTask {
    /// Upstream's own identifier. Optional, and equal to `path` when present.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub id: Option<String>,
    /// The vault-relative markdown path, which is the real identity.
    pub path: String,
    /// The task's title.
    pub title: String,
    /// Where the task is in the workflow.
    pub status: TaskStatus,
    /// How urgent the task is.
    pub priority: Priority,
    /// When the task is due.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub due: Option<String>,
    /// When the task is planned to be worked on.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub scheduled: Option<String>,
    /// The contexts the task is available in.
    #[serde(default)]
    pub contexts: Vec<String>,
    /// The projects the task belongs to.
    #[serde(default)]
    pub projects: Vec<String>,
    /// The task's tags.
    #[serde(default)]
    pub tags: Vec<String>,
    /// The RFC 5545 recurrence rule.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub recurrence: Option<String>,
    /// What the recurrence is measured from. Rename table entry 1 of 4.
    #[serde(
        rename = "recurrence_anchor",
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub recurrence_anchor: Option<RecurrenceAnchor>,
    /// Completed occurrence dates. Rename table entry 2 of 4.
    #[serde(rename = "complete_instances", default)]
    pub complete_instances: Vec<String>,
    /// Skipped occurrence dates. Rename table entry 3 of 4.
    #[serde(rename = "skipped_instances", default)]
    pub skipped_instances: Vec<String>,
    /// When the task was completed.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub completed_date: Option<String>,
    /// When the note was created.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub date_created: Option<String>,
    /// When the note was last modified.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub date_modified: Option<String>,
    /// The estimate in whole minutes.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub time_estimate: Option<u32>,
    /// Tracked work intervals.
    #[serde(default)]
    pub time_entries: Vec<WireTimeEntry>,
    /// Dependency edges.
    #[serde(default)]
    pub blocked_by: Vec<WireDependency>,
    /// Reminders.
    #[serde(default)]
    pub reminders: Vec<WireReminder>,
    /// Whether the task is archived.
    #[serde(default)]
    pub archived: bool,
    /// Total tracked minutes, as the server computed them.
    #[serde(default)]
    pub total_tracked_time: u32,
    /// Whether something else blocks this task.
    #[serde(default)]
    pub is_blocked: bool,
    /// Whether this task blocks something else.
    #[serde(default)]
    pub is_blocking: bool,
    /// Unmodelled frontmatter keys. Rename table entry 4 of 4.
    #[serde(rename = "customProperties", default)]
    pub custom_properties: IndexMap<String, Value>,
    /// The note body.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub details: Option<String>,
}

/// A tracked work interval as the wire spells it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireTimeEntry {
    /// When tracking started.
    pub start_time: String,
    /// When tracking stopped.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub end_time: Option<String>,
    /// The interval's length in whole minutes.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub duration: Option<u32>,
}

/// A dependency edge as the wire spells it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WireDependency {
    /// The blocking task's identifier.
    pub uid: String,
    /// The iCalendar relationship type.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub reltype: Option<String>,
    /// The required gap.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub gap: Option<String>,
}

/// A reminder as the wire spells it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireReminder {
    /// The reminder's server-side identifier.
    ///
    /// Declared so a malformed value still fails validation, then **dropped**:
    /// the domain [`Reminder`] has no id, matching the reference transform.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub id: Option<String>,
    /// Whether the reminder is relative or absolute.
    #[serde(rename = "type")]
    pub kind: ReminderKind,
    /// An ISO 8601 duration, for a relative reminder.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub offset: Option<String>,
    /// Which date the offset is measured from.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub related_to: Option<String>,
    /// A fixed instant, for an absolute reminder.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub absolute_time: Option<String>,
}

impl TryFrom<WireTask> for super::task::Task {
    type Error = Error;

    /// # Errors
    ///
    /// Returns [`Error::Invariant`] when the task's identity or any of its
    /// names fails to parse.
    fn try_from(raw: WireTask) -> Result<Self> {
        // Path-as-ID. `id`, when present, equals the path anyway; it is only a
        // fallback for the one endpoint that omits `path`. An empty result
        // fails here rather than propagating an unusable identity, which is
        // where the TypeScript brand — a compile-time-only tag — gives up.
        let identity = if raw.path.is_empty() {
            raw.id.clone().unwrap_or_default()
        } else {
            raw.path.clone()
        };

        Ok(Self {
            id: TaskId::parse(identity)?,
            path: raw.path,
            title: raw.title,
            status: raw.status,
            priority: raw.priority,
            due: raw.due,
            scheduled: raw.scheduled,
            contexts: raw
                .contexts
                .into_iter()
                .map(ContextName::parse)
                .collect::<Result<Vec<_>>>()?,
            projects: raw
                .projects
                .into_iter()
                .map(ProjectName::parse)
                .collect::<Result<Vec<_>>>()?,
            tags: raw
                .tags
                .into_iter()
                .map(TagName::parse)
                .collect::<Result<Vec<_>>>()?,
            recurrence: raw.recurrence,
            recurrence_anchor: raw.recurrence_anchor,
            complete_instances: raw.complete_instances,
            skipped_instances: raw.skipped_instances,
            completed_date: raw.completed_date,
            date_created: raw.date_created,
            date_modified: raw.date_modified,
            time_estimate: raw.time_estimate,
            time_entries: raw
                .time_entries
                .into_iter()
                .map(|entry| InlineTimeEntry {
                    start_time: entry.start_time,
                    end_time: entry.end_time,
                    duration: entry.duration,
                })
                .collect(),
            blocked_by: raw
                .blocked_by
                .into_iter()
                .map(|edge| BlockedByEntry {
                    uid: edge.uid,
                    reltype: edge.reltype,
                    gap: edge.gap,
                })
                .collect(),
            reminders: raw
                .reminders
                .into_iter()
                .map(|reminder| Reminder {
                    kind: reminder.kind,
                    offset: reminder.offset,
                    related_to: reminder.related_to,
                    absolute_time: reminder.absolute_time,
                })
                .collect(),
            archived: raw.archived,
            total_tracked_time: raw.total_tracked_time,
            is_blocked: raw.is_blocked,
            is_blocking: raw.is_blocking,
            extra_fields: ExtraFields::new(raw.custom_properties),
            details: raw.details,
        })
    }
}

/// The wire form of a paginated task list.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct WireTaskList {
    /// This page's tasks.
    pub tasks: Vec<WireTask>,
    /// Where this page sits.
    pub pagination: Pagination,
    /// Which vault answered.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub vault: Option<VaultInfo>,
    /// A human-readable remark from the server.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub note: Option<String>,
}

impl TryFrom<WireTaskList> for TaskList {
    type Error = Error;

    /// # Errors
    ///
    /// Propagates the first task that fails to convert.
    fn try_from(raw: WireTaskList) -> Result<Self> {
        Ok(Self {
            tasks: convert_tasks(raw.tasks)?,
            pagination: raw.pagination,
            vault: raw.vault,
            note: raw.note,
        })
    }
}

/// The wire form of a filtered query's answer.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct WireQueryResponse {
    /// The matching tasks.
    pub tasks: Vec<WireTask>,
    /// How many tasks exist before filtering.
    pub total: u32,
    /// How many survived the filter.
    pub filtered: u32,
    /// Which vault answered.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub vault: Option<VaultInfo>,
}

impl TryFrom<WireQueryResponse> for QueryResponse {
    type Error = Error;

    /// # Errors
    ///
    /// Propagates the first task that fails to convert.
    fn try_from(raw: WireQueryResponse) -> Result<Self> {
        Ok(Self {
            tasks: convert_tasks(raw.tasks)?,
            total: raw.total,
            filtered: raw.filtered,
            vault: raw.vault,
        })
    }
}

/// `DELETE /api/tasks/:id` → `{ message }`.
///
/// Upstream returns a message, **not** a `{ success }` flag. The dead schema
/// deleted in phase 0 claimed otherwise; this is the live contract.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WireDeleteResponse {
    /// What the server did.
    pub message: String,
}

/// A configured value on the wire, which is an object rather than a string.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WireConfiguredValue {
    /// The value the vault stores.
    pub value: String,
}

/// The wire form of the filter pickers' vocabulary.
///
/// `statuses` and `priorities` arrive as config *objects* and are flattened to
/// their `value` strings. Note that this flattening is unrelated to the closed
/// [`TaskStatus`] enum: these are the vault's configured values, which may
/// include ones this client does not model, and they stay opaque strings on the
/// domain side for exactly that reason.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WireFilterOptions {
    /// Configured status objects.
    pub statuses: Vec<WireConfiguredValue>,
    /// Configured priority objects.
    pub priorities: Vec<WireConfiguredValue>,
    /// Every context in use.
    pub contexts: Vec<String>,
    /// Every project in use.
    pub projects: Vec<String>,
    /// Every tag in use.
    pub tags: Vec<String>,
}

impl From<WireFilterOptions> for FilterOptions {
    fn from(raw: WireFilterOptions) -> Self {
        Self {
            statuses: raw
                .statuses
                .into_iter()
                .map(|status| status.value)
                .collect(),
            priorities: raw
                .priorities
                .into_iter()
                .map(|priority| priority.value)
                .collect(),
            contexts: raw.contexts,
            projects: raw.projects,
            tags: raw.tags,
        }
    }
}

/// The nested totals block the time endpoints wrap their numbers in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireTimeTotals {
    /// Whole minutes tracked.
    pub total_minutes: u32,
}

/// One leaderboard row on the wire.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WireTopTask {
    /// The task's vault path. Spelled `task`, not `taskId`.
    pub task: String,
    /// The task's title at report time.
    pub title: String,
    /// Whole minutes tracked in the period.
    pub minutes: u32,
}

/// `GET /api/time/summary` on the wire.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireTimeSummary {
    /// Which period the report covers.
    pub period: String,
    /// The period's totals.
    pub summary: WireTimeTotals,
    /// The most-tracked tasks.
    pub top_tasks: Vec<WireTopTask>,
}

impl TryFrom<WireTimeSummary> for TimeSummary {
    type Error = Error;

    /// # Errors
    ///
    /// Propagates the first leaderboard row whose task path fails to parse.
    fn try_from(raw: WireTimeSummary) -> Result<Self> {
        Ok(Self {
            total_time: raw.summary.total_minutes,
            top_tasks: raw
                .top_tasks
                .into_iter()
                .map(|row| {
                    Ok(TopTask {
                        task_id: TaskId::parse(row.task)?,
                        title: row.title,
                        minutes: row.minutes,
                    })
                })
                .collect::<Result<Vec<_>>>()?,
        })
    }
}

/// The nested totals block for a single task's tracked time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireTaskTimeTotals {
    /// Whole minutes tracked against the task, ever.
    pub total_minutes: u32,
    /// How many sessions are running right now.
    pub active_sessions: u32,
}

/// `GET /api/tasks/:id/time` on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WireTaskTime {
    /// The task's totals.
    pub summary: WireTaskTimeTotals,
}

impl From<WireTaskTime> for TaskTime {
    fn from(raw: WireTaskTime) -> Self {
        Self {
            total_time: raw.summary.total_minutes,
            has_active_session: raw.summary.active_sessions > 0,
        }
    }
}

/// `POST /api/nlp/parse` → `{ parsed, taskData }`; the app wants `parsed`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WireNlpParse {
    /// What the parser extracted.
    pub parsed: NlpParseResult,
}

/// `POST /api/nlp/create` → `{ task, parsed }`; the app wants the task.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct WireNlpCreate {
    /// The task the server created.
    pub task: WireTask,
}

/// One calendar entry on the wire.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireCalendarEvent {
    /// The event's own identifier.
    pub id: String,
    /// The event title.
    pub title: String,
    /// The full start timestamp, of which only the date survives.
    pub start: String,
    /// The task the event came from.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub task_path: Option<String>,
}

/// `GET /api/calendars/events` — plural, upstream.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WireCalendarEvents {
    /// The events in the requested window.
    pub events: Vec<WireCalendarEvent>,
}

impl TryFrom<WireCalendarEvents> for Vec<CalendarEvent> {
    type Error = Error;

    /// # Errors
    ///
    /// Propagates the first event whose `taskPath` fails to parse.
    fn try_from(raw: WireCalendarEvents) -> Result<Self> {
        raw.events
            .into_iter()
            .map(|event| {
                Ok(CalendarEvent {
                    id: event.id,
                    title: event.title,
                    // The day, taken as the leading `YYYY-MM-DD` — the same
                    // `start.slice(0, 10)` the reference implementation does.
                    date: leading_date(&event.start),
                    task_id: event.task_path.map(TaskId::parse).transpose()?,
                })
            })
            .collect()
    }
}

/// The first ten characters of a timestamp, its `YYYY-MM-DD` day.
///
/// Character-based rather than byte-based so a non-ASCII value cannot split a
/// code point; a malformed value simply yields a short string, exactly as
/// `String.prototype.slice` would.
fn leading_date(start: &str) -> String {
    start.chars().take(10).collect()
}

/// Convert a page of wire tasks, failing on the first bad one.
fn convert_tasks(tasks: Vec<WireTask>) -> Result<Vec<super::task::Task>> {
    tasks.into_iter().map(TryInto::try_into).collect()
}

/// Unwrap the `{ success, data, error }` envelope some endpoints use.
///
/// Returns the inner payload when the envelope says success, an
/// [`Error::Api`] carrying the envelope's message when it says failure, and
/// the body untouched when it is not an envelope at all — which is the
/// reference client's behaviour, since most endpoints answer with a bare
/// payload.
///
/// # Errors
///
/// Returns [`Error::Api`] with status `0` when the envelope reports
/// `success: false`. Status `0` is deliberate and matches the reference
/// implementation: an envelope failure carries no HTTP status of its own, and
/// inventing one would make the sync layer's classifier retry or dead-letter on
/// a fiction.
pub fn unwrap_envelope(body: Value) -> Result<Value> {
    let Ok(envelope) = serde_json::from_value::<ApiResponse>(body.clone()) else {
        return Ok(body);
    };
    if envelope.success {
        Ok(envelope.data)
    } else {
        Err(Error::api(
            envelope
                .error
                .unwrap_or_else(|| "API returned success=false".to_owned()),
            0,
        ))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::{
        WIRE_FIELD_RENAMES, WireCalendarEvents, WireFilterOptions, WireTask, WireTaskTime,
        WireTimeSummary, create_task_body, to_wire_task_fields, unwrap_envelope, update_task_body,
    };
    use crate::domain::{
        ids::TaskId,
        priority::Priority,
        query::FilterOptions,
        report::{CalendarEvent, TaskTime, TimeSummary},
        request::{CreateTaskRequest, TaskTitle, UpdateTaskRequest},
        serde_ext::FieldUpdate,
        status::TaskStatus,
        task::{RecurrenceAnchor, Task},
    };

    fn wire_task_json() -> Value {
        json!({
            "path": "Tasks/a.md",
            "title": "Write the plan",
            "status": "in-progress",
            "priority": "high",
            "recurrence_anchor": "completion",
            "complete_instances": ["2026-08-01"],
            "skipped_instances": ["2026-08-02"],
            "customProperties": { "zebra": 1, "apple": 2 },
            "reminders": [{ "id": "r1", "type": "relative", "offset": "-PT15M" }],
            "contexts": ["home"],
            "projects": ["[[Areas/Work|Work]]"],
            "tags": ["urgent"],
        })
    }

    #[test]
    fn applies_the_rename_table_inbound() {
        let wire: WireTask = serde_json::from_value(wire_task_json()).unwrap();
        let task = Task::try_from(wire).unwrap();

        assert_eq!(task.recurrence_anchor, Some(RecurrenceAnchor::Completion));
        assert_eq!(task.complete_instances, ["2026-08-01"]);
        assert_eq!(task.skipped_instances, ["2026-08-02"]);
        assert_eq!(task.extra_fields.len(), 2);
        assert_eq!(task.status, TaskStatus::InProgress);
        assert_eq!(task.priority, Priority::High);
    }

    #[test]
    fn the_task_id_is_the_vault_path() {
        let wire: WireTask = serde_json::from_value(wire_task_json()).unwrap();
        let task = Task::try_from(wire).unwrap();
        assert_eq!(task.id, TaskId::parse("Tasks/a.md").unwrap());
        assert_eq!(task.path, "Tasks/a.md");
    }

    #[test]
    fn an_empty_path_falls_back_to_the_id_field() {
        let mut raw = wire_task_json();
        raw["path"] = json!("");
        raw["id"] = json!("Tasks/from-id.md");
        let wire: WireTask = serde_json::from_value(raw).unwrap();
        let task = Task::try_from(wire).unwrap();
        assert_eq!(task.id, TaskId::parse("Tasks/from-id.md").unwrap());
        assert_eq!(task.path, "");
    }

    #[test]
    fn a_task_with_neither_path_nor_id_fails_loudly() {
        let mut raw = wire_task_json();
        raw["path"] = json!("");
        let wire: WireTask = serde_json::from_value(raw).unwrap();
        let error = Task::try_from(wire).unwrap_err();
        assert!(
            error.to_string().contains("must not be empty"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn an_unknown_status_fails_validation_loudly() {
        let mut raw = wire_task_json();
        raw["status"] = json!("someday");
        let error = serde_json::from_value::<WireTask>(raw).unwrap_err();
        assert!(
            error.to_string().contains("someday"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn unknown_wire_fields_are_accepted_and_discarded() {
        let mut raw = wire_task_json();
        raw["someFutureField"] = json!("ignored");
        let wire: WireTask = serde_json::from_value(raw).unwrap();
        let task = Task::try_from(wire).unwrap();
        // Discarded, not folded into the preserved bag: only `customProperties`
        // survives, and it still holds exactly its own two keys.
        assert_eq!(task.extra_fields.len(), 2);
        assert!(task.extra_fields.get("someFutureField").is_none());
    }

    #[test]
    fn preserved_fields_keep_their_wire_order() {
        let wire: WireTask = serde_json::from_value(wire_task_json()).unwrap();
        let task = Task::try_from(wire).unwrap();
        let keys: Vec<&str> = task
            .extra_fields
            .as_map()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(keys, ["zebra", "apple"]);
    }

    #[test]
    fn a_reminder_loses_its_wire_id() {
        let wire: WireTask = serde_json::from_value(wire_task_json()).unwrap();
        assert_eq!(wire.reminders[0].id.as_deref(), Some("r1"));
        let task = Task::try_from(wire).unwrap();
        let rendered = serde_json::to_value(&task.reminders[0]).unwrap();
        assert!(
            rendered.as_object().unwrap().get("id").is_none(),
            "reminder kept its wire id: {rendered}"
        );
    }

    #[test]
    fn applies_the_rename_table_outbound() {
        let mut fields = serde_json::Map::new();
        for (domain, _) in WIRE_FIELD_RENAMES {
            fields.insert(domain.to_owned(), json!("v"));
        }
        fields.insert("title".to_owned(), json!("unchanged"));

        let wire = to_wire_task_fields(fields);
        for (domain, wire_name) in WIRE_FIELD_RENAMES {
            assert!(!wire.contains_key(domain), "{domain} survived the rename");
            assert!(wire.contains_key(wire_name), "{wire_name} was not produced");
        }
        assert_eq!(wire.get("title"), Some(&json!("unchanged")));
    }

    #[test]
    fn the_inbound_and_outbound_rename_tables_agree() {
        // Serializing `WireTask` exercises the inbound `#[serde(rename)]`
        // attributes; if either side of the table is edited alone, the key sets
        // stop matching and this fails.
        let wire: WireTask = serde_json::from_value(wire_task_json()).unwrap();
        let rendered = serde_json::to_value(&wire).unwrap();
        let rendered = rendered.as_object().unwrap();
        for (domain, wire_name) in WIRE_FIELD_RENAMES {
            assert!(
                !rendered.contains_key(domain),
                "WireTask serialized the domain spelling {domain}"
            );
            assert!(
                rendered.contains_key(wire_name)
                    // `extraFields` is the one entry whose wire counterpart is
                    // also the field's own name, so it is always present.
                    || wire_name == "customProperties",
                "WireTask did not serialize {wire_name}"
            );
        }
    }

    #[test]
    fn a_create_body_omits_absent_fields_entirely() {
        let request = CreateTaskRequest::new(TaskTitle::parse("Write").unwrap());
        let body = create_task_body(&request).unwrap();
        assert_eq!(body.len(), 1);
        assert_eq!(body.get("title"), Some(&json!("Write")));
    }

    #[test]
    fn an_update_body_keeps_null_and_drops_absent() {
        let request = UpdateTaskRequest {
            due: FieldUpdate::Clear,
            recurrence_anchor: FieldUpdate::Set(RecurrenceAnchor::Scheduled),
            ..UpdateTaskRequest::default()
        };
        let body = update_task_body(&request).unwrap();

        assert_eq!(body.get("due"), Some(&Value::Null));
        assert_eq!(body.get("recurrence_anchor"), Some(&json!("scheduled")));
        assert!(!body.contains_key("recurrenceAnchor"));
        assert!(!body.contains_key("scheduled"));
        assert!(!body.contains_key("title"));
    }

    #[test]
    fn filter_options_flatten_config_objects_to_plain_strings() {
        let wire: WireFilterOptions = serde_json::from_value(json!({
            "statuses": [{ "value": "open" }, { "value": "custom-vault-status" }],
            "priorities": [{ "value": "normal" }],
            "contexts": ["home"],
            "projects": ["Work"],
            "tags": ["urgent"],
        }))
        .unwrap();

        let options = FilterOptions::from(wire);
        // A vault status this client's closed enum does not know still reaches
        // the picker: these are opaque strings, not `TaskStatus`.
        assert_eq!(options.statuses, ["open", "custom-vault-status"]);
        assert_eq!(options.priorities, ["normal"]);
    }

    #[test]
    fn the_time_summary_is_reshaped_out_of_its_nested_block() {
        let wire: WireTimeSummary = serde_json::from_value(json!({
            "period": "week",
            "summary": { "totalMinutes": 120 },
            "topTasks": [{ "task": "Tasks/a.md", "title": "A", "minutes": 90 }],
        }))
        .unwrap();

        let summary = TimeSummary::try_from(wire).unwrap();
        assert_eq!(summary.total_time, 120);
        assert_eq!(summary.top_tasks[0].task_id.as_str(), "Tasks/a.md");
        assert_eq!(summary.top_tasks[0].minutes, 90);
    }

    #[test]
    fn an_active_session_is_derived_from_the_session_count() {
        let running: WireTaskTime = serde_json::from_value(
            json!({ "summary": { "totalMinutes": 5, "activeSessions": 1 } }),
        )
        .unwrap();
        assert_eq!(
            TaskTime::from(running),
            TaskTime {
                total_time: 5,
                has_active_session: true
            }
        );

        let idle: WireTaskTime = serde_json::from_value(
            json!({ "summary": { "totalMinutes": 5, "activeSessions": 0 } }),
        )
        .unwrap();
        assert!(!TaskTime::from(idle).has_active_session);
    }

    #[test]
    fn a_calendar_event_keeps_only_the_day_of_its_start() {
        let wire: WireCalendarEvents = serde_json::from_value(json!({
            "events": [{
                "id": "e1",
                "title": "Standup",
                "start": "2026-08-08T09:30:00Z",
                "taskPath": "Tasks/a.md",
            }, {
                "id": "e2",
                "title": "Untied",
                "start": "2026-08-09",
            }],
        }))
        .unwrap();

        let events = Vec::<CalendarEvent>::try_from(wire).unwrap();
        assert_eq!(events[0].date, "2026-08-08");
        assert_eq!(
            events[0].task_id,
            Some(TaskId::parse("Tasks/a.md").unwrap())
        );
        assert_eq!(events[1].date, "2026-08-09");
        assert_eq!(events[1].task_id, None);
    }

    #[test]
    fn the_envelope_is_unwrapped_only_when_it_is_present() {
        let wrapped = json!({ "success": true, "data": { "answer": 42 } });
        assert_eq!(unwrap_envelope(wrapped).unwrap(), json!({ "answer": 42 }));

        let bare = json!({ "answer": 42 });
        assert_eq!(unwrap_envelope(bare.clone()).unwrap(), bare);
    }

    #[test]
    fn an_unsuccessful_envelope_becomes_a_status_zero_api_error() {
        let failed = json!({ "success": false, "data": null, "error": "nope" });
        let error = unwrap_envelope(failed).unwrap_err();
        assert_eq!(error.status(), Some(0));
        assert_eq!(error.message(), "nope");
    }
}
