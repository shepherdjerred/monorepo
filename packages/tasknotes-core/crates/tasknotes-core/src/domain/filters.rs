//! On-device filtering and sorting of an already-loaded task list.
//!
//! Distinct from [`super::query::TaskQueryFilter`], which is a server request
//! parameter. Everything here is a pure function over a slice, so the same code
//! backs every list screen on every platform — which is the point: two
//! hand-written sorts are how the same query starts returning results in a
//! different order on iOS than on macOS.

use core::cmp::Ordering;

use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime};

use crate::recurrence::Recurrence;

use super::{
    priority::Priority, project::project_matches, status::TaskStatus, task::RecurrenceAnchor,
    task::Task,
};

/// Which key a list is sorted on.
///
/// ⚠️ **Variant order is the FFI discriminant.** New keys are appended, never
/// inserted — the same rule [`super::filters`]'s records live under.
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
    /// By the date the task is actually *about*: its `due`, else its
    /// `scheduled`, else the next occurrence its recurrence rule produces.
    ///
    /// ## Why this exists, and why it is not a nicety
    ///
    /// [`SortField::DueDate`] reads exactly one field, so a task that is
    /// scheduled but not due is "undated" and sorts *after* every dated task —
    /// while the same task's row renders "Today", because a row's badge reads
    /// the effective date and the sort did not. The list then contradicts
    /// itself on screen, which is worse than either ordering alone.
    ///
    /// A `Scheduled` key would only mirror the defect: due-only tasks would
    /// pile up at the bottom instead. The two fields are not two sorts, they
    /// are two sources for one answer, so there is one key that consults both.
    EffectiveDate,
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
///
/// ## Search is a dimension, not a neighbour
///
/// [`FilterConfig::query`] is the seventh dimension rather than a standalone
/// `task_search_matches` composed *beside* the filter, and the reason is the
/// one this whole core exists for. As a dimension there is exactly one
/// predicate, one place that decides membership, and one count behind the
/// `filters (3)` badge; a second client cannot compose "filter" and "search" in
/// a different order, apply one to a list the other already narrowed, or
/// disagree about whether a typed query counts as narrowing. As a neighbour,
/// every one of those is a decision each shell makes for itself — which is
/// exactly how 1Password shipped *"different search results in a different
/// order"*.
///
/// The predicate is *also* exported on its own as [`search_matches`], because a
/// live count or a "does this still belong here?" check genuinely wants it
/// alone — the same reason [`FilterConfig::matches`] is exported beside
/// [`apply_filter`]. That costs nothing here because it is literally the
/// function this struct calls, so the two cannot drift.
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
    /// Keep only tasks matching this free-text query, as [`search_matches`]
    /// reads it. Empty — or whitespace-only — means "not searching".
    ///
    /// A plain `String` rather than an `Option<String>` for the same reason the
    /// five lists above are plain `Vec`s: `None` and `Some("")` would be two
    /// spellings of one state, and a state that can only ever mean one thing is
    /// a state worth deleting.
    ///
    /// ⚠️ **Appended last, on purpose.** UniFFI writes record fields
    /// positionally into the FFI buffer, so inserting this anywhere above would
    /// silently reinterpret every field after it.
    #[serde(default)]
    pub query: String,
}

