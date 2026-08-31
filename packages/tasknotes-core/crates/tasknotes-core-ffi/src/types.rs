//! The exported shape of every core type that UniFFI can express directly.
//!
//! # This file is the ABI
//!
//! `#[uniffi::remote(...)]` re-states a type that lives in `tasknotes-core` and
//! generates the FFI converters for it *without* redefining the type. The
//! declaration below therefore has to match the core declaration exactly: a
//! renamed field, a changed type, an added or removed field, or a new enum
//! variant all fail to compile here.
//!
//! Two consequences worth stating plainly:
//!
//! * **Field order is positional in the FFI buffer.** Swapping two same-typed
//!   fields is a silent data-corruption bug that leaves every API checksum and
//!   the whole generated C header byte-identical — measured, during the Phase 6
//!   spike. `cargo xtask check-bindings` is the only mechanical guard.
//! * **Enum variant order is the discriminant**, with exactly the same
//!   consequence. [`Priority`]'s order additionally *is* the sort order, so
//!   reordering it changes how every list is sorted as well as breaking the ABI.
//!
//! The order used here is the core's declaration order in every case, so there
//! is one canonical answer rather than two.
//!
//! [`Priority`]: tasknotes_core::domain::Priority

use chrono::Weekday;
use tasknotes_core::{
    dates::{DateGroup, UpcomingHorizon},
    domain::{
        BlockedByEntry, CalendarEvent, ContextName, CreateTaskRequest, ExtraFields, FilterChain,
        FilterConfig, FilterOptions, HealthState, HealthStatus, InlineTimeEntry, NlpParseResult,
        Pagination, PomodoroPhase, PomodoroStatus, Priority, ProjectName, QueryResponse,
        RecurrenceAnchor, Reminder, ReminderKind, SortConfig, SortDirection, SortField, TagName,
        Task, TaskId, TaskList, TaskQueryFilter, TaskStats, TaskStatus, TaskTime, TaskTitle,
        TimeEntry, TimeSummary, TopTask, VaultInfo,
    },
    net::{InstanceCompletion, InstanceRestore},
    recurrence::{
        CommonRecurrenceDraft, CommonRecurrenceEnd, CommonRecurrencePattern, CommonWeekday,
        Frequency, MonthlyOrdinal,
    },
    sync::{DeadLetterError, SyncState},
};

// ── Enums ──────────────────────────────────────────────────────────────────

/// See [`tasknotes_core::domain::TaskStatus`].
#[uniffi::remote(Enum)]
pub enum TaskStatus {
    /// Not started.
    Open,
    /// Started but not finished.
    InProgress,
    /// Finished.
    Done,
    /// Abandoned; counts as completed for filtering purposes.
    Cancelled,
    /// Blocked on something outside the vault.
    Waiting,
    /// Handed to someone else.
    Delegated,
}

/// See [`tasknotes_core::domain::Priority`]. The order is also the sort order.
#[uniffi::remote(Enum)]
pub enum Priority {
    /// P1 — the most urgent.
    Highest,
    /// P2.
    High,
    /// P3.
    Medium,
    /// The default for a task that never had a priority set.
    Normal,
    /// P4.
    Low,
    /// Explicitly deprioritized.
    None,
}

/// See [`tasknotes_core::domain::RecurrenceAnchor`].
#[uniffi::remote(Enum)]
pub enum RecurrenceAnchor {
    /// Measured from the scheduled date.
    Scheduled,
    /// Measured from the completion date.
    Completion,
}

/// See [`tasknotes_core::domain::ReminderKind`].
#[uniffi::remote(Enum)]
pub enum ReminderKind {
    /// An offset from another of the task's dates.
    Relative,
    /// A fixed instant.
    Absolute,
}

