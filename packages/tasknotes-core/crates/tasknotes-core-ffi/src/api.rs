//! The callable surface.
//!
//! Every function here is a one-line forward into `tasknotes-core`. Nothing
//! branches, nothing decides, nothing caches — if a body here ever grows a
//! second thought, that thought belongs in the pure crate where it can be
//! property-tested, mutation-tested, and run under miri.
//!
//! This module covers the Phase 3 domain layer only. The rest of the exported
//! surface lives beside the layer it projects: recurrence in
//! [`crate::recurrence`], the sync stack in [`crate::host`] and
//! [`crate::engine`], and the pure lib helpers in [`crate::dates`],
//! [`crate::calendar`], [`crate::nlp`] and [`crate::elapsed`].
//!
//! Naming is `<subject>_<verb>` rather than `<verb>_<subject>` so the generated
//! Swift free functions group by subject at a call site — `taskStatusLabel`,
//! `taskStatusNext` — since UniFFI has no namespacing for free functions.

use tasknotes_core::domain::{self, FilterConfig, Priority, SortConfig, Task, TaskStatus};

use crate::{dates::parse_iso_date, error::CoreError, update::UpdateTaskRequest};

/// The version of the core this binary was built from.
///
/// Exists so the host app can assert at launch that the linked static library
/// matches the bindings it was compiled against.
#[uniffi::export]
#[must_use]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

// ── Task status ────────────────────────────────────────────────────────────

/// Every status, in declaration order.
#[uniffi::export]
#[must_use]
pub fn task_status_all() -> Vec<TaskStatus> {
    domain::ALL_STATUSES.to_vec()
}

/// The wire spelling of a status (`in-progress`, not `inProgress`).
#[uniffi::export]
#[must_use]
pub fn task_status_wire_value(status: TaskStatus) -> String {
    status.as_str().to_owned()
}

/// Parse the wire spelling of a status.
///
/// # Errors
///
/// Returns [`CoreError::Invariant`] for any value outside the closed set. That
/// is deliberate: a plugin-side custom status must fail loudly rather than be
/// silently remapped onto `open`, which would make a task look actionable when
/// the vault says otherwise.
#[uniffi::export]
pub fn task_status_parse(raw: &str) -> Result<TaskStatus, CoreError> {
    TaskStatus::parse(raw).map_err(CoreError::from)
}

/// The label shown in menus and rows.
#[uniffi::export]
#[must_use]
pub fn task_status_label(status: TaskStatus) -> String {
    status.label().to_owned()
}

/// Whether the task still needs doing.
#[uniffi::export]
#[must_use]
pub fn task_status_is_active(status: TaskStatus) -> bool {
    status.is_active()
}

/// The status a single "toggle" gesture moves to.
#[uniffi::export]
#[must_use]
pub fn task_status_next(status: TaskStatus) -> TaskStatus {
    status.next()
}

// ── Priority ───────────────────────────────────────────────────────────────

/// Every priority, most urgent first.
#[uniffi::export]
#[must_use]
pub fn priority_all() -> Vec<Priority> {
    domain::ALL_PRIORITIES.to_vec()
}

/// The wire spelling of a priority.
#[uniffi::export]
#[must_use]
pub fn priority_wire_value(priority: Priority) -> String {
    priority.as_str().to_owned()
}

/// Parse the wire spelling of a priority.
///
/// # Errors
///
/// Returns [`CoreError::Invariant`] for any value outside the closed set.
#[uniffi::export]
pub fn priority_parse(raw: &str) -> Result<Priority, CoreError> {
    Priority::parse(raw).map_err(CoreError::from)
}

/// The short label shown in menus and rows.
#[uniffi::export]
#[must_use]
pub fn priority_label(priority: Priority) -> String {
    priority.label().to_owned()
}

/// The rank used for ordering, `0` being the most urgent.
#[uniffi::export]
#[must_use]
pub fn priority_rank(priority: Priority) -> u8 {
    priority.rank()
}

// ── Projects ───────────────────────────────────────────────────────────────

/// The canonical vault path inside a project value (`"[[A/B|C]]"` → `"A/B"`).
#[uniffi::export]
#[must_use]
pub fn project_path(value: &str) -> String {
    domain::project_path(value).to_owned()
}

/// What a human should see: `"[[A/B|C]]"` → `"C"`, `"[[A/B]]"` → `"B"`.
#[uniffi::export]
#[must_use]
pub fn project_display_name(value: &str) -> String {
    domain::project_display_name(value).to_owned()
}

