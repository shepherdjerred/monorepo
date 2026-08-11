//! The task itself, and the small records hanging off it.
//!
//! Field order in every struct here is a **wire format**: UniFFI writes
//! `Record` fields positionally into the FFI buffer, so reordering one is an
//! ABI break that no Rust tool catches and only the committed bindings diff
//! detects. The order follows the TypeScript `TaskSchema` declaration order so
//! there is one canonical answer rather than two.

use indexmap::IndexMap;
use serde_json::Value;

use super::{
    ids::{ContextName, ProjectName, TagName, TaskId},
    priority::Priority,
    serde_ext::present_only,
    status::TaskStatus,
};
use crate::{Error, Result};

/// What a recurrence's next occurrence is measured from.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "lowercase")]
pub enum RecurrenceAnchor {
    /// Measured from the scheduled date, so the series keeps its cadence even
    /// when an occurrence is completed late.
    Scheduled,
    /// Measured from the completion date, so the series drifts with the user.
    Completion,
}

/// Which clock a reminder is pinned to.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "lowercase")]
pub enum ReminderKind {
    /// An offset from another of the task's dates.
    Relative,
    /// A fixed instant.
    Absolute,
}

/// A reminder attached to a task.
///
/// The wire carries an `id` on reminders; the TypeScript transform drops it and
/// this port does the same, so a reminder is identified by its content.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    /// Whether [`Reminder::offset`] or [`Reminder::absolute_time`] applies.
    #[serde(rename = "type")]
    pub kind: ReminderKind,
    /// An ISO 8601 duration, for a relative reminder.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub offset: Option<String>,
    /// Which of the task's dates the offset is measured from.
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

/// A dependency edge: this task is blocked by the referenced one.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedByEntry {
    /// The blocking task's identifier, as upstream spells it.
    ///
    /// Deliberately a plain `String` rather than a [`TaskId`]: upstream uses an
    /// iCalendar-style UID here, which is not always a vault path, and a task
    /// may legitimately reference a blocker the client has not loaded.
    pub uid: String,
    /// The iCalendar relationship type.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub reltype: Option<String>,
    /// The required gap between the blocker and this task.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub gap: Option<String>,
}

/// A tracked work interval stored inline on the task.
///
/// Distinct from [`super::report::TimeEntry`], which names its task because it
/// comes back from the time-reporting endpoints rather than from frontmatter.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineTimeEntry {
    /// When tracking started.
    pub start_time: String,
    /// When tracking stopped; absent while a session is running.
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

/// Frontmatter keys the client does not model, preserved verbatim.
///
/// Backed by an [`IndexMap`] rather than a `HashMap` so iteration follows
/// insertion order: these keys are written straight back into the vault's
/// YAML frontmatter, and a shuffled order would produce a spurious diff in the
/// user's git history on every save. It is also what makes the cross-platform
/// determinism hash meaningful.
///
/// **FFI note.** UniFFI has no `Any` type, so this crosses the boundary as a
/// JSON `String` via `uniffi::custom_type!`; [`ExtraFields::to_json`] and
/// [`ExtraFields::from_json`] are that conversion, kept here so both directions
/// live next to the invariant they preserve.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct ExtraFields(IndexMap<String, Value>);

impl ExtraFields {
    /// Wrap an ordered map of preserved keys.
    #[must_use]
    pub fn new(fields: IndexMap<String, Value>) -> Self {
        Self(fields)
    }

    /// Borrow the preserved keys in vault order.
    #[must_use]
    pub fn as_map(&self) -> &IndexMap<String, Value> {
        &self.0
    }

    /// Consume the wrapper, yielding the preserved keys in vault order.
    #[must_use]
    pub fn into_map(self) -> IndexMap<String, Value> {
        self.0
    }

    /// Look up one preserved key.
    #[must_use]
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.0.get(key)
    }

    /// Whether any keys were preserved.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// How many keys were preserved.
    #[must_use]
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Render as a JSON object string, for the FFI boundary.
    ///
    /// # Errors
    ///
    /// Returns [`Error::Invariant`] if the values cannot be rendered, which for
    /// an already-parsed [`Value`] indicates a broken invariant rather than bad
    /// input.
    pub fn to_json(&self) -> Result<String> {
        serde_json::to_string(&self.0).map_err(|error| {
            Error::invariant(format!(
                "could not render preserved fields as JSON: {error}"
            ))
        })
    }

    /// Parse a JSON object string, for the FFI boundary.
    ///
    /// # Errors
    ///
    /// Returns [`Error::Validation`] when `json` is not a JSON object.
    pub fn from_json(json: &str) -> Result<Self> {
        serde_json::from_str(json).map(Self).map_err(|error| {
            Error::validation(format!("preserved fields must be a JSON object: {error}"))
        })
    }
}