/// See [`tasknotes_core::domain::SortField`].
///
/// ⚠️ `EffectiveDate` is **appended**, so the first three discriminants are
/// unchanged. Inserting it would have renumbered them and silently reinterpreted
/// every persisted or in-flight sort.
#[uniffi::remote(Enum)]
pub enum SortField {
    /// By due date, with undated tasks always last.
    DueDate,
    /// By priority, most urgent first when ascending.
    Priority,
    /// By title.
    Title,
    /// By `due`, else `scheduled`, else the recurrence rule's next occurrence.
    EffectiveDate,
}

/// See [`tasknotes_core::domain::SortDirection`].
#[uniffi::remote(Enum)]
pub enum SortDirection {
    /// Smallest first.
    Asc,
    /// Largest first.
    Desc,
}

/// See [`tasknotes_core::domain::PomodoroPhase`].
#[uniffi::remote(Enum)]
pub enum PomodoroPhase {
    /// A focus interval.
    Work,
    /// A rest interval.
    Break,
}

/// See [`tasknotes_core::domain::HealthState`].
#[uniffi::remote(Enum)]
pub enum HealthState {
    /// Serving normally.
    Ok,
    /// Degraded or failing.
    Error,
}

// ── Task records ───────────────────────────────────────────────────────────

/// See [`tasknotes_core::domain::Reminder`].
#[uniffi::remote(Record)]
pub struct Reminder {
    /// Whether `offset` or `absolute_time` applies.
    pub kind: ReminderKind,
    /// An ISO 8601 duration, for a relative reminder.
    pub offset: Option<String>,
    /// Which of the task's dates the offset is measured from.
    pub related_to: Option<String>,
    /// A fixed instant, for an absolute reminder.
    pub absolute_time: Option<String>,
}

/// See [`tasknotes_core::domain::BlockedByEntry`].
#[uniffi::remote(Record)]
pub struct BlockedByEntry {
    /// The blocking task's identifier, as upstream spells it.
    pub uid: String,
    /// The iCalendar relationship type.
    pub reltype: Option<String>,
    /// The required gap between the blocker and this task.
    pub gap: Option<String>,
}

/// See [`tasknotes_core::domain::InlineTimeEntry`].
#[uniffi::remote(Record)]
pub struct InlineTimeEntry {
    /// When tracking started.
    pub start_time: String,
    /// When tracking stopped; absent while a session is running.
    pub end_time: Option<String>,
    /// The interval's length in whole minutes.
    pub duration: Option<u32>,
}

/// See [`tasknotes_core::domain::Task`].
///
/// The largest record on the boundary, and the one where field order matters
/// most. It follows the core declaration order, which follows the TypeScript
/// `TaskSchema` declaration order.
#[uniffi::remote(Record)]
pub struct Task {
    /// The task's identity — its vault path, or a temp id.
    pub id: TaskId,
    /// The vault-relative markdown path; empty for a queued create.
    pub path: String,
    /// The task's title.
    pub title: String,
    /// Where the task is in the workflow.
    pub status: TaskStatus,
    /// How urgent the task is.
    pub priority: Priority,
    /// When the task is due.
    pub due: Option<String>,
    /// When the task is planned to be worked on.
    pub scheduled: Option<String>,
    /// The contexts the task is available in.
    pub contexts: Vec<ContextName>,
    /// The projects the task belongs to.
    pub projects: Vec<ProjectName>,
    /// The task's tags.
    pub tags: Vec<TagName>,
    /// The RFC 5545 recurrence rule, if the task repeats.
    pub recurrence: Option<String>,
    /// What the recurrence is measured from.
    pub recurrence_anchor: Option<RecurrenceAnchor>,
    /// Dates whose occurrence has been completed, as `YYYY-MM-DD`.
    pub complete_instances: Vec<String>,
    /// Dates whose occurrence has been skipped, as `YYYY-MM-DD`.
    pub skipped_instances: Vec<String>,
    /// When the task was completed.
    pub completed_date: Option<String>,
    /// When the note was created.
    pub date_created: Option<String>,
    /// When the note was last modified.
    pub date_modified: Option<String>,
    /// The estimate in whole minutes.
    pub time_estimate: Option<u32>,
    /// Tracked work intervals stored in the note's frontmatter.
    pub time_entries: Vec<InlineTimeEntry>,
    /// Tasks this one is blocked by.
    pub blocked_by: Vec<BlockedByEntry>,
    /// Reminders attached to the task.
    pub reminders: Vec<Reminder>,
    /// Whether the task is archived.
    pub archived: bool,
    /// Total tracked time in whole minutes, as the server computed it.
    pub total_tracked_time: u32,
    /// Whether something else is blocking this task.
    pub is_blocked: bool,
    /// Whether this task blocks something else.
    pub is_blocking: bool,
    /// Frontmatter keys the client does not model, as a JSON object string.
    pub extra_fields: ExtraFields,
    /// The note body below the frontmatter.
    pub details: Option<String>,
}

