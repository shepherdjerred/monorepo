//! Create and update payloads.
//!
//! These are the app's *internal* payload shapes, spelled in the camelCase
//! domain vocabulary — which is also how they are persisted in the command
//! queue. Translating them to the `/v2` wire spelling is
//! [`super::wire::to_wire_task_fields`]'s job, and happens only on the way to
//! HTTP.
//!
//! As with [`super::task::Task`], field order is an FFI wire format.

use super::{
    ids::{ContextName, ProjectName, TagName},
    priority::Priority,
    serde_ext::{FieldUpdate, present_only},
    status::TaskStatus,
    task::{ExtraFields, RecurrenceAnchor},
};
use crate::{Error, Result};

/// A task title that is known not to be empty.
///
/// Both request schemas spell this `z.string().min(1)`, and enforcing it in the
/// type means the sync layer never has to re-check before enqueuing a command
/// that the server would reject.
///
/// [`super::task::Task::title`] is deliberately *not* this type: the wire
/// schema for a task is a plain `z.string()`, so a note the user has not
/// titled yet round-trips rather than failing to load.
#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(try_from = "String", into = "String")]
pub struct TaskTitle(String);

impl TaskTitle {
    /// Parse a non-empty title.
    ///
    /// # Errors
    ///
    /// Returns [`Error::Invariant`] when the title is empty. Whitespace-only
    /// titles are accepted, matching `z.string().min(1)` exactly — tightening
    /// that here would reject payloads the server accepts.
    pub fn parse(raw: impl Into<String>) -> Result<Self> {
        let raw = raw.into();
        if raw.is_empty() {
            return Err(Error::invariant("a task title must not be empty"));
        }
        Ok(Self(raw))
    }

    /// Borrow the title.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Consume the wrapper, yielding the title.
    #[must_use]
    pub fn into_string(self) -> String {
        self.0
    }
}

impl TryFrom<String> for TaskTitle {
    type Error = Error;

    fn try_from(raw: String) -> Result<Self> {
        Self::parse(raw)
    }
}

impl From<TaskTitle> for String {
    fn from(title: TaskTitle) -> Self {
        title.into_string()
    }
}

impl core::fmt::Display for TaskTitle {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// The payload for creating a task.
///
/// Every field except the title is optional, and an absent field means "let the
/// server apply its default". There is no three-state problem here: a create
/// has nothing to clear, which is why these are plain [`Option`]s rather than
/// [`FieldUpdate`]s.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    /// The new task's title.
    pub title: TaskTitle,
    /// The note body.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub details: Option<String>,
    /// The initial status; the server defaults to `open`.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub status: Option<TaskStatus>,
    /// The initial priority; the server defaults to `normal`.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub priority: Option<Priority>,
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
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub contexts: Option<Vec<ContextName>>,
    /// The projects the task belongs to.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub projects: Option<Vec<ProjectName>>,
    /// The task's tags.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub tags: Option<Vec<TagName>>,
    /// The RFC 5545 recurrence rule.
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
    /// The estimate in whole minutes.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub time_estimate: Option<u32>,
    /// Extra frontmatter keys to write.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub extra_fields: Option<ExtraFields>,
}

impl CreateTaskRequest {
    /// A create carrying nothing but a title.
    #[must_use]
    pub fn new(title: TaskTitle) -> Self {
        Self {
            title,
            details: None,
            status: None,
            priority: None,
            due: None,
            scheduled: None,
            contexts: None,
            projects: None,
            tags: None,
            recurrence: None,
            recurrence_anchor: None,
            time_estimate: None,
            extra_fields: None,
        }
    }
}

/// A partial update to a task.
///
/// Three of the states a field can be in are meaningful and distinct, so the
/// nullable fields are [`FieldUpdate`]s: absent leaves the frontmatter key
/// alone, `null` deletes it, and a value replaces it. Getting this wrong in
/// either direction silently corrupts a note — an absent field treated as
/// `null` erases data, and a `null` treated as absent makes "clear the due
/// date" a no-op.
///
/// The fields that are optional-but-not-nullable in the schema stay plain
/// [`Option`]s, because there is no way to *unset* a status or a title.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskRequest {
    /// A new title. Cannot be cleared.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub title: Option<TaskTitle>,
    /// The note body; `null` clears it.
    #[serde(default, skip_serializing_if = "FieldUpdate::is_unchanged")]
    pub details: TextUpdate,
    /// A new status. Cannot be cleared.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub status: Option<TaskStatus>,
    /// A new priority. Cannot be cleared.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub priority: Option<Priority>,
    /// The due date; `null` clears it.
    #[serde(default, skip_serializing_if = "FieldUpdate::is_unchanged")]
    pub due: TextUpdate,
    /// The scheduled date; `null` clears it.
    #[serde(default, skip_serializing_if = "FieldUpdate::is_unchanged")]
    pub scheduled: TextUpdate,
    /// The full replacement context list.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub contexts: Option<Vec<ContextName>>,
    /// The full replacement project list.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub projects: Option<Vec<ProjectName>>,
    /// The full replacement tag list.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub tags: Option<Vec<TagName>>,
    /// The recurrence rule; `null` stops the task repeating.
    #[serde(default, skip_serializing_if = "FieldUpdate::is_unchanged")]
    pub recurrence: TextUpdate,
    /// What the recurrence is measured from; `null` clears it.
    #[serde(default, skip_serializing_if = "FieldUpdate::is_unchanged")]
    pub recurrence_anchor: RecurrenceAnchorUpdate,
    /// The estimate in whole minutes; `null` clears it.
    #[serde(default, skip_serializing_if = "FieldUpdate::is_unchanged")]
    pub time_estimate: MinutesUpdate,
    /// The full replacement set of extra frontmatter keys.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub extra_fields: Option<ExtraFields>,
}