impl FromIterator<(String, Value)> for ExtraFields {
    fn from_iter<I: IntoIterator<Item = (String, Value)>>(iter: I) -> Self {
        Self(iter.into_iter().collect())
    }
}

/// A task, in the app's internal camelCase vocabulary.
///
/// This is *not* the `/v2` wire shape — see [`super::wire::WireTask`] for that
/// and for the four-entry rename table between them. Everything inland speaks
/// this vocabulary, which is why no cache or queue migration is needed when the
/// wire spelling changes.
///
/// Dates are kept as the strings the vault stores. They are deliberately not
/// parsed into `chrono` types: the frontmatter round-trips byte-for-byte, and
/// re-serializing a parsed date would rewrite the user's YAML in a normalized
/// spelling they never asked for. Ordering by date is a
/// [`super::filters`] concern and is handled there.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    /// The task's identity — its vault path, or a temp id while a create is
    /// still queued.
    pub id: TaskId,
    /// The vault-relative markdown path. Empty for an optimistic task whose
    /// create has not been acknowledged, which is why it is not a [`TaskId`].
    #[serde(default)]
    pub path: String,
    /// The task's title.
    pub title: String,
    /// Where the task is in the workflow.
    #[serde(default)]
    pub status: TaskStatus,
    /// How urgent the task is.
    #[serde(default)]
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
    pub contexts: Vec<ContextName>,
    /// The projects the task belongs to.
    #[serde(default)]
    pub projects: Vec<ProjectName>,
    /// The task's tags.
    #[serde(default)]
    pub tags: Vec<TagName>,
    /// The RFC 5545 recurrence rule, if the task repeats.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub recurrence: Option<String>,
    /// What the recurrence is measured from.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub recurrence_anchor: Option<RecurrenceAnchor>,
    /// Dates whose occurrence has been completed, as `YYYY-MM-DD`.
    #[serde(default)]
    pub complete_instances: Vec<String>,
    /// Dates whose occurrence has been skipped, as `YYYY-MM-DD`.
    #[serde(default)]
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
    /// Tracked work intervals stored in the note's frontmatter.
    #[serde(default)]
    pub time_entries: Vec<InlineTimeEntry>,
    /// Tasks this one is blocked by.
    #[serde(default)]
    pub blocked_by: Vec<BlockedByEntry>,
    /// Reminders attached to the task.
    #[serde(default)]
    pub reminders: Vec<Reminder>,
    /// Whether the task is archived.
    #[serde(default)]
    pub archived: bool,
    /// Total tracked time in whole minutes, as the server computed it.
    #[serde(default)]
    pub total_tracked_time: u32,
    /// Whether something else is blocking this task, as the server computed it.
    #[serde(default)]
    pub is_blocked: bool,
    /// Whether this task blocks something else, as the server computed it.
    #[serde(default)]
    pub is_blocking: bool,
    /// Frontmatter keys the client does not model.
    #[serde(default)]
    pub extra_fields: ExtraFields,
    /// The note body below the frontmatter.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub details: Option<String>,
}

impl Task {
    /// Whether the task still needs doing.
    #[must_use]
    pub const fn is_active(&self) -> bool {
        self.status.is_active()
    }

    /// Whether the task is finished or abandoned.
    #[must_use]
    pub const fn is_completed(&self) -> bool {
        self.status.is_completed()
    }

    /// Whether the task repeats.
    #[must_use]
    pub fn is_recurring(&self) -> bool {
        self.recurrence.is_some()
    }

    /// Whether the create that produced this task is still queued.
    #[must_use]
    pub fn is_pending_create(&self) -> bool {
        self.id.is_temp()
    }
}

#[cfg(test)]
mod tests {
    use indexmap::IndexMap;
    use serde_json::{Value, json};

    use super::{
        BlockedByEntry, ExtraFields, InlineTimeEntry, RecurrenceAnchor, Reminder, ReminderKind,
        Task,
    };
    use crate::domain::{ids::TaskId, priority::Priority, status::TaskStatus};

    fn minimal_json() -> Value {
        json!({ "id": "Tasks/a.md", "title": "Write the plan" })
    }

    #[test]
    fn applies_the_schema_defaults() {
        let task: Task = serde_json::from_value(minimal_json()).unwrap();
        assert_eq!(task.id, TaskId::parse("Tasks/a.md").unwrap());
        assert_eq!(task.path, "");
        assert_eq!(task.status, TaskStatus::Open);
        assert_eq!(task.priority, Priority::Normal);
        assert_eq!(task.total_tracked_time, 0);
        assert!(!task.archived);
        assert!(task.contexts.is_empty());
        assert!(task.extra_fields.is_empty());
        assert_eq!(task.due, None);
    }