/// See [`tasknotes_core::domain::CreateTaskRequest`].
///
/// A create has nothing to clear, so every field is a plain optional rather
/// than one of the three-state [`crate::update::TextUpdate`] enums.
#[uniffi::remote(Record)]
pub struct CreateTaskRequest {
    /// The new task's title.
    pub title: TaskTitle,
    /// The note body.
    pub details: Option<String>,
    /// The initial status; the server defaults to `open`.
    pub status: Option<TaskStatus>,
    /// The initial priority; the server defaults to `normal`.
    pub priority: Option<Priority>,
    /// When the task is due.
    pub due: Option<String>,
    /// When the task is planned to be worked on.
    pub scheduled: Option<String>,
    /// The contexts the task is available in.
    pub contexts: Option<Vec<ContextName>>,
    /// The projects the task belongs to.
    pub projects: Option<Vec<ProjectName>>,
    /// The task's tags.
    pub tags: Option<Vec<TagName>>,
    /// The RFC 5545 recurrence rule.
    pub recurrence: Option<String>,
    /// What the recurrence is measured from.
    pub recurrence_anchor: Option<RecurrenceAnchor>,
    /// The estimate in whole minutes.
    pub time_estimate: Option<u32>,
    /// Extra frontmatter keys to write, as a JSON object string.
    pub extra_fields: Option<ExtraFields>,
}

// ── Query and filter records ───────────────────────────────────────────────

/// See [`tasknotes_core::domain::TaskQueryFilter`].
#[uniffi::remote(Record)]
pub struct TaskQueryFilter {
    /// Restrict to these statuses.
    pub status: Option<Vec<TaskStatus>>,
    /// Restrict to these priorities.
    pub priority: Option<Vec<Priority>>,
    /// Restrict to these projects.
    pub projects: Option<Vec<String>>,
    /// Restrict to these contexts.
    pub contexts: Option<Vec<String>>,
    /// Restrict to these tags.
    pub tags: Option<Vec<String>>,
    /// Only tasks due strictly before this date.
    pub due_before: Option<String>,
    /// Only tasks due strictly after this date.
    pub due_after: Option<String>,
    /// Only tasks with no due date at all.
    pub has_no_due_date: Option<bool>,
    /// Only tasks belonging to no project.
    pub has_no_project: Option<bool>,
    /// Full-text search over titles.
    pub search: Option<String>,
}

/// See [`tasknotes_core::domain::FilterOptions`].
#[uniffi::remote(Record)]
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

/// See [`tasknotes_core::domain::FilterConfig`].
///
/// ⚠️ `query` is **appended**. A `Record` field is positional in the FFI
/// buffer, so inserting a seventh dimension anywhere above would have
/// reinterpreted every field after it — with no checksum change and no header
/// change to notice it by.
#[uniffi::remote(Record)]
pub struct FilterConfig {
    /// Keep tasks in any of these projects, matched by wikilink equivalence.
    pub projects: Vec<String>,
    /// Keep tasks in any of these contexts, matched exactly.
    pub contexts: Vec<String>,
    /// Keep tasks with any of these tags, matched exactly.
    pub tags: Vec<String>,
    /// Keep tasks in any of these statuses.
    pub statuses: Vec<TaskStatus>,
    /// Keep tasks at any of these priorities.
    pub priorities: Vec<Priority>,
    /// Keep only tasks with no due date.
    pub has_no_due_date: bool,
    /// Keep only tasks matching this free-text query; empty means not
    /// searching.
    ///
    /// Defaulted so an unfiltered `FilterConfig` stays writable without
    /// restating it, and so adding the dimension did not break every existing
    /// construction site.
    #[uniffi(default = "")]
    pub query: String,
}

