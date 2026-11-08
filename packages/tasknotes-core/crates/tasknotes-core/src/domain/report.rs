//! Read-only report and status shapes.
//!
//! Every duration here is **whole minutes** (or whole seconds, where noted) in
//! an unsigned integer rather than a float. The server computes them with
//! `Math.floor`, and integers are what make the cross-platform determinism hash
//! meaningful — a float would also cost [`Eq`] on every type containing one. A
//! fractional value on the wire therefore fails to parse, loudly, which is the
//! intended behaviour: it would mean the server contract changed.

use serde_json::Value;

use super::{ids::TaskId, priority::Priority, serde_ext::present_only, task::Task};

/// Which vault the server is serving.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct VaultInfo {
    /// The vault's display name.
    pub name: String,
    /// The vault's absolute path on the server's machine.
    ///
    /// Explicitly nullable on the wire — the server omits it when it is
    /// configured not to disclose its filesystem layout — so `null` is a legal
    /// value here rather than a malformed payload.
    pub path: Option<String>,
}

/// Where a page sits in a longer list.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pagination {
    /// How many tasks match in total.
    pub total: u32,
    /// How many were skipped before this page.
    pub offset: u32,
    /// How many this page holds at most.
    pub limit: u32,
    /// Whether another page follows.
    pub has_more: bool,
}

/// A paginated task list.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TaskList {
    /// This page's tasks, in the server's order.
    pub tasks: Vec<Task>,
    /// Where this page sits.
    pub pagination: Pagination,
    /// Which vault answered.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub vault: Option<VaultInfo>,
    /// A human-readable remark from the server, such as a truncation warning.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub note: Option<String>,
}

/// The answer to a filtered query.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct QueryResponse {
    /// The matching tasks, in the server's order.
    pub tasks: Vec<Task>,
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

/// The envelope some endpoints wrap their payload in.
///
/// The client unwraps it opportunistically: when the body parses as this
/// envelope it reads `data`, and a `success: false` becomes an
/// [`crate::Error::Api`] carrying `error`. `data` stays an unparsed [`Value`]
/// because the envelope is generic over every response shape and UniFFI has no
/// generics — the caller parses it into the shape it asked for.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ApiResponse {
    /// Whether the server considers the request to have succeeded.
    pub success: bool,
    /// The payload, still unparsed.
    ///
    /// Defaulted because the reference schema types it `z.unknown()`, which a
    /// missing key satisfies. An envelope with no `data` therefore unwraps to
    /// `null` and fails when the caller parses it into a real shape, rather
    /// than failing here as "not an envelope" and handing the caller the
    /// envelope itself.
    #[serde(default)]
    pub data: Value,
    /// The failure message, when `success` is false.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub error: Option<String>,
}

/// Aggregate task counts for the dashboard.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStats {
    /// Every task in the vault.
    pub total: u32,
    /// Tasks in a completed status.
    pub completed: u32,
    /// Tasks in an active status.
    pub active: u32,
    /// Active tasks whose due date has passed.
    pub overdue: u32,
    /// Archived tasks.
    pub archived: u32,
}

/// What the server's natural-language parser extracted from a phrase.
///
/// The name lists stay plain strings rather than the validated newtypes: this
/// is the parser's *proposal*, shown to the user for confirmation before it
/// becomes a [`super::request::CreateTaskRequest`], and that conversion is
/// where the names get parsed.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct NlpParseResult {
    /// The title with the recognised fragments removed.
    pub title: String,
    /// A due date, if one was recognised.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub due: Option<String>,
    /// A priority, if one was recognised.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub priority: Option<Priority>,
    /// Projects, if any were recognised.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub projects: Option<Vec<String>>,
    /// Contexts, if any were recognised.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub contexts: Option<Vec<String>>,
    /// Tags, if any were recognised.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub tags: Option<Vec<String>>,
    /// A recurrence rule, if one was recognised.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub recurrence: Option<String>,
}

/// A calendar entry, flattened to a single date.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    /// The event's own identifier, which is not a task id.
    pub id: String,
    /// The event title.
    pub title: String,
    /// The `YYYY-MM-DD` day the event starts on.
    pub date: String,
    /// The task the event was generated from, if any.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub task_id: Option<TaskId>,
}

/// Whether the server considers itself healthy.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "lowercase")]
pub enum HealthState {
    /// Serving normally.
    Ok,
    /// Degraded or failing.
    Error,
}

/// The server's health response.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct HealthStatus {
    /// Whether the server considers itself healthy.
    pub status: HealthState,
    /// The server's version string.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub version: Option<String>,
    /// Whole seconds since the server started.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub uptime: Option<u64>,
    /// Whether the request carried valid credentials.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub authenticated: Option<bool>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{HealthState, HealthStatus, TaskStats};

    #[test]
    fn stats_use_the_camel_case_wire_spelling() {
        let stats: TaskStats = serde_json::from_value(json!({
            "total": 10, "completed": 4, "active": 5,
            "overdue": 1, "archived": 0,
        }))
        .unwrap();
        assert_eq!(stats.active, 5);
    }

    #[test]
    fn a_fractional_count_is_rejected_rather_than_truncated() {
        let error = serde_json::from_value::<TaskStats>(json!({
            "total": 10.5, "completed": 4, "active": 5,
            "overdue": 1, "archived": 0,
        }))
        .unwrap_err();
        assert_eq!(error.to_string(), "invalid number");
    }

    #[test]
    fn health_omits_the_fields_the_server_did_not_send() {
        let health: HealthStatus = serde_json::from_value(json!({ "status": "ok" })).unwrap();
        assert_eq!(health.status, HealthState::Ok);
        assert_eq!(health.uptime, None);
        assert_eq!(
            serde_json::to_value(&health).unwrap(),
            json!({"status":"ok"})
        );
    }
}