    #[test]
    fn omits_absent_optionals_rather_than_writing_null() {
        let task: Task = serde_json::from_value(minimal_json()).unwrap();
        let json = serde_json::to_value(&task).unwrap();
        let object = json.as_object().unwrap();
        assert!(!object.contains_key("due"), "serialized as {json}");
        assert!(!object.contains_key("details"), "serialized as {json}");
        assert!(object.contains_key("path"), "serialized as {json}");
    }

    #[test]
    fn rejects_an_explicit_null_where_the_schema_says_optional() {
        let mut raw = minimal_json();
        raw["due"] = Value::Null;
        let error = serde_json::from_value::<Task>(raw).unwrap_err();
        assert!(
            error.to_string().contains("invalid type: null"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn round_trips_a_fully_populated_task() {
        let task = Task {
            id: TaskId::parse("Tasks/a.md").unwrap(),
            path: "Tasks/a.md".to_owned(),
            title: "Write the plan".to_owned(),
            status: TaskStatus::InProgress,
            priority: Priority::High,
            due: Some("2026-08-08".to_owned()),
            scheduled: Some("2026-08-07".to_owned()),
            contexts: vec![],
            projects: vec![],
            tags: vec![],
            recurrence: Some("FREQ=WEEKLY".to_owned()),
            recurrence_anchor: Some(RecurrenceAnchor::Completion),
            complete_instances: vec!["2026-08-01".to_owned()],
            skipped_instances: vec![],
            completed_date: None,
            date_created: Some("2026-07-01T00:00:00Z".to_owned()),
            date_modified: Some("2026-07-02T00:00:00Z".to_owned()),
            time_estimate: Some(30),
            time_entries: vec![InlineTimeEntry {
                start_time: "2026-07-01T09:00:00Z".to_owned(),
                end_time: Some("2026-07-01T09:30:00Z".to_owned()),
                duration: Some(30),
            }],
            blocked_by: vec![BlockedByEntry {
                uid: "Tasks/b.md".to_owned(),
                reltype: Some("FINISHTOSTART".to_owned()),
                gap: None,
            }],
            reminders: vec![Reminder {
                kind: ReminderKind::Relative,
                offset: Some("-PT15M".to_owned()),
                related_to: Some("due".to_owned()),
                absolute_time: None,
            }],
            archived: false,
            total_tracked_time: 30,
            is_blocked: true,
            is_blocking: false,
            extra_fields: ExtraFields::new(IndexMap::from([(
                "customKey".to_owned(),
                json!("value"),
            )])),
            details: Some("body".to_owned()),
        };

        let json = serde_json::to_string(&task).unwrap();
        assert_eq!(serde_json::from_str::<Task>(&json).unwrap(), task);
    }

    #[test]
    fn uses_the_camel_case_domain_spelling_not_the_wire_spelling() {
        let task: Task = serde_json::from_value(json!({
            "id": "Tasks/a.md",
            "title": "t",
            "recurrenceAnchor": "scheduled",
            "completeInstances": ["2026-08-01"],
            "skippedInstances": ["2026-08-02"],
            "extraFields": { "b": 1, "a": 2 },
        }))
        .unwrap();
        assert_eq!(task.recurrence_anchor, Some(RecurrenceAnchor::Scheduled));
        assert_eq!(task.complete_instances, ["2026-08-01"]);
        assert_eq!(task.skipped_instances, ["2026-08-02"]);
        assert_eq!(task.extra_fields.len(), 2);
    }

    #[test]
    fn preserved_fields_keep_their_source_order() {
        let fields = ExtraFields::from_json(r#"{"zebra":1,"apple":2,"middle":3}"#).unwrap();
        let keys: Vec<&str> = fields.as_map().keys().map(String::as_str).collect();
        assert_eq!(keys, ["zebra", "apple", "middle"]);
        assert_eq!(
            fields.to_json().unwrap(),
            r#"{"zebra":1,"apple":2,"middle":3}"#
        );
    }

    #[test]
    fn preserved_fields_reject_a_non_object() {
        let error = ExtraFields::from_json("[1, 2]").unwrap_err();
        assert!(
            error.to_string().contains("must be a JSON object"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn a_temp_id_marks_a_task_as_a_pending_create() {
        let task = Task {
            id: TaskId::temp(1, 1),
            ..serde_json::from_value(minimal_json()).unwrap()
        };
        assert!(task.is_pending_create());
    }
}