/// See [`tasknotes_core::domain::FilterChain`].
///
/// A conjunction: a task belongs when it passes **every** member. Appended
/// after [`FilterConfig`] rather than replacing it, because the two answer
/// different questions — one narrowing versus a stack of them.
#[uniffi::remote(Record)]
pub struct FilterChain {
    /// The filters, all of which must pass. Empty admits everything.
    #[uniffi(default = [])]
    pub filters: Vec<FilterConfig>,
}

/// See [`tasknotes_core::domain::SortConfig`].
#[uniffi::remote(Record)]
pub struct SortConfig {
    /// The key to sort on.
    pub field: SortField,
    /// Which way round.
    pub direction: SortDirection,
}

// ── Read-only report records ───────────────────────────────────────────────

/// See [`tasknotes_core::domain::VaultInfo`].
#[uniffi::remote(Record)]
pub struct VaultInfo {
    /// The vault's display name.
    pub name: String,
    /// The vault's absolute path, when the server discloses it.
    pub path: Option<String>,
}

/// See [`tasknotes_core::domain::Pagination`].
#[uniffi::remote(Record)]
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

/// See [`tasknotes_core::domain::TaskList`].
#[uniffi::remote(Record)]
pub struct TaskList {
    /// This page's tasks, in the server's order.
    pub tasks: Vec<Task>,
    /// Where this page sits.
    pub pagination: Pagination,
    /// Which vault answered.
    pub vault: Option<VaultInfo>,
    /// A human-readable remark from the server.
    pub note: Option<String>,
}

/// See [`tasknotes_core::domain::QueryResponse`].
#[uniffi::remote(Record)]
pub struct QueryResponse {
    /// The matching tasks, in the server's order.
    pub tasks: Vec<Task>,
    /// How many tasks exist before filtering.
    pub total: u32,
    /// How many survived the filter.
    pub filtered: u32,
    /// Which vault answered.
    pub vault: Option<VaultInfo>,
}

/// See [`tasknotes_core::domain::TaskStats`].
#[uniffi::remote(Record)]
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
    /// Tasks with at least one tracked interval.
    pub with_time_tracking: u32,
}

/// See [`tasknotes_core::domain::NlpParseResult`].
#[uniffi::remote(Record)]
pub struct NlpParseResult {
    /// The title left after the recognised tokens were removed.
    pub title: String,
    /// The due date, if one was recognised.
    pub due: Option<String>,
    /// The priority, if one was recognised.
    pub priority: Option<Priority>,
    /// The projects, if any were recognised.
    pub projects: Option<Vec<String>>,
    /// The contexts, if any were recognised.
    pub contexts: Option<Vec<String>>,
    /// The tags, if any were recognised.
    pub tags: Option<Vec<String>>,
    /// The recurrence rule, if one was recognised.
    pub recurrence: Option<String>,
}

/// See [`tasknotes_core::domain::PomodoroStatus`].
#[uniffi::remote(Record)]
pub struct PomodoroStatus {
    /// Whether a session is running.
    pub active: bool,
    /// The task being worked on.
    pub task_id: Option<TaskId>,
    /// Seconds left in the current phase.
    pub time_remaining: Option<u32>,
    /// Which phase is running.
    pub phase: Option<PomodoroPhase>,
}

/// See [`tasknotes_core::domain::CalendarEvent`].
#[uniffi::remote(Record)]
pub struct CalendarEvent {
    /// The event's identifier.
    pub id: String,
    /// The event's title.
    pub title: String,
    /// The event's date.
    pub date: String,
    /// The task the event came from, when it came from one.
    pub task_id: Option<TaskId>,
}