/// Whether two project values refer to the same project.
///
/// Tolerant of the wikilink/bare-name duality, so string equality is never the
/// right test on the host side.
#[uniffi::export]
#[must_use]
pub fn project_matches(left: &str, right: &str) -> bool {
    domain::project_matches(left, right)
}

// ── Filtering and sorting ──────────────────────────────────────────────────

/// Keep only the tasks that pass every filtered dimension, in input order.
#[uniffi::export]
#[must_use]
pub fn task_filter_apply(tasks: &[Task], filter: &FilterConfig) -> Vec<Task> {
    domain::apply_filter(tasks, filter)
}

/// Whether one task passes every filtered dimension.
#[uniffi::export]
#[must_use]
pub fn task_filter_matches(task: &Task, filter: &FilterConfig) -> bool {
    filter.matches(task)
}

/// Whether any dimension is filtered at all.
#[uniffi::export]
#[must_use]
pub fn task_filter_is_active(filter: &FilterConfig) -> bool {
    filter.is_active()
}

/// How many dimensions are filtered, for the `filters (3)` badge.
///
/// Exported so the badge shows a *number* rather than a filled-or-hollow glyph.
/// Counting the dimensions in the shell instead would put a second opinion
/// about what "filtered" means next to [`task_filter_is_active`], and the two
/// would drift the first time a dimension was added — which is exactly what
/// adding `query` just did.
#[uniffi::export]
#[must_use]
pub fn task_filter_active_count(filter: &FilterConfig) -> u32 {
    filter.active_count()
}

/// Whether one task matches a free-text query.
///
/// The same predicate [`FilterConfig::query`] runs, exported on its own for a
/// live count or a "does this row still belong here?" check. See
/// [`tasknotes_core::domain::search_matches`] for the exact semantics — which
/// fields are searched, substring versus prefix, the case-folding rule, and why
/// a query is one phrase rather than a bag of tokens. Every one of those is a
/// product decision, and this export is what stops a second client answering
/// them differently.
#[uniffi::export]
#[must_use]
pub fn task_search_matches(task: &Task, query: &str) -> bool {
    domain::search_matches(task, query)
}

/// Sort a list of tasks. The sort is stable, which is load-bearing: an
/// unorderable due value compares equal to everything, and stability is what
/// turns that into "leave it where it was" rather than "shuffle it".
///
/// `today` is the viewer's civil date as `YYYY-MM-DD`. It is read by exactly
/// one leg of one key — the recurrence fallback of [`SortField::EffectiveDate`]
/// — and ignored by every other field, so it is optional. Omitting it is a
/// statement that the caller did not say what day it is, which makes that leg
/// unanswerable and sorts a rule-only task as undated. **A shell offering
/// `EffectiveDate` should always pass it.**
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when `today` is present but is not a
/// `YYYY-MM-DD` calendar date. Rejected rather than ignored: a silently
/// discarded `today` would reorder the list with no way to notice.
///
/// [`SortField::EffectiveDate`]: tasknotes_core::domain::SortField::EffectiveDate
#[uniffi::export(default(today = None))]
pub fn task_sort_apply(
    tasks: &[Task],
    sort: SortConfig,
    today: Option<String>,
) -> Result<Vec<Task>, CoreError> {
    // Consumed by value rather than borrowed because UniFFI lifts arguments
    // *out of* the FFI buffer, so a `String` arrives owned and there is no
    // borrow on the far side to hand across — the same reason the recurrence
    // exports own their `DTSTART` fallbacks.
    let today = today.map(|value| parse_iso_date(&value)).transpose()?;
    Ok(domain::apply_sort(tasks, sort, today))
}

// ── JSON round trips ───────────────────────────────────────────────────────
//
// The host does not parse vault or wire JSON itself — that is the whole point
// of a shared core. These exist so a host can hand the core a payload it
// already has in hand (a cached response body, a fixture, a pasteboard drop)
// and get a validated value back, and so the FFI round trip is directly
// testable from Swift.

/// Parse a task from its domain-vocabulary JSON.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when the payload does not match the
/// schema, including when a field the schema marks optional is present as an
/// explicit `null`.
#[uniffi::export]
pub fn task_from_json(json: &str) -> Result<Task, CoreError> {
    serde_json::from_str(json).map_err(|error| CoreError::Validation {
        message: format!("could not parse a task: {error}"),
    })
}

