//! On-device filtering and sorting of an already-loaded task list.
//!
//! Distinct from [`super::query::TaskQueryFilter`], which is a server request
//! parameter. Everything here is a pure function over a slice, so the same code
//! backs every list screen on every platform — which is the point: two
//! hand-written sorts are how the same query starts returning results in a
//! different order on iOS than on macOS.

use core::cmp::Ordering;

use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime};

use super::{priority::Priority, project::project_matches, status::TaskStatus, task::Task};

/// Which key a list is sorted on.
#[derive(
    Debug,
    Clone,
    Copy,
    Default,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    serde::Serialize,
    serde::Deserialize,
)]
#[serde(rename_all = "camelCase")]
pub enum SortField {
    /// By due date, with undated tasks always last.
    #[default]
    DueDate,
    /// By priority, most urgent first when ascending.
    Priority,
    /// By title.
    Title,
}

/// Which way round a sort runs.
#[derive(
    Debug,
    Clone,
    Copy,
    Default,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    serde::Serialize,
    serde::Deserialize,
)]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    /// Smallest first.
    #[default]
    Asc,
    /// Largest first.
    Desc,
}

impl SortDirection {
    /// Apply the direction to an ascending comparison.
    #[must_use]
    const fn orient(self, ordering: Ordering) -> Ordering {
        match self {
            Self::Asc => ordering,
            Self::Desc => ordering.reverse(),
        }
    }
}

/// A complete sort specification.
///
/// [`Default`] is the app's `DEFAULT_SORT`: due date ascending.
#[derive(
    Debug,
    Clone,
    Copy,
    Default,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    serde::Serialize,
    serde::Deserialize,
)]
pub struct SortConfig {
    /// The key to sort on.
    pub field: SortField,
    /// Which way round.
    pub direction: SortDirection,
}

/// A set of on-device list filters, all of which must pass.
///
/// The TypeScript type distinguishes `undefined` from `[]` for each list, but
/// every consumer tests `length > 0`, so the two are already the same thing.
/// Collapsing them to a plain `Vec` removes a state that could never mean
/// anything — an empty list is "this dimension is not filtered".
///
/// [`Default`] is the app's `EMPTY_FILTER`.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterConfig {
    /// Keep tasks in any of these projects, matched by
    /// [`project_matches`] rather than string equality.
    #[serde(default)]
    pub projects: Vec<String>,
    /// Keep tasks in any of these contexts, matched exactly.
    #[serde(default)]
    pub contexts: Vec<String>,
    /// Keep tasks with any of these tags, matched exactly.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Keep tasks in any of these statuses.
    #[serde(default)]
    pub statuses: Vec<TaskStatus>,
    /// Keep tasks at any of these priorities.
    #[serde(default)]
    pub priorities: Vec<Priority>,
    /// Keep only tasks with no due date.
    #[serde(default)]
    pub has_no_due_date: bool,
}

impl FilterConfig {
    /// Whether any dimension is filtered at all.
    #[must_use]
    pub fn is_active(&self) -> bool {
        self.active_count() > 0
    }

    /// How many dimensions are filtered, for the "filters (3)" badge.
    ///
    /// Returns `u32` rather than `usize` so the value crosses the FFI boundary
    /// unchanged. `usize` is not expressible in UniFFI, and narrowing it at the
    /// binding layer would be a partial conversion — a silent truncation is
    /// exactly the class of lie the lint set exists to prevent. The count is
    /// bounded by the number of dimensions below, so a wider type buys nothing.
    #[must_use]
    pub fn active_count(&self) -> u32 {
        let dimensions = [
            !self.projects.is_empty(),
            !self.contexts.is_empty(),
            !self.tags.is_empty(),
            !self.statuses.is_empty(),
            !self.priorities.is_empty(),
            self.has_no_due_date,
        ];
        // `u32::from(bool)` is total, so this needs no cast and no fallible
        // narrowing — summing the flags directly keeps the whole path infallible.
        dimensions.into_iter().map(u32::from).sum()
    }

    /// Whether one task passes every filtered dimension.
    ///
    /// Exposed separately from [`apply_filter`] because the list screens need
    /// the predicate on its own — for a live count, or to decide whether a task
    /// that just changed still belongs in the visible list.
    #[must_use]
    pub fn matches(&self, task: &Task) -> bool {
        if !self.projects.is_empty()
            && !task.projects.iter().any(|project| {
                self.projects
                    .iter()
                    .any(|wanted| project_matches(project.as_str(), wanted))
            })
        {
            return false;
        }
        if !self.contexts.is_empty()
            && !task.contexts.iter().any(|context| {
                self.contexts
                    .iter()
                    .any(|wanted| wanted == context.as_str())
            })
        {
            return false;
        }
        if !self.tags.is_empty()
            && !task
                .tags
                .iter()
                .any(|tag| self.tags.iter().any(|wanted| wanted == tag.as_str()))
        {
            return false;
        }
        if !self.statuses.is_empty() && !self.statuses.contains(&task.status) {
            return false;
        }
        if !self.priorities.is_empty() && !self.priorities.contains(&task.priority) {
            return false;
        }
        if self.has_no_due_date && task.due.is_some() {
            return false;
        }
        true
    }
}

