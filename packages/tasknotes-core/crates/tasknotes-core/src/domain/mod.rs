//! Task, note, and query types plus their validating constructors.
//!
//! Parse, don't validate: a value of a type declared here is already known to
//! satisfy its invariants, so downstream code never re-checks. Where the
//! TypeScript client brands a string with a compile-time-only tag, this layer
//! parses it once at the boundary and holds the invariant for the value's
//! lifetime.
//!
//! ## The shape of the layer
//!
//! | module | role |
//! |---|---|
//! | [`ids`] | validated identifiers — task ids, project/context/tag names |
//! | [`status`], [`priority`] | the closed workflow enums |
//! | [`task`] | the task itself and the records hanging off it |
//! | [`request`] | create and update payloads, with the three-state field model |
//! | [`query`], [`report`] | request parameters and read-only response shapes |
//! | [`filters`] | on-device filtering and sorting |
//! | [`project`] | wikilink/bare-name project equivalence |
//! | [`wire`] | the `/v2` HTTP contract and its transform into the above |
//!
//! ## Two conventions that are not negotiable
//!
//! **Field order is a wire format.** UniFFI writes `Record` fields
//! *positionally* into the FFI buffer, so reordering a struct's fields is an
//! ABI break that no Rust tool detects — only the committed bindings diff does.
//! Every struct here is ordered to match the upstream schema so there is one
//! canonical answer rather than two.
//!
//! **Maps are ordered.** Anything that reaches serialized output uses
//! [`indexmap::IndexMap`], never a `HashMap`: these values are written back
//! into the user's YAML frontmatter, and unspecified iteration order would
//! produce a spurious git diff on every save and break the cross-platform
//! determinism hash.

pub mod filters;
pub mod ids;
pub mod priority;
pub mod project;
pub mod query;
pub mod report;
pub mod request;
pub mod status;
pub mod task;
pub mod wire;

mod serde_ext;

pub use filters::{FilterConfig, SortConfig, SortDirection, SortField, apply_filter, apply_sort};
pub use ids::{ContextName, ProjectName, TEMP_ID_PREFIX, TagName, TaskId};
pub use priority::{ALL_PRIORITIES, Priority};
pub use project::{project_display_name, project_matches, project_path};
pub use query::{FilterOptions, TaskQueryFilter};
pub use report::{
    ApiResponse, CalendarEvent, HealthState, HealthStatus, NlpParseResult, Pagination,
    PomodoroPhase, PomodoroStatus, QueryResponse, TaskList, TaskStats, TaskTime, TimeEntry,
    TimeSummary, TopTask, VaultInfo,
};
pub use request::{
    CreateTaskRequest, MinutesUpdate, RecurrenceAnchorUpdate, TaskTitle, TextUpdate,
    UpdateTaskRequest,
};
pub use serde_ext::FieldUpdate;
pub use status::{ACTIVE_STATUSES, ALL_STATUSES, COMPLETED_STATUSES, TaskStatus};
pub use task::{
    BlockedByEntry, ExtraFields, InlineTimeEntry, RecurrenceAnchor, Reminder, ReminderKind, Task,
};
pub use wire::{
    WIRE_FIELD_RENAMES, WireCalendarEvent, WireCalendarEvents, WireConfiguredValue,
    WireDeleteResponse, WireDependency, WireFilterOptions, WireNlpCreate, WireNlpParse,
    WireQueryResponse, WireReminder, WireTask, WireTaskList, WireTaskTime, WireTaskTimeTotals,
    WireTimeEntry, WireTimeSummary, WireTimeTotals, WireTopTask, create_task_body,
    to_wire_task_fields, unwrap_envelope, update_task_body,
};