/// Whether one task matches a free-text query.
///
/// # The exact semantics, because a second client would otherwise guess
///
/// Every line of this is a product decision, and the point of exporting it is
/// that it is decided **once**:
///
/// * **Fields searched: title, projects, contexts, tags.** Not `details`, not
///   the vault path, not the tag's `#` prefix (tags are stored without one).
///   `details` is excluded because it is frequently absent from a list payload,
///   so including it would make a result set depend on how the list was loaded.
/// * **Substring, not prefix and not fuzzy.** Fuzzy matching implies a
///   *ranking*, and a ranking that is not part of the sort is a second, hidden
///   ordering — the precise failure this core exists to prevent.
/// * **Projects are matched raw**, so `Work` finds `[[Areas/Work|Work]]`
///   through either half and `Areas/` is searchable. Deliberately *not*
///   [`super::project_display_name`], which would make the folder half
///   invisible, and deliberately not [`project_matches`] either: that predicate
///   answers "is this the same project", which is the *filter's* question, not
///   a text scan's.
/// * **One phrase, not tokens.** `pay rent` does not match `rent, pay`. Token
///   matching would need a further ruling on whether two terms may match two
///   *different* fields — a task titled `pay` tagged `rent` — and there is no
///   oracle for that anywhere. Phrase matching is what both existing clients do
///   today, and it is the only reading with nothing left to decide.
/// * **An empty or whitespace-only query matches everything.** Here search
///   narrows a list you are already looking at, so an empty box must leave it
///   alone. (The React Native search *screen* shows nothing until you type;
///   that is a screen's empty state, not a predicate.)
///
/// ## Case folding, stated rather than inherited
///
/// Both sides go through Rust's [`str::to_lowercase`]: the **Unicode default,
/// untailored, full lowercase mapping**. Three consequences worth naming, since
/// "whose case folding?" is exactly the question a second implementation would
/// answer differently:
///
/// * It is *lowercasing*, not case **folding** — `Straße` and `STRASSE` do not
///   match each other, because `ß` lowercases to `ß` and never to `ss`.
/// * It is **untailored**, so Turkish `I` lowercases to `i` and never to `ı`.
///   A locale-aware fold would make the same vault answer differently on two
///   machines, which is worse than answering the same way everywhere.
/// * Accents are **not** stripped: `resume` does not find `résumé`. Fixing that
///   needs a collator, which the plan parks along with [`compare_titles`]'s own
///   approximation of `localeCompare`.
///
/// Deterministic and identical on every platform is the property that matters;
/// being maximally clever is not.
#[must_use]
pub fn search_matches(task: &Task, query: &str) -> bool {
    let needle = fold(query.trim());
    if needle.is_empty() {
        return true;
    }
    contains_folded(&task.title, &needle)
        || task
            .projects
            .iter()
            .any(|project| contains_folded(project.as_str(), &needle))
        || task
            .contexts
            .iter()
            .any(|context| contains_folded(context.as_str(), &needle))
        || task
            .tags
            .iter()
            .any(|tag| contains_folded(tag.as_str(), &needle))
}

/// The one case-folding rule, in one place. See [`search_matches`].
fn fold(value: &str) -> String {
    value.to_lowercase()
}