/// Keep only the tasks that pass every filtered dimension, in input order.
#[must_use]
pub fn apply_filter(tasks: &[Task], filter: &FilterConfig) -> Vec<Task> {
    tasks
        .iter()
        .filter(|task| filter.matches(task))
        .cloned()
        .collect()
}

/// Sort a copy of the list.
///
/// The sort is **stable**, which is load-bearing rather than incidental: the
/// due-date comparison reports "equal" for pairs it cannot order — a due value
/// that is not a date this core recognises — and stability is what turns that
/// into "leave them where they were" instead of "shuffle them arbitrarily".
#[must_use]
pub fn apply_sort(tasks: &[Task], sort: SortConfig) -> Vec<Task> {
    let mut sorted = tasks.to_vec();
    sorted.sort_by(|left, right| compare(left, right, sort));
    sorted
}

/// Order two tasks under a sort specification.
#[must_use]
pub fn compare(left: &Task, right: &Task, sort: SortConfig) -> Ordering {
    match sort.field {
        SortField::DueDate => {
            compare_due(left.due.as_deref(), right.due.as_deref(), sort.direction)
        }
        SortField::Priority => sort.direction.orient(left.priority.cmp(&right.priority)),
        SortField::Title => sort
            .direction
            .orient(compare_titles(&left.title, &right.title)),
    }
}

/// How orderable a due value is.
///
/// Three cases, because `new Date(...).getTime()` has three outcomes and the
/// TypeScript comparator treats each differently:
///
/// * **missing** — including an empty string, which `!a.due` catches — always
///   sorts last, *regardless of direction*. That asymmetry is deliberate
///   upstream: reversing a list should not bury the dated tasks under the
///   undated ones.
/// * **unparseable** — `getTime()` returns `NaN`, every comparison involving it
///   yields `NaN`, and a comparator returning `NaN` is treated as `0`. So an
///   unparseable value compares equal to everything and a stable sort leaves it
///   in place.
/// * **an instant** — compared numerically.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DueKey {
    /// No due value at all, or an empty one.
    Missing,
    /// A due value that is not a date this core recognises.
    Unparseable,
    /// Milliseconds since the Unix epoch.
    At(i64),
}

/// Classify a due value for ordering.
fn due_key(due: Option<&str>) -> DueKey {
    match due {
        // `!a.due` in TypeScript is a falsy check, so an empty string is
        // undated too — not a value that fails to parse.
        None | Some("") => DueKey::Missing,
        Some(raw) => parse_due_millis(raw).map_or(DueKey::Unparseable, DueKey::At),
    }
}

/// Interpret a due value as milliseconds since the Unix epoch.
///
/// The parity surface with `@tasknotes/model` is deliberately timezone-free and
/// UTC-anchored, so a date-only value is UTC midnight — matching JavaScript's
/// ISO date parsing — and a datetime without an offset is read as UTC rather
/// than as host-local time. Reading it as local would make a list's order depend
/// on the machine's `TZ`, which is exactly the cross-platform divergence this
/// core exists to prevent.
fn parse_due_millis(raw: &str) -> Option<i64> {
    if let Ok(date) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
        return Some(date.and_time(NaiveTime::MIN).and_utc().timestamp_millis());
    }
    if let Ok(instant) = DateTime::parse_from_rfc3339(raw) {
        return Some(instant.timestamp_millis());
    }
    for format in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(raw, format) {
            return Some(naive.and_utc().timestamp_millis());
        }
    }
    None
}

/// Order two due values, replicating the TypeScript comparator branch for
/// branch. See [`DueKey`] for why each case behaves as it does.
fn compare_due(left: Option<&str>, right: Option<&str>, direction: SortDirection) -> Ordering {
    match (due_key(left), due_key(right)) {
        (DueKey::Missing, DueKey::Missing) => Ordering::Equal,
        (DueKey::Missing, _) => Ordering::Greater,
        (_, DueKey::Missing) => Ordering::Less,
        (DueKey::At(left), DueKey::At(right)) => direction.orient(left.cmp(&right)),
        (DueKey::Unparseable, _) | (_, DueKey::Unparseable) => Ordering::Equal,
    }
}

