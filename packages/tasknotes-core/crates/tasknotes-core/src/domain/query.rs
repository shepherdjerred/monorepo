//! Server-side query parameters, and the pickers' vocabulary.

use super::{priority::Priority, serde_ext::present_only, status::TaskStatus};

/// The filter sent to the server's query endpoint.
///
/// Distinct from [`super::filters::FilterConfig`], which filters an
/// already-loaded list on-device: this one is a request parameter, and its
/// `hasNo…` flags exist because "absent" cannot be expressed as a value.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskQueryFilter {
    /// Restrict to these statuses.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub status: Option<Vec<TaskStatus>>,
    /// Restrict to these priorities.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub priority: Option<Vec<Priority>>,
    /// Restrict to these projects.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub projects: Option<Vec<String>>,
    /// Restrict to these contexts.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub contexts: Option<Vec<String>>,
    /// Restrict to these tags.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub tags: Option<Vec<String>>,
    /// Only tasks due strictly before this date.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub due_before: Option<String>,
    /// Only tasks due strictly after this date.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub due_after: Option<String>,
    /// Only tasks with no due date at all.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub has_no_due_date: Option<bool>,
    /// Only tasks belonging to no project.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub has_no_project: Option<bool>,
    /// Full-text search over titles.
    #[serde(
        default,
        deserialize_with = "present_only",
        skip_serializing_if = "Option::is_none"
    )]
    pub search: Option<String>,
}

/// The values a filter picker can offer, as the server reports them.
///
/// `statuses` and `priorities` are **plain strings**, not
/// [`TaskStatus`]/[`Priority`]. That is not an oversight: the endpoint returns
/// the vault's *configured* status and priority objects, which may include
/// values this client's closed enums do not know about. Coercing them here
/// would either drop entries from the picker or reintroduce the silent remap
/// the closed enums exist to prevent, so they stay opaque — the picker shows
/// what the vault has, and selecting an unknown one fails loudly at the wire
/// boundary where it belongs.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct FilterOptions {
    /// Every configured status value.
    pub statuses: Vec<String>,
    /// Every configured priority value.
    pub priorities: Vec<String>,
    /// Every context in use.
    pub contexts: Vec<String>,
    /// Every project in use.
    pub projects: Vec<String>,
    /// Every tag in use.
    pub tags: Vec<String>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::TaskQueryFilter;
    use crate::domain::status::TaskStatus;

    #[test]
    fn an_empty_query_serializes_to_an_empty_object() {
        assert_eq!(
            serde_json::to_value(TaskQueryFilter::default()).unwrap(),
            json!({})
        );
    }

    #[test]
    fn uses_the_camel_case_wire_spelling() {
        let filter: TaskQueryFilter = serde_json::from_value(json!({
            "status": ["open", "in-progress"],
            "dueBefore": "2026-08-08",
            "hasNoProject": true,
        }))
        .unwrap();
        assert_eq!(
            filter.status,
            Some(vec![TaskStatus::Open, TaskStatus::InProgress])
        );
        assert_eq!(filter.due_before.as_deref(), Some("2026-08-08"));
        assert_eq!(filter.has_no_project, Some(true));
        assert_eq!(filter.has_no_due_date, None);
    }

    #[test]
    fn an_unknown_status_in_a_query_fails_loudly() {
        let error = serde_json::from_value::<TaskQueryFilter>(json!({ "status": ["someday"] }))
            .unwrap_err();
        assert!(
            error.to_string().contains("someday"),
            "unexpected error: {error}"
        );
    }
}