/// Render a task as its domain-vocabulary JSON.
///
/// # Errors
///
/// Returns [`CoreError::Invariant`]: for an already-constructed [`Task`] a
/// serialization failure is a broken invariant, not bad input.
#[uniffi::export]
pub fn task_to_json(task: &Task) -> Result<String, CoreError> {
    serde_json::to_string(task).map_err(|error| CoreError::Invariant {
        message: format!("could not render a task as JSON: {error}"),
    })
}

/// Parse a partial update from its domain-vocabulary JSON.
///
/// Absent, `null`, and a value stay three distinct states across this call.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when the payload does not match the
/// schema.
#[uniffi::export]
pub fn update_task_request_from_json(json: &str) -> Result<UpdateTaskRequest, CoreError> {
    serde_json::from_str::<domain::UpdateTaskRequest>(json)
        .map(UpdateTaskRequest::from)
        .map_err(|error| CoreError::Validation {
            message: format!("could not parse a task update: {error}"),
        })
}

/// Render a partial update as its domain-vocabulary JSON.
///
/// An `Unchanged` field is omitted from the output entirely, which is what
/// tells the server to leave the frontmatter key alone.
///
/// # Errors
///
/// Returns [`CoreError::Invariant`] when the update cannot be rendered.
#[uniffi::export]
pub fn update_task_request_to_json(request: UpdateTaskRequest) -> Result<String, CoreError> {
    serde_json::to_string(&domain::UpdateTaskRequest::from(request)).map_err(|error| {
        CoreError::Invariant {
            message: format!("could not render a task update as JSON: {error}"),
        }
    })
}

#[cfg(test)]
mod tests {
    use tasknotes_core::domain::{
        ALL_PRIORITIES, ALL_STATUSES, FilterConfig, Priority, SortConfig, SortDirection, SortField,
        Task, TaskStatus,
    };

    use super::{
        core_version, priority_all, priority_label, priority_parse, priority_rank,
        priority_wire_value, project_display_name, project_matches, project_path,
        task_filter_active_count, task_filter_apply, task_filter_is_active, task_filter_matches,
        task_from_json, task_search_matches, task_sort_apply, task_status_all,
        task_status_is_active, task_status_label, task_status_next, task_status_parse,
        task_status_wire_value, task_to_json, update_task_request_from_json,
        update_task_request_to_json,
    };
    use crate::error::CoreError;