/// Whether `haystack` contains an already-folded needle.
fn contains_folded(haystack: &str, folded_needle: &str) -> bool {
    fold(haystack).contains(folded_needle)
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
    ///
    /// A non-empty [`FilterConfig::query`] counts as one dimension. It hides
    /// tasks exactly as the other six do, and a badge that said `filters (0)`
    /// over a list a search had emptied would be answering the wrong question.
    #[must_use]
    pub fn active_count(&self) -> u32 {
        let dimensions = [
            !self.projects.is_empty(),
            !self.contexts.is_empty(),
            !self.tags.is_empty(),
            !self.statuses.is_empty(),
            !self.priorities.is_empty(),
            self.has_no_due_date,
            !self.query.trim().is_empty(),
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
        if !search_matches(task, &self.query) {
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
///
/// `today` is the viewer's, because only the host knows the device's calendar.
/// It is consulted by exactly one leg of exactly one key: the recurrence
/// fallback of [`SortField::EffectiveDate`]. `None` is therefore not a
/// fallback but a statement of fact — "nobody told this call what day it is" —
/// and it makes that one leg unanswerable, so a task carrying only a recurrence
/// rule sorts as undated. Every other field ignores the argument entirely.
#[must_use]
pub fn apply_sort(tasks: &[Task], sort: SortConfig, today: Option<NaiveDate>) -> Vec<Task> {
    // Decorate-sort-undecorate for the date keys, rather than a comparator:
    // an effective-date key can expand a recurrence rule, and a comparator
    // would expand the same rule O(n log n) times instead of once.
    let Some(source) = date_source(sort.field) else {
        let mut sorted = tasks.to_vec();
        sorted.sort_by(|left, right| compare(left, right, sort, today));
        return sorted;
    };
    let mut decorated: Vec<(DueKey, Task)> = tasks
        .iter()
        .map(|task| (date_key(task, source, today), task.clone()))
        .collect();
    decorated.sort_by(|(left, _), (right, _)| order_keys(*left, *right, sort.direction));
    decorated.into_iter().map(|(_, task)| task).collect()
}

/// Order two tasks under a sort specification.
///
/// See [`apply_sort`] for what `today` is and which key reads it. Prefer
/// [`apply_sort`] for a whole list: this recomputes a task's key on every
/// comparison, which for [`SortField::EffectiveDate`] means reparsing a
/// recurrence rule.
#[must_use]
pub fn compare(left: &Task, right: &Task, sort: SortConfig, today: Option<NaiveDate>) -> Ordering {
    match sort.field {
        SortField::DueDate => compare_keys(left, right, DateSource::Due, sort.direction, today),
        SortField::EffectiveDate => {
            compare_keys(left, right, DateSource::Effective, sort.direction, today)
        }
        SortField::Priority => sort.direction.orient(left.priority.cmp(&right.priority)),
        SortField::Title => sort
            .direction
            .orient(compare_titles(&left.title, &right.title)),
    }
}

/// Which of a task's dates a date-ordered key reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DateSource {
    /// `due` alone.
    Due,
    /// `due`, else `scheduled`, else the recurrence rule's next occurrence.
    Effective,
}

/// The date source a sort field reads, or `None` when it does not order on a
/// date at all.
const fn date_source(field: SortField) -> Option<DateSource> {
    match field {
        SortField::DueDate => Some(DateSource::Due),
        SortField::EffectiveDate => Some(DateSource::Effective),
        SortField::Priority | SortField::Title => None,
    }
}

/// One task's ordering key under a date source.
fn date_key(task: &Task, source: DateSource, today: Option<NaiveDate>) -> DueKey {
    match source {
        DateSource::Due => due_key(task.due.as_deref()),
        DateSource::Effective => effective_date_key(task, today),
    }
}

/// Order two tasks on their date keys under one source.
fn compare_keys(
    left: &Task,
    right: &Task,
    source: DateSource,
    direction: SortDirection,
    today: Option<NaiveDate>,
) -> Ordering {
    order_keys(
        date_key(left, source, today),
        date_key(right, source, today),
        direction,
    )
}

/// `due`, else `scheduled`, else the rule's next open occurrence.
///
/// **First *present*, not first *parseable*.** A `due` of `someday` yields
/// [`DueKey::Unparseable`] and stops there rather than falling through to
/// `scheduled`: the user did write a due value, and quietly ordering by a
/// different field because this one was unreadable would hide the problem
/// instead of showing it. [`DueKey::Unparseable`] already has a defined
/// meaning — compares equal to everything, so a stable sort leaves the row
/// where it was — and that is the honest answer here too.
///
/// A task with **no due date, no scheduled date and no rule** is
/// [`DueKey::Missing`], which sorts last in both directions exactly as an
/// undated task does under [`SortField::DueDate`]. So does a task whose rule
/// has no further open occurrence, and a task with a rule when `today` was not
/// supplied.
fn effective_date_key(task: &Task, today: Option<NaiveDate>) -> DueKey {
    for value in [task.due.as_deref(), task.scheduled.as_deref()] {
        match due_key(value) {
            DueKey::Missing => {}
            present => return present,
        }
    }
    recurrence_key(task, today)
}

/// The key a task's recurrence rule contributes, when it has one.
///
/// Uses the same `next_uncompleted_occurrence` the row badge uses, with the
/// task's own anchor and its own completed and skipped lists — so the date the
/// list sorts on and the date the row displays are produced by one function
/// rather than two that agree by luck.
fn recurrence_key(task: &Task, today: Option<NaiveDate>) -> DueKey {
    let (Some(rule), Some(today)) = (task.recurrence.as_deref(), today) else {
        return DueKey::Missing;
    };
    if rule.is_empty() {
        return DueKey::Missing;
    }
    // A stored instance that is not a rendered date can never equal one, so
    // dropping it is provably the same computation the reference performs —
    // the same reasoning the FFI's occurrence exports are written under.
    let dates = |values: &[String]| -> Vec<NaiveDate> {
        values
            .iter()
            .filter_map(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
            .collect()
    };
    Recurrence::parse(
        rule,
        task.scheduled.as_deref(),
        task.date_created.as_deref(),
    )
    .next_uncompleted_occurrence(
        today,
        task.recurrence_anchor
            .unwrap_or(RecurrenceAnchor::Scheduled),
        &dates(&task.complete_instances),
        &dates(&task.skipped_instances),
    )
    .map_or(DueKey::Missing, |date| {
        DueKey::At(date.and_time(NaiveTime::MIN).and_utc().timestamp_millis())
    })
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
#[cfg(test)]
fn compare_due(left: Option<&str>, right: Option<&str>, direction: SortDirection) -> Ordering {
    order_keys(due_key(left), due_key(right), direction)
}

/// Order two already-classified date keys.
fn order_keys(left: DueKey, right: DueKey, direction: SortDirection) -> Ordering {
    match (left, right) {
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

    use chrono::NaiveDate;

    use super::{
        FilterConfig, SortConfig, SortDirection, SortField, apply_filter, apply_sort, compare_due,
        compare_titles, search_matches,
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

    /// A Monday, used as both "today" and as a `DTSTART` anchor.
    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 8, 3).unwrap()
    }

    /// Sort without telling the core what day it is — every field but
    /// [`SortField::EffectiveDate`] ignores the argument entirely.
    fn sorted_undated(tasks: &[Task], sort: SortConfig) -> Vec<Task> {
        apply_sort(tasks, sort, None)
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

        let ascending = sorted_undated(
            &tasks,
            SortConfig {
                field: SortField::DueDate,
                direction: SortDirection::Asc,
            },
        );
        assert_eq!(titles(&ascending), ["sooner", "later", "undated"]);

        let descending = sorted_undated(
            &tasks,
            SortConfig {
                field: SortField::DueDate,
                direction: SortDirection::Desc,
            },
        );
        assert_eq!(titles(&descending), ["later", "sooner", "undated"]);
    }

    // ── Search ─────────────────────────────────────────────────────────────

    #[test]
    fn search_scans_the_title_projects_contexts_and_tags() {
        let subject = task("Pay the rent", |task| {
            task.projects = serde_json::from_value(json!(["[[Areas/Home|Home]]"])).unwrap();
            task.contexts = serde_json::from_value(json!(["errands"])).unwrap();
            task.tags = serde_json::from_value(json!(["finance"])).unwrap();
            task.details = Some("transfer from the joint account".to_owned());
        });

        assert!(search_matches(&subject, "rent"), "title");
        assert!(search_matches(&subject, "errand"), "context");
        assert!(search_matches(&subject, "financ"), "tag");
        // Raw project matching: both halves of the wikilink are searchable, so
        // the folder is reachable and the display name is too.
        assert!(search_matches(&subject, "Areas/"), "project path half");
        assert!(search_matches(&subject, "home"), "project display half");
        // `details` is deliberately out of scope: it is often absent from a
        // list payload, so including it would make results depend on how the
        // list was loaded.
        assert!(!search_matches(&subject, "joint account"));
        assert!(!search_matches(&subject, "mortgage"));
    }

    #[test]
    fn search_is_a_substring_scan_not_a_prefix_and_not_a_token_set() {
        let subject = task("Pay the rent", |_| {});
        // Substring, anywhere.
        assert!(search_matches(&subject, "he re"));
        // One phrase: the words are not reordered, and reordering them is a
        // miss rather than a fuzzy hit.
        assert!(!search_matches(&subject, "rent pay"));
    }

    #[test]
    fn search_folds_case_without_reaching_for_a_locale() {
        let subject = task("Straße Ärger ΣΊΣΥΦΟΣ", |_| {});
        assert!(
            !search_matches(&subject, "STRASSE"),
            "ß lowercases to ß, not to ss"
        );
        assert!(search_matches(&subject, "ärger"), "non-ASCII lowercases");
        assert!(search_matches(&subject, "ÄRGER"), "…in both directions");
        // Turkish `I` folds to ASCII `i`, never to `ı`: untailored on purpose,
        // so one vault reads the same on every machine.
        let dotted = task("TITLE", |_| {});
        assert!(search_matches(&dotted, "title"));
    }

    #[test]
    fn an_empty_or_blank_query_matches_everything_and_counts_as_no_filter() {
        let subject = task("anything", |_| {});
        assert!(search_matches(&subject, ""));
        assert!(search_matches(&subject, "   \t "));

        let blank = FilterConfig {
            query: "   ".to_owned(),
            ..FilterConfig::default()
        };
        assert!(!blank.is_active());
        assert_eq!(blank.active_count(), 0);
        assert!(blank.matches(&subject));
    }

    #[test]
    fn a_query_is_a_filter_dimension_and_composes_with_the_others() {
        let tasks = [
            task("Pay the rent", |task| {
                task.status = TaskStatus::Open;
            }),
            task("Pay the phone bill", |task| {
                task.status = TaskStatus::Done;
            }),
            task("Water the plants", |_| {}),
        ];

        let searching = FilterConfig {
            query: "  PAY  ".to_owned(),
            ..FilterConfig::default()
        };
        assert!(searching.is_active());
        assert_eq!(
            searching.active_count(),
            1,
            "a search hides tasks exactly as the other six dimensions do"
        );
        assert_eq!(
            titles(&apply_filter(&tasks, &searching)),
            ["Pay the rent", "Pay the phone bill"],
            "and the trimmed query is what is matched"
        );

        let both = FilterConfig {
            query: "pay".to_owned(),
            statuses: vec![TaskStatus::Done],
            ..FilterConfig::default()
        };
        assert_eq!(both.active_count(), 2);
        assert_eq!(titles(&apply_filter(&tasks, &both)), ["Pay the phone bill"]);
    }

    #[test]
    fn a_filter_dimension_and_a_search_read_projects_differently_on_purpose() {
        let tasks = [task("linked", |task| {
            task.projects = serde_json::from_value(json!(["[[Areas/Work|Work]]"])).unwrap();
        })];

        // The filter asks "is this the same project", so a bare name matches
        // the wikilink…
        let filtered = FilterConfig {
            projects: vec!["Work".to_owned()],
            ..FilterConfig::default()
        };
        assert_eq!(titles(&apply_filter(&tasks, &filtered)), ["linked"]);

        // …while the search is a text scan, so a fragment of the path matches
        // and the filter's equivalence does not apply.
        let searched = FilterConfig {
            query: "areas".to_owned(),
            ..FilterConfig::default()
        };
        assert_eq!(titles(&apply_filter(&tasks, &searched)), ["linked"]);
    }

    // ── Effective-date sorting ─────────────────────────────────────────────

    #[test]
    fn the_effective_date_reads_due_then_scheduled_then_the_rule() {
        let sort = SortConfig {
            field: SortField::EffectiveDate,
            direction: SortDirection::Asc,
        };
        let tasks = [
            task("nothing at all", |_| {}),
            task("due later", |task| task.due = Some("2026-08-31".to_owned())),
            task("recurring weekly", |task| {
                // No due, no scheduled: the only date is the rule's, anchored
                // to `dateCreated`. It falls on the 5th, a Wednesday.
                task.recurrence = Some("FREQ=WEEKLY;BYDAY=WE".to_owned());
                task.date_created = Some("2026-07-29".to_owned());
            }),
            task("scheduled today", |task| {
                task.scheduled = Some("2026-08-03".to_owned());
                task.recurrence = Some("FREQ=DAILY".to_owned());
            }),
        ];

        assert_eq!(
            titles(&apply_sort(&tasks, sort, Some(today()))),
            [
                "scheduled today",
                "recurring weekly",
                "due later",
                "nothing at all"
            ]
        );

        // The defect this key exists for: under `DueDate` the scheduled and
        // recurring rows are "undated" and land *after* the 31st, while their
        // own rows render "Today".
        assert_eq!(
            titles(&sorted_undated(
                &tasks,
                SortConfig {
                    field: SortField::DueDate,
                    direction: SortDirection::Asc,
                }
            )),
            [
                "due later",
                "nothing at all",
                "recurring weekly",
                "scheduled today"
            ]
        );
    }

    #[test]
    fn a_task_with_no_date_and_no_rule_sorts_last_in_both_directions() {
        let tasks = [
            task("nothing at all", |_| {}),
            task("scheduled", |task| {
                task.scheduled = Some("2026-08-10".to_owned());
            }),
            task("due", |task| task.due = Some("2026-08-05".to_owned())),
        ];
        for direction in [SortDirection::Asc, SortDirection::Desc] {
            let sorted = apply_sort(
                &tasks,
                SortConfig {
                    field: SortField::EffectiveDate,
                    direction,
                },
                Some(today()),
            );
            assert_eq!(
                titles(&sorted).last().copied(),
                Some("nothing at all"),
                "{direction:?}"
            );
        }
    }

    #[test]
    fn the_effective_date_takes_the_first_present_value_not_the_first_readable_one() {
        let tasks = [
            task("unreadable due", |task| {
                task.due = Some("someday".to_owned());
                task.scheduled = Some("2026-08-04".to_owned());
            }),
            task("readable", |task| task.due = Some("2026-08-05".to_owned())),
        ];
        // An unparseable value compares equal to everything, so a stable sort
        // leaves it in place rather than quietly ordering by `scheduled`.
        assert_eq!(
            titles(&apply_sort(
                &tasks,
                SortConfig {
                    field: SortField::EffectiveDate,
                    direction: SortDirection::Asc,
                },
                Some(today())
            )),
            ["unreadable due", "readable"]
        );
    }

    #[test]
    fn the_recurrence_leg_honours_completed_instances_and_needs_a_today() {
        let recurring = |title: &str, complete: &[&str]| {
            task(title, |task| {
                task.recurrence = Some("FREQ=WEEKLY;BYDAY=MO".to_owned());
                task.scheduled = None;
                task.date_created = Some("2026-08-03".to_owned());
                task.complete_instances = complete.iter().map(|date| (*date).to_owned()).collect();
            })
        };
        let tasks = [
            // This Monday is already done, so the next open occurrence is the
            // 10th — after the task due on the 5th.
            recurring("done this week", &["2026-08-03"]),
            task("due", |task| task.due = Some("2026-08-05".to_owned())),
            recurring("still open", &[]),
        ];
        let sort = SortConfig {
            field: SortField::EffectiveDate,
            direction: SortDirection::Asc,
        };
        assert_eq!(
            titles(&apply_sort(&tasks, sort, Some(today()))),
            ["still open", "due", "done this week"]
        );

        // Without a `today` the recurrence leg is not a question the core can
        // answer, so a rule-only task sorts as undated rather than guessing.
        assert_eq!(
            titles(&apply_sort(&tasks, sort, None)),
            ["due", "done this week", "still open"]
        );
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
        let sorted = sorted_undated(
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
        let sorted = sorted_undated(
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
        let sorted = sorted_undated(&tasks, SortConfig::default());
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