/// See [`tasknotes_core::domain::HealthStatus`].
#[uniffi::remote(Record)]
pub struct HealthStatus {
    /// Whether the server considers itself healthy.
    pub status: HealthState,
    /// The server's version string.
    pub version: Option<String>,
    /// How long the server has been up, in seconds.
    pub uptime: Option<u64>,
    /// Whether the request was authenticated.
    pub authenticated: Option<bool>,
}

/// See [`tasknotes_core::domain::TimeEntry`].
#[uniffi::remote(Record)]
pub struct TimeEntry {
    /// The task the interval belongs to.
    pub task_id: TaskId,
    /// When tracking started.
    pub start_time: String,
    /// When tracking stopped; absent while a session is running.
    pub end_time: Option<String>,
    /// The interval's length in whole minutes.
    pub duration: Option<u32>,
}

/// See [`tasknotes_core::domain::TopTask`].
#[uniffi::remote(Record)]
pub struct TopTask {
    /// The task.
    pub task_id: TaskId,
    /// Its title.
    pub title: String,
    /// Whole minutes tracked against it.
    pub minutes: u32,
}

/// See [`tasknotes_core::domain::TimeSummary`].
#[uniffi::remote(Record)]
pub struct TimeSummary {
    /// Whole minutes tracked across everything in scope.
    pub total_time: u32,
    /// The busiest tasks, in the server's order.
    pub top_tasks: Vec<TopTask>,
}

/// See [`tasknotes_core::domain::TaskTime`].
#[uniffi::remote(Record)]
pub struct TaskTime {
    /// Whole minutes tracked against one task.
    pub total_time: u32,
    /// Whether a session is running right now.
    pub has_active_session: bool,
}

// ── Sync stack ─────────────────────────────────────────────────────────────
//
// Only the pieces UniFFI can express verbatim live here. `Command`,
// `CommandInput` and `DeadLetterEntry` carry an `UpdateTaskRequest`, which is
// generic in the core and therefore mirrored in [`crate::command`];
// `TaskStoreSnapshot` and `SyncStatus` carry `IndexMap`/`IndexSet`/`Error` and
// are projected in [`crate::engine`].

/// See [`tasknotes_core::sync::SyncState`].
#[uniffi::remote(Enum)]
pub enum SyncState {
    /// Nothing to do; the last pass succeeded.
    Idle,
    /// A pass is running.
    Syncing,
    /// The last pass failed transiently and a retry is armed.
    Backoff,
    /// The server rejected the credentials, and **no retry is armed**.
    AuthError,
    /// No API client is configured yet.
    Unconfigured,
}

/// See [`tasknotes_core::net::InstanceCompletion`].
#[uniffi::remote(Record)]
pub struct InstanceCompletion {
    /// The occurrence's date, as `YYYY-MM-DD`.
    pub date: String,
    /// The state to set it to.
    pub completed: bool,
    /// The schedule to put back, on an uncompletion.
    pub restore: Option<InstanceRestore>,
}

/// See [`tasknotes_core::net::InstanceRestore`].
#[uniffi::remote(Record)]
pub struct InstanceRestore {
    /// The `scheduled` date before completion advanced it.
    pub scheduled: Option<String>,
    /// The `due` date before completion advanced it.
    pub due: Option<String>,
    /// The recurrence rule before completion.
    pub recurrence: String,
    /// Whether the occurrence was skipped before completion.
    pub skipped: bool,
}

/// See [`tasknotes_core::sync::DeadLetterError`].
///
/// The field is `name`, not `kind`: the on-disk dead-letter format stores the
/// TypeScript `Error.name` string so a queue written by either client stays
/// readable by the other. Nothing branches on it.
#[uniffi::remote(Record)]
pub struct DeadLetterError {
    /// The failing error's class name.
    pub name: String,
    /// The human-readable message.
    pub message: String,
    /// The HTTP status, present only for the two variants that carry one.
    pub status: Option<u16>,
}