    fn task(title: &str, due: Option<&str>) -> Task {
        let json = match due {
            Some(due) => format!(r#"{{"id":"Tasks/{title}.md","title":"{title}","due":"{due}"}}"#),
            None => format!(r#"{{"id":"Tasks/{title}.md","title":"{title}"}}"#),
        };
        task_from_json(&json).unwrap()
    }

    fn titles(tasks: &[Task]) -> Vec<&str> {
        tasks.iter().map(|task| task.title.as_str()).collect()
    }

    #[test]
    fn reports_the_crate_version() {
        assert_eq!(core_version(), env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn projects_the_closed_enums_in_declaration_order() {
        assert_eq!(task_status_all(), ALL_STATUSES.to_vec());
        assert_eq!(priority_all(), ALL_PRIORITIES.to_vec());
        assert_eq!(
            task_status_wire_value(TaskStatus::InProgress),
            "in-progress"
        );
        assert_eq!(task_status_label(TaskStatus::InProgress), "In Progress");
        assert_eq!(task_status_next(TaskStatus::Open), TaskStatus::Done);
        assert!(task_status_is_active(TaskStatus::Waiting));
        assert_eq!(priority_wire_value(Priority::Highest), "highest");
        assert_eq!(priority_label(Priority::Highest), "P1");
        assert_eq!(priority_rank(Priority::None), 5);
    }

    #[test]
    fn an_unknown_enum_value_fails_loudly_across_the_boundary() {
        let error = task_status_parse("someday").unwrap_err();
        assert!(
            matches!(error, CoreError::Invariant { ref message } if message.contains("unknown task status")),
            "unexpected error: {error:?}"
        );
        let error = priority_parse("urgent").unwrap_err();
        assert!(
            matches!(error, CoreError::Invariant { ref message } if message.contains("unknown priority")),
            "unexpected error: {error:?}"
        );
        assert_eq!(
            task_status_parse("delegated").unwrap(),
            TaskStatus::Delegated
        );
    }

    #[test]
    fn projects_the_wikilink_equivalence_rules() {
        assert_eq!(project_path("[[Areas/Work|Work]]"), "Areas/Work");
        assert_eq!(project_display_name("[[A/B]]"), "B");
        assert!(project_matches("[[Areas/Work|Work]]", "work"));
    }

    #[test]
    fn filters_and_sorts_through_the_boundary_types() {
        let tasks = [
            task("undated", None),
            task("later", Some("2026-08-09")),
            task("sooner", Some("2026-08-08")),
        ];

        assert_eq!(
            titles(&task_sort_apply(&tasks, SortConfig::default(), None).unwrap()),
            ["sooner", "later", "undated"]
        );
        assert_eq!(
            titles(
                &task_sort_apply(
                    &tasks,
                    SortConfig {
                        field: SortField::Title,
                        direction: SortDirection::Desc,
                    },
                    None
                )
                .unwrap()
            ),
            ["undated", "sooner", "later"]
        );

        let filter = FilterConfig {
            has_no_due_date: true,
            ..FilterConfig::default()
        };
        assert!(task_filter_is_active(&filter));
        assert_eq!(task_filter_active_count(&filter), 1);
        assert!(!task_filter_is_active(&FilterConfig::default()));
        assert_eq!(task_filter_active_count(&FilterConfig::default()), 0);
        assert_eq!(titles(&task_filter_apply(&tasks, &filter)), ["undated"]);
        assert!(task_filter_matches(&task("undated", None), &filter));
        assert!(!task_filter_matches(
            &task("later", Some("2026-08-09")),
            &filter
        ));
    }

    #[test]
    fn search_crosses_as_a_filter_dimension_and_as_a_predicate() {
        let tasks = [
            task("undated", None),
            task("later", Some("2026-08-09")),
            task("sooner", Some("2026-08-08")),
        ];

        assert!(task_search_matches(&task("undated", None), "DATE"));
        assert!(!task_search_matches(&task("undated", None), "mortgage"));
        // An empty query narrows nothing, which is what lets a search field sit
        // over a list the user is already looking at.
        assert!(task_search_matches(&task("undated", None), "  "));

        let searching = FilterConfig {
            query: "er".to_owned(),
            ..FilterConfig::default()
        };
        assert!(task_filter_is_active(&searching));
        assert_eq!(task_filter_active_count(&searching), 1);
        assert_eq!(
            titles(&task_filter_apply(&tasks, &searching)),
            ["later", "sooner"]
        );
    }

    #[test]
    fn the_effective_date_sort_reads_scheduled_and_rejects_a_malformed_today() {
        let scheduled: Task =
            task_from_json(r#"{"id":"Tasks/s.md","title":"scheduled","scheduled":"2026-08-04"}"#)
                .unwrap();
        let tasks = [task("later", Some("2026-08-31")), scheduled];
        let sort = SortConfig {
            field: SortField::EffectiveDate,
            direction: SortDirection::Asc,
        };

        assert_eq!(
            titles(&task_sort_apply(&tasks, sort, Some("2026-08-03".to_owned())).unwrap()),
            ["scheduled", "later"],
            "a scheduled-only task is dated, not undated"
        );

        // A `today` that is not a date is reported rather than discarded: a
        // silently ignored one would reorder the list with nothing to notice.
        let error = task_sort_apply(&tasks, sort, Some("08/03/2026".to_owned())).unwrap_err();
        assert!(
            matches!(error, CoreError::Validation { ref message } if message.contains("YYYY-MM-DD")),
            "unexpected error: {error:?}"
        );
    }

    #[test]
    fn a_task_survives_the_json_round_trip() {
        let original = task("sooner", Some("2026-08-08"));
        let json = task_to_json(&original).unwrap();
        assert_eq!(task_from_json(&json).unwrap(), original);
    }

    #[test]
    fn a_malformed_task_payload_is_a_validation_failure() {
        let error = task_from_json(r#"{"id":"Tasks/a.txt","title":"t"}"#).unwrap_err();
        assert!(
            matches!(error, CoreError::Validation { ref message } if message.contains("markdown file")),
            "unexpected error: {error:?}"
        );
    }

    #[test]
    fn an_update_keeps_its_three_states_across_the_json_round_trip() {
        let request =
            update_task_request_from_json(r#"{"due":null,"scheduled":"2026-08-08"}"#).unwrap();
        let json = update_task_request_to_json(request.clone()).unwrap();
        assert_eq!(json, r#"{"due":null,"scheduled":"2026-08-08"}"#);
        assert_eq!(update_task_request_from_json(&json).unwrap(), request);
    }
}