/// Order two titles the way a human reading a list expects.
///
/// ⚠️ **This is an approximation of `String.prototype.localeCompare`.** Matching
/// it exactly requires a Unicode collation table, which would mean pulling ICU
/// into a core whose whole appeal is that it is small and deterministic. What is
/// implemented instead is case-insensitive primary ordering with a case
/// tie-break that puts lowercase first, which agrees with ICU's root collation
/// across ASCII. It diverges on accents, punctuation, and scripts where root
/// collation reorders code points — those sort by `char` order here.
///
/// The divergence is deterministic and identical on every platform, which is
/// the property that actually matters; it is a parity gap against the existing
/// React Native app, not a source of cross-platform drift.
fn compare_titles(left: &str, right: &str) -> Ordering {
    left.to_lowercase()
        .cmp(&right.to_lowercase())
        // Reversed on purpose: byte order puts `A` before `a`, root collation
        // puts `a` before `A`.
        .then_with(|| right.cmp(left))
}

#[cfg(test)]
mod tests {
    use core::cmp::Ordering;

    use serde_json::json;

    use super::{
        FilterConfig, SortConfig, SortDirection, SortField, apply_filter, apply_sort, compare_due,
        compare_titles,
    };
    use crate::domain::{priority::Priority, status::TaskStatus, task::Task};

    fn task(title: &str, mutate: impl FnOnce(&mut Task)) -> Task {
        let mut task: Task = serde_json::from_value(json!({
            "id": format!("Tasks/{title}.md"),
            "title": title,
        }))
        .unwrap();
        mutate(&mut task);
        task
    }

    fn titles(tasks: &[Task]) -> Vec<&str> {
        tasks.iter().map(|task| task.title.as_str()).collect()
    }

    #[test]
    fn an_empty_filter_is_inactive_and_keeps_everything() {
        let filter = FilterConfig::default();
        assert!(!filter.is_active());
        assert_eq!(filter.active_count(), 0);

        let tasks = [task("a", |_| {}), task("b", |_| {})];
        assert_eq!(apply_filter(&tasks, &filter).len(), 2);
    }

    #[test]
    fn counts_each_filtered_dimension_once() {
        let filter = FilterConfig {
            projects: vec!["Work".to_owned()],
            statuses: vec![TaskStatus::Open],
            has_no_due_date: true,
            ..FilterConfig::default()
        };
        assert!(filter.is_active());
        assert_eq!(filter.active_count(), 3);
    }

    #[test]
    fn filters_projects_through_wikilink_equivalence() {
        let tasks = [
            task("linked", |task| {
                task.projects = serde_json::from_value(json!(["[[Areas/Work|Work]]"])).unwrap();
            }),
            task("bare", |task| {
                task.projects = serde_json::from_value(json!(["Home"])).unwrap();
            }),
        ];
        let filter = FilterConfig {
            projects: vec!["work".to_owned()],
            ..FilterConfig::default()
        };
        assert_eq!(titles(&apply_filter(&tasks, &filter)), ["linked"]);
    }

    #[test]
    fn filters_contexts_and_tags_by_exact_match() {
        let tasks = [
            task("home", |task| {
                task.contexts = serde_json::from_value(json!(["home"])).unwrap();
                task.tags = serde_json::from_value(json!(["urgent"])).unwrap();
            }),
            task("office", |task| {
                task.contexts = serde_json::from_value(json!(["office"])).unwrap();
            }),
        ];

        let by_context = FilterConfig {
            contexts: vec!["home".to_owned()],
            ..FilterConfig::default()
        };
        assert_eq!(titles(&apply_filter(&tasks, &by_context)), ["home"]);

        let by_tag = FilterConfig {
            tags: vec!["urgent".to_owned()],
            ..FilterConfig::default()
        };
        assert_eq!(titles(&apply_filter(&tasks, &by_tag)), ["home"]);

        let case_sensitive = FilterConfig {
            contexts: vec!["Home".to_owned()],
            ..FilterConfig::default()
        };
        assert!(apply_filter(&tasks, &case_sensitive).is_empty());
    }

    #[test]
    fn filters_by_status_priority_and_absent_due_date() {
        let tasks = [
            task("dated", |task| {
                task.due = Some("2026-08-08".to_owned());
                task.status = TaskStatus::Done;
                task.priority = Priority::High;
            }),
            task("undated", |_| {}),
        ];

        let undated = FilterConfig {
            has_no_due_date: true,
            ..FilterConfig::default()
        };
        assert_eq!(titles(&apply_filter(&tasks, &undated)), ["undated"]);

        let done = FilterConfig {
            statuses: vec![TaskStatus::Done],
            ..FilterConfig::default()
        };
        assert_eq!(titles(&apply_filter(&tasks, &done)), ["dated"]);

        let high = FilterConfig {
            priorities: vec![Priority::High],
            ..FilterConfig::default()
        };
        assert_eq!(titles(&apply_filter(&tasks, &high)), ["dated"]);
    }