// ── Recurrence ─────────────────────────────────────────────────────────────

/// See [`tasknotes_core::recurrence::Frequency`].
#[uniffi::remote(Enum)]
pub enum Frequency {
    /// Once a year.
    Yearly,
    /// Once a month.
    Monthly,
    /// Once a week.
    Weekly,
    /// Once a day.
    Daily,
    /// Once an hour.
    Hourly,
    /// Once a minute.
    Minutely,
    /// Once a second.
    Secondly,
}

/// See [`tasknotes_core::recurrence::CommonWeekday`].
#[uniffi::remote(Enum)]
pub enum CommonWeekday {
    /// Monday.
    Monday,
    /// Tuesday.
    Tuesday,
    /// Wednesday.
    Wednesday,
    /// Thursday.
    Thursday,
    /// Friday.
    Friday,
    /// Saturday.
    Saturday,
    /// Sunday.
    Sunday,
}

/// See [`tasknotes_core::recurrence::MonthlyOrdinal`].
#[uniffi::remote(Enum)]
pub enum MonthlyOrdinal {
    /// The first occurrence.
    First,
    /// The second occurrence.
    Second,
    /// The third occurrence.
    Third,
    /// The fourth occurrence.
    Fourth,
    /// The fifth occurrence.
    Fifth,
    /// The final occurrence.
    Last,
}

/// See [`tasknotes_core::recurrence::CommonRecurrencePattern`].
#[uniffi::remote(Enum)]
pub enum CommonRecurrencePattern {
    /// Every N days.
    Daily,
    /// Every N weeks on selected weekdays.
    Weekly { weekdays: Vec<CommonWeekday> },
    /// Every N months on a numbered day.
    MonthlyDayOfMonth { day: u8 },
    /// Every N months on an ordinal weekday.
    MonthlyOrdinalWeekday {
        ordinal: MonthlyOrdinal,
        weekday: CommonWeekday,
    },
    /// Every N years on a month and day.
    YearlyMonthDay { month: u8, day: u8 },
}

/// See [`tasknotes_core::recurrence::CommonRecurrenceEnd`].
#[uniffi::remote(Enum)]
pub enum CommonRecurrenceEnd {
    /// It has no declared end.
    Never,
    /// It ends on an inclusive ISO date.
    OnDate(String),
    /// It ends after a number of total occurrences.
    AfterOccurrences(u32),
}

/// See [`tasknotes_core::recurrence::CommonRecurrenceDraft`].
#[uniffi::remote(Record)]
pub struct CommonRecurrenceDraft {
    /// A strictly positive interval.
    pub interval: u32,
    /// The calendar pattern.
    pub pattern: CommonRecurrencePattern,
    /// The stopping condition.
    pub ending: CommonRecurrenceEnd,
}

// ── Date helpers ───────────────────────────────────────────────────────────

/// See [`tasknotes_core::dates::UpcomingHorizon`].
#[uniffi::remote(Enum)]
pub enum UpcomingHorizon {
    /// Anything strictly after today and no more than this many days out.
    Days(u32),
    /// Anything strictly after today, however far out.
    Unbounded,
}

/// See [`tasknotes_core::dates::DateGroup`].
#[uniffi::remote(Enum)]
pub enum DateGroup {
    /// Strictly before the viewer's today.
    Overdue,
    /// The viewer's today.
    Today,
    /// The day after the viewer's today.
    Tomorrow,
    /// Later than tomorrow, but no later than the coming Sunday.
    ThisWeek,
    /// Beyond the current week; the shell formats the heading itself.
    Later,
}

/// See [`chrono::Weekday`]. Monday first, matching chrono's declaration order.
#[uniffi::remote(Enum)]
pub enum Weekday {
    /// Monday.
    Mon,
    /// Tuesday.
    Tue,
    /// Wednesday.
    Wed,
    /// Thursday.
    Thu,
    /// Friday.
    Fri,
    /// Saturday.
    Sat,
    /// Sunday.
    Sun,
}