/// A clearable string field. Named because UniFFI cannot export a generic.
pub type TextUpdate = FieldUpdate<String>;

/// A clearable whole-minutes field. Named because UniFFI cannot export a
/// generic.
pub type MinutesUpdate = FieldUpdate<u32>;

/// A clearable recurrence anchor. Named because UniFFI cannot export a generic.
pub type RecurrenceAnchorUpdate = FieldUpdate<RecurrenceAnchor>;

impl UpdateTaskRequest {
    /// Whether the update would change nothing at all.
    ///
    /// Serializing an empty update yields `{}`, which the server accepts as a
    /// no-op — so the sync layer can drop it rather than spend a round trip.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::{CreateTaskRequest, TaskTitle, UpdateTaskRequest};
    use crate::domain::{serde_ext::FieldUpdate, status::TaskStatus, task::RecurrenceAnchor};

    #[test]
    fn a_title_must_not_be_empty() {
        assert!(TaskTitle::parse("").is_err());
        assert_eq!(TaskTitle::parse(" ").unwrap().as_str(), " ");
        assert_eq!(TaskTitle::parse("Write").unwrap().as_str(), "Write");
    }

    #[test]
    fn a_minimal_create_serializes_to_just_a_title() {
        let request = CreateTaskRequest::new(TaskTitle::parse("Write").unwrap());
        assert_eq!(
            serde_json::to_value(&request).unwrap(),
            json!({ "title": "Write" })
        );
    }

    #[test]
    fn an_empty_update_serializes_to_an_empty_object() {
        let request = UpdateTaskRequest::default();
        assert!(request.is_empty());
        assert_eq!(serde_json::to_value(&request).unwrap(), json!({}));
    }

    #[test]
    fn clearing_a_field_is_distinct_from_leaving_it_alone() {
        let cleared: UpdateTaskRequest = serde_json::from_value(json!({ "due": null })).unwrap();
        assert_eq!(cleared.due, FieldUpdate::Clear);
        assert_eq!(cleared.scheduled, FieldUpdate::Unchanged);
        assert!(!cleared.is_empty());
        assert_eq!(
            serde_json::to_value(&cleared).unwrap(),
            json!({ "due": Value::Null })
        );

        let set: UpdateTaskRequest =
            serde_json::from_value(json!({ "due": "2026-08-08" })).unwrap();
        assert_eq!(set.due, FieldUpdate::Set("2026-08-08".to_owned()));
    }

    #[test]
    fn a_non_nullable_field_rejects_null() {
        let error =
            serde_json::from_value::<UpdateTaskRequest>(json!({ "status": null })).unwrap_err();
        assert!(
            error.to_string().contains("invalid type: null"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn round_trips_the_whole_update_shape() {
        let request: UpdateTaskRequest = serde_json::from_value(json!({
            "title": "New",
            "details": null,
            "status": "done",
            "recurrenceAnchor": "completion",
            "timeEstimate": null,
            "projects": ["[[Areas/Work|Work]]"],
        }))
        .unwrap();
        assert_eq!(request.status, Some(TaskStatus::Done));
        assert_eq!(request.details, FieldUpdate::Clear);
        assert_eq!(request.time_estimate, FieldUpdate::Clear);
        assert_eq!(
            request.recurrence_anchor,
            FieldUpdate::Set(RecurrenceAnchor::Completion)
        );

        let json = serde_json::to_value(&request).unwrap();
        assert_eq!(
            serde_json::from_value::<UpdateTaskRequest>(json).unwrap(),
            request
        );
    }

    #[test]
    fn a_blank_project_name_is_rejected_at_the_payload_boundary() {
        let error =
            serde_json::from_value::<UpdateTaskRequest>(json!({ "projects": [""] })).unwrap_err();
        assert!(
            error.to_string().contains("must not be blank"),
            "unexpected error: {error}"
        );
    }
}