    #[test]
    fn undated_tasks_sort_last_in_both_directions() {
        let tasks = [
            task("undated", |_| {}),
            task("later", |task| task.due = Some("2026-08-09".to_owned())),
            task("sooner", |task| task.due = Some("2026-08-08".to_owned())),
        ];

        let ascending = apply_sort(
            &tasks,
            SortConfig {
                field: SortField::DueDate,
                direction: SortDirection::Asc,
            },
        );
        assert_eq!(titles(&ascending), ["sooner", "later", "undated"]);

        let descending = apply_sort(
            &tasks,
            SortConfig {
                field: SortField::DueDate,
                direction: SortDirection::Desc,
            },
        );
        assert_eq!(titles(&descending), ["later", "sooner", "undated"]);
    }

    #[test]
    fn an_empty_due_string_counts_as_undated() {
        assert_eq!(
            compare_due(Some(""), Some("2026-08-08"), SortDirection::Asc),
            Ordering::Greater
        );
        assert_eq!(
            compare_due(Some(""), None, SortDirection::Asc),
            Ordering::Equal
        );
    }

    #[test]
    fn an_unparseable_due_compares_equal_to_everything_dated() {
        assert_eq!(
            compare_due(Some("someday"), Some("2026-08-08"), SortDirection::Asc),
            Ordering::Equal
        );
        assert_eq!(
            compare_due(Some("someday"), Some("also bad"), SortDirection::Desc),
            Ordering::Equal
        );
        // …but a missing value still loses to it, because the TypeScript
        // comparator checks for a missing value before it does any arithmetic.
        assert_eq!(
            compare_due(None, Some("someday"), SortDirection::Asc),
            Ordering::Greater
        );
    }

    #[test]
    fn dates_and_datetimes_order_against_each_other() {
        assert_eq!(
            compare_due(
                Some("2026-08-08"),
                Some("2026-08-08T00:00:01Z"),
                SortDirection::Asc
            ),
            Ordering::Less
        );
        assert_eq!(
            compare_due(
                Some("2026-08-08T10:00"),
                Some("2026-08-08T09:00:00+00:00"),
                SortDirection::Asc
            ),
            Ordering::Greater
        );
    }

    #[test]
    fn sorts_by_priority_most_urgent_first_when_ascending() {
        let tasks = [
            task("low", |task| task.priority = Priority::Low),
            task("highest", |task| task.priority = Priority::Highest),
            task("normal", |_| {}),
        ];
        let sorted = apply_sort(
            &tasks,
            SortConfig {
                field: SortField::Priority,
                direction: SortDirection::Asc,
            },
        );
        assert_eq!(titles(&sorted), ["highest", "normal", "low"]);
    }

    #[test]
    fn sorts_titles_case_insensitively_with_lowercase_first_on_a_tie() {
        assert_eq!(compare_titles("apple", "Banana"), Ordering::Less);
        assert_eq!(compare_titles("Banana", "apple"), Ordering::Greater);
        assert_eq!(compare_titles("apple", "Apple"), Ordering::Less);
        assert_eq!(compare_titles("apple", "apple"), Ordering::Equal);

        let tasks = [
            task("Banana", |_| {}),
            task("apple", |_| {}),
            task("cherry", |_| {}),
        ];
        let sorted = apply_sort(
            &tasks,
            SortConfig {
                field: SortField::Title,
                direction: SortDirection::Asc,
            },
        );
        assert_eq!(titles(&sorted), ["apple", "Banana", "cherry"]);
    }

    #[test]
    fn sorting_is_stable_so_equal_keys_keep_their_input_order() {
        let tasks = [
            task("first", |_| {}),
            task("second", |_| {}),
            task("third", |_| {}),
        ];
        let sorted = apply_sort(&tasks, SortConfig::default());
        assert_eq!(titles(&sorted), ["first", "second", "third"]);
    }

    #[test]
    fn the_default_sort_is_due_date_ascending() {
        assert_eq!(
            SortConfig::default(),
            SortConfig {
                field: SortField::DueDate,
                direction: SortDirection::Asc,
            }
        );
    }

    #[test]
    fn sort_config_uses_the_typescript_wire_spelling() {
        assert_eq!(
            serde_json::to_value(SortConfig::default()).unwrap(),
            json!({ "field": "dueDate", "direction": "asc" })
        );
    }
}
