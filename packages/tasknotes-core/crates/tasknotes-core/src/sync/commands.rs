//! The command algebra.
//!
//! Every user mutation is recorded as a command carrying an **absolute** target
//! state — never a relative "toggle". Absolute state is what makes both the
//! on-device rebase and the server replay idempotent: applying a command that
//! already applied changes nothing, so a crash between server-ack and
//! client-dequeue can safely re-send it. The command's [`Command::id`] doubles
//! as the `X-Mutation-Id` idempotency key the server dedups on.
//!
//! Nothing in this module touches storage, the network or a clock. It is the
//! pure half of the sync stack: [`apply_command`] is the rebase step,
//! [`remap_task_id`] is the temp-id rewrite, and [`classify`] is the retry
//! policy's decision table.

use indexmap::IndexMap;

use crate::{
    Error, ErrorKind,
    domain::{CreateTaskRequest, Priority, Task, TaskId, TaskStatus, UpdateTaskRequest},
    net::{InstanceCompletion, InstanceRestore},
};

/// The recorded form of one user mutation.
///
/// Serialized straight into the durable queue, so the JSON shape here is a
/// storage format shared with the TypeScript client: a `type` discriminant
/// beside `id`, `createdAt` and the variant's own camelCase fields. Renaming a
/// variant or a field orphans every queue persisted by a previous release.
///
/// The five variants are exactly the five mutations the UI can express. There
/// is deliberately no "patch" or "toggle" variant: see the module docs.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Command {
    /// Create a task that does not exist on the server yet.
    Create {
        /// The idempotency key, unique across restarts.
        id: String,
        /// When the user made the change, in epoch milliseconds.
        created_at: i64,
        /// The client-minted id the optimistic task is shown under until the
        /// server assigns a real path.
        temp_id: TaskId,
        /// What to create.
        payload: CreateTaskRequest,
    },
    /// Apply a partial update to an existing task.
    Update {
        /// The idempotency key, unique across restarts.
        id: String,
        /// When the user made the change, in epoch milliseconds.
        created_at: i64,
        /// The task to update.
        task_id: TaskId,
        /// The three-state partial update.
        payload: UpdateTaskRequest,
    },
    /// Delete a task.
    Delete {
        /// The idempotency key, unique across restarts.
        id: String,
        /// When the user made the change, in epoch milliseconds.
        created_at: i64,
        /// The task to delete.
        task_id: TaskId,
    },
    /// Set a task's status to an absolute value.
    SetStatus {
        /// The idempotency key, unique across restarts.
        id: String,
        /// When the user made the change, in epoch milliseconds.
        created_at: i64,
        /// The task to restatus.
        task_id: TaskId,
        /// The status to set. Absolute, never derived from the current one.
        status: TaskStatus,
    },
    /// Set one occurrence of a recurring task to an absolute completion state.
    SetInstanceComplete {
        /// The idempotency key, unique across restarts.
        id: String,
        /// When the user made the change, in epoch milliseconds.
        created_at: i64,
        /// The recurring task.
        task_id: TaskId,
        /// The occurrence's date, as `YYYY-MM-DD`.
        ///
        /// Captured from the device's calendar **at the moment of the tap**, so
        /// a 23:59 completion replayed after midnight still lands on the day
        /// the user meant.
        date: String,
        /// The state to set the occurrence to.
        completed: bool,
        /// The schedule to put back, on an uncompletion.
        ///
        /// ⚠️ **Durable on purpose.** The snapshot is only knowable at the
        /// moment the occurrence is uncompleted — it is what the *completion*
        /// replaced — and the completion may already have advanced the local
        /// view or been sent. Carrying it on the command is what lets a queue
        /// that drains an hour later still send an undo the server can honour.
        ///
        /// `None` on every completion, and on an uncompletion whose
        /// pre-completion schedule is not knowable (a non-recurring task, or a
        /// completion this install never made).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        restore: Option<InstanceRestore>,
    },
}

impl Command {
    /// The idempotency key.
    #[must_use]
    pub fn id(&self) -> &str {
        match *self {
            Self::Create { ref id, .. }
            | Self::Update { ref id, .. }
            | Self::Delete { ref id, .. }
            | Self::SetStatus { ref id, .. }
            | Self::SetInstanceComplete { ref id, .. } => id,
        }
    }

    /// When the user made the change, in epoch milliseconds.
    #[must_use]
    pub const fn created_at(&self) -> i64 {
        match *self {
            Self::Create { created_at, .. }
            | Self::Update { created_at, .. }
            | Self::Delete { created_at, .. }
            | Self::SetStatus { created_at, .. }
            | Self::SetInstanceComplete { created_at, .. } => created_at,
        }
    }

    /// The task this command targets — the temp id, for a create.
    #[must_use]
    pub const fn target(&self) -> &TaskId {
        match *self {
            Self::Create { ref temp_id, .. } => temp_id,
            Self::Update { ref task_id, .. }
            | Self::Delete { ref task_id, .. }
            | Self::SetStatus { ref task_id, .. }
            | Self::SetInstanceComplete { ref task_id, .. } => task_id,
        }
    }

    /// Whether this command creates a task.
    #[must_use]
    pub const fn is_create(&self) -> bool {
        matches!(*self, Self::Create { .. })
    }

    /// Whether this command deletes a task.
    ///
    /// Load-bearing: a `not_found` failure on a delete is *success*, because
    /// the task reaching "gone" is the goal state regardless of who removed it.
    #[must_use]
    pub const fn is_delete(&self) -> bool {
        matches!(*self, Self::Delete { .. })
    }

    /// The completion state a [`Command::SetInstanceComplete`] carries, in the
    /// shape [`TaskApi`](super::host::TaskApi) takes.
    #[must_use]
    pub fn instance_completion(&self) -> Option<InstanceCompletion> {
        match *self {
            Self::SetInstanceComplete {
                ref date,
                completed,
                ref restore,
                ..
            } => Some(InstanceCompletion {
                date: date.clone(),
                completed,
                restore: restore.clone(),
            }),
            Self::Create { .. }
            | Self::Update { .. }
            | Self::Delete { .. }
            | Self::SetStatus { .. } => None,
        }
    }
}

/// A mutation as the UI expresses it, before ids and timestamps are minted.
///
/// The queue's own [`Command`] is built from this by
/// [`TaskStore::dispatch`](crate::store::TaskStore::dispatch), which is the only
/// place a command id or a temp id is created.
#[derive(Debug, Clone, PartialEq)]
pub enum CommandInput {
    /// Create a task.
    Create {
        /// What to create.
        payload: CreateTaskRequest,
    },
    /// Update a task.
    Update {
        /// The task to update, before alias resolution.
        task_id: TaskId,
        /// The three-state partial update.
        payload: UpdateTaskRequest,
    },
    /// Delete a task.
    Delete {
        /// The task to delete, before alias resolution.
        task_id: TaskId,
    },
    /// Set a task's status.
    SetStatus {
        /// The task to restatus, before alias resolution.
        task_id: TaskId,
        /// The status to set.
        status: TaskStatus,
    },
    /// Set one occurrence's completion state.
    SetInstanceComplete {
        /// The recurring task, before alias resolution.
        task_id: TaskId,
        /// The occurrence's date, as `YYYY-MM-DD`.
        date: String,
        /// The state to set it to.
        completed: bool,
    },
}

/// Render an instant the way JavaScript's `Date.prototype.toISOString` does.
///
/// Always UTC, always three fractional digits, so an optimistic task's
/// `dateCreated` is byte-identical to the one the TypeScript client writes.
/// Returns `None` for an instant outside the representable range, which yields
/// a task with no creation date rather than a panic — a millisecond count that
/// far out is a broken host clock, and the queue is more valuable than the
/// timestamp.
#[must_use]
fn iso_millis(millis: i64) -> Option<String> {
    chrono::DateTime::from_timestamp_millis(millis)
        .map(|instant| instant.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
}

/// Build the optimistic task an offline create shows immediately.
///
/// Lives here rather than in the UI layer so the rebase is a pure function that
/// is testable without a view. The earlier engine treated a create as a no-op
/// during rebase, which is how an offline create used to vanish from the list
/// the instant anything else recomputed it.
///
/// Note that `timeEstimate` is deliberately **not** carried across, mirroring
/// the TypeScript `materializeCreate` exactly: the value is still sent to the
/// server with the create, it simply is not shown optimistically.
#[must_use]
pub fn materialize_create(temp_id: &TaskId, created_at: i64, payload: &CreateTaskRequest) -> Task {
    let now = iso_millis(created_at);
    Task {
        id: temp_id.clone(),
        path: String::new(),
        title: payload.title.as_str().to_owned(),
        status: payload.status.unwrap_or(TaskStatus::Open),
        priority: payload.priority.unwrap_or(Priority::Normal),
        due: payload.due.clone(),
        scheduled: payload.scheduled.clone(),
        contexts: payload.contexts.clone().unwrap_or_default(),
        projects: payload.projects.clone().unwrap_or_default(),
        tags: payload.tags.clone().unwrap_or_default(),
        recurrence: payload.recurrence.clone(),
        recurrence_anchor: payload.recurrence_anchor,
        complete_instances: Vec::new(),
        skipped_instances: Vec::new(),
        completed_date: None,
        date_created: now.clone(),
        date_modified: now,
        time_estimate: None,
        time_entries: Vec::new(),
        blocked_by: Vec::new(),
        reminders: Vec::new(),
        archived: false,
        total_tracked_time: 0,
        is_blocked: false,
        is_blocking: false,
        extra_fields: payload.extra_fields.clone().unwrap_or_default(),
        details: payload.details.clone(),
    }
}

/// Overwrite the fields an [`UpdateTaskRequest`] names, honouring all three
/// states of every clearable field.
///
/// Absent leaves the value alone, `null` deletes it, a value replaces it — get
/// that wrong in either direction and a note is silently corrupted.
///
/// Deliberately private. A host that wants to predict a write should call
/// [`apply_command`]; the fake server that the scenario corpus runs against
/// re-implements this independently, because an oracle that shares code with
/// the thing it is checking is not an oracle.
fn apply_update(task: &mut Task, payload: &UpdateTaskRequest) {
    if let Some(ref title) = payload.title {
        title.as_str().clone_into(&mut task.title);
    }
    task.details = payload.details.clone().apply(task.details.take());
    if let Some(status) = payload.status {
        task.status = status;
    }
    if let Some(priority) = payload.priority {
        task.priority = priority;
    }
    task.due = payload.due.clone().apply(task.due.take());
    task.scheduled = payload.scheduled.clone().apply(task.scheduled.take());
    if let Some(ref contexts) = payload.contexts {
        task.contexts.clone_from(contexts);
    }
    if let Some(ref projects) = payload.projects {
        task.projects.clone_from(projects);
    }
    if let Some(ref tags) = payload.tags {
        task.tags.clone_from(tags);
    }
    task.recurrence = payload.recurrence.clone().apply(task.recurrence.take());
    task.recurrence_anchor = payload
        .recurrence_anchor
        .apply(task.recurrence_anchor.take());
    task.time_estimate = payload.time_estimate.apply(task.time_estimate.take());
    if let Some(ref extra_fields) = payload.extra_fields {
        task.extra_fields = extra_fields.clone();
    }
}

/// Apply one command on top of a task map — the pure rebase step.
///
/// **Every branch is idempotent.** Applying the same command twice yields the
/// same map, which is what lets the visible task list be recomputed as
/// `pending.fold(base, apply_command)` on every change without ever persisting
/// the result.
///
/// A command whose target is missing is a no-op rather than an error: the base
/// snapshot may simply not have caught up, or the task may have been deleted in
/// Obsidian, and neither is a reason to refuse to render the list.
pub fn apply_command(command: &Command, tasks: &mut IndexMap<TaskId, Task>) {
    match *command {
        Command::Create {
            created_at,
            ref temp_id,
            ref payload,
            ..
        } => {
            tasks.insert(
                temp_id.clone(),
                materialize_create(temp_id, created_at, payload),
            );
        }
        Command::Update {
            ref task_id,
            ref payload,
            ..
        } => {
            if let Some(task) = tasks.get_mut(task_id) {
                apply_update(task, payload);
            }
        }
        Command::Delete { ref task_id, .. } => {
            // `shift_remove`, not `swap_remove`: the visible order is the
            // order the server listed the tasks in, and swapping the last
            // entry into the hole would reshuffle the user's list.
            tasks.shift_remove(task_id);
        }
        Command::SetStatus {
            ref task_id,
            status,
            ..
        } => {
            if let Some(task) = tasks.get_mut(task_id) {
                task.status = status;
            }
        }
        Command::SetInstanceComplete {
            ref task_id,
            ref date,
            completed,
            ref restore,
            ..
        } => {
            if let Some(task) = tasks.get_mut(task_id) {
                let present = task.complete_instances.iter().any(|entry| entry == date);
                if completed && !present {
                    task.complete_instances.push(date.clone());
                } else if !completed && present {
                    task.complete_instances.retain(|entry| entry != date);
                }
                // The optimistic view has to show what the server will do, and
                // the server puts the whole pre-completion schedule back rather
                // than only clearing the tick. Without this the list rewinds the
                // occurrence while still showing the advanced dates, then jumps
                // when the ack lands. Assigning absolute values keeps the branch
                // idempotent, which `rebase` requires.
                if !completed && let Some(restore) = restore.as_ref() {
                    task.recurrence = Some(restore.recurrence.clone());
                    task.scheduled.clone_from(&restore.scheduled);
                    task.due.clone_from(&restore.due);
                    let skipped = task.skipped_instances.iter().any(|entry| entry == date);
                    if restore.skipped && !skipped {
                        task.skipped_instances.push(date.clone());
                    } else if !restore.skipped && skipped {
                        task.skipped_instances.retain(|entry| entry != date);
                    }
                }
            }
        }
    }
}

/// Rebase a whole queue on top of a base snapshot.
///
/// The offline-first invariant in one line: the visible world is always this
/// function's output, and this function's output is **never** persisted.
#[must_use]
pub fn rebase<'command>(
    base: &IndexMap<TaskId, Task>,
    pending: impl IntoIterator<Item = &'command Command>,
) -> IndexMap<TaskId, Task> {
    let mut view = base.clone();
    for command in pending {
        apply_command(command, &mut view);
    }
    view
}

/// Rewrite a command's task reference from a temp id to the server-assigned
/// one, returning `None` when it did not target `from`.
///
/// Returning an `Option` rather than always cloning keeps the caller able to
/// tell "rewritten" from "untouched", which is how the queue avoids persisting
/// a dead-letter list that did not actually change.
#[must_use]
pub fn remap_task_id(command: &Command, from: &TaskId, to: &TaskId) -> Option<Command> {
    if command.target() != from {
        return None;
    }
    let mut remapped = command.clone();
    match remapped {
        Command::Create {
            ref mut temp_id, ..
        } => *temp_id = to.clone(),
        Command::Update {
            ref mut task_id, ..
        }
        | Command::Delete {
            ref mut task_id, ..
        }
        | Command::SetStatus {
            ref mut task_id, ..
        }
        | Command::SetInstanceComplete {
            ref mut task_id, ..
        } => *task_id = to.clone(),
    }
    Some(remapped)
}

/// What the engine should do about a failed replay.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum FailureClass {
    /// Offline, 5xx or 429: stop draining, back off, retry.
    Transient,
    /// HTTP 400 or 422, a validation failure, or a broken invariant:
    /// dead-letter the command and keep draining, because retrying cannot
    /// help.
    Permanent,
    /// HTTP 404: the target was renamed or deleted server-side. A delete has
    /// reached its goal state; anything else is dead-lettered for review.
    NotFound,
    /// HTTP 401 or 403: stop draining, surface the auth banner, and arm **no**
    /// retry timer, because a token does not fix itself on a schedule.
    Auth,
}

/// Decide what a replay failure means for the drain.
///
/// The decision table, which the fixtures pin:
///
/// | input | class |
/// |---|---|
/// | connection, network | transient |
/// | `not_found` (any status) | not found |
/// | validation | permanent |
/// | api 401, api 403 | auth |
/// | api 404 | not found |
/// | api 429, api ≥ 500 | transient |
/// | api anything else | permanent |
/// | invariant | permanent |
///
/// `not_found` is a sibling of `api` rather than a subclass precisely so this
/// function cannot reach the generic API branch first and mis-handle a 404.
///
/// [`Error::Invariant`] has no TypeScript counterpart — over there this class
/// of bug throws rather than becoming a value. It is classified `permanent`
/// because a broken contract is not a network condition: retrying it forever
/// would hide the bug, so the command is parked where a human can see it.
#[must_use]
pub fn classify(error: &Error) -> FailureClass {
    match error.kind() {
        ErrorKind::Connection | ErrorKind::Network => FailureClass::Transient,
        ErrorKind::NotFound => FailureClass::NotFound,
        ErrorKind::Validation | ErrorKind::Invariant => FailureClass::Permanent,
        ErrorKind::Api => match error.status() {
            Some(401 | 403) => FailureClass::Auth,
            Some(404) => FailureClass::NotFound,
            Some(429) => FailureClass::Transient,
            Some(status) if status >= 500 => FailureClass::Transient,
            _ => FailureClass::Permanent,
        },
    }
}

/// Render a value in base 36, the way JavaScript's `Number#toString(36)` does.
fn base36(mut value: u64) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_owned();
    }
    let mut out = Vec::new();
    while value > 0 {
        let digit = usize::try_from(value % 36).unwrap_or_default();
        out.push(DIGITS.get(digit).copied().unwrap_or(b'0'));
        value /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// Mint a command id that is unique across restarts.
///
/// `{millis}-{counter}-{suffix}`, where the suffix is drawn from the injected
/// randomness. The random tail is not decoration: the counter resets on
/// relaunch and two app instances can mint ids on the same clock tick, and the
/// id *is* the server's idempotency key — a collision would make the server
/// replay the wrong response.
#[must_use]
pub fn command_id(now_millis: i64, counter: u64, unit_ppm: u32) -> String {
    let bounded = u64::from(unit_ppm.min(super::host::UNIT_PPM));
    let suffix = base36(bounded * 0x00ff_ffff / u64::from(super::host::UNIT_PPM));
    format!("{now_millis}-{counter}-{suffix:0>4}")
}

#[cfg(test)]
mod tests {
    use indexmap::IndexMap;

    use super::{
        Command, FailureClass, apply_command, base36, classify, command_id, rebase, remap_task_id,
    };
    use crate::{
        Error,
        domain::{CreateTaskRequest, Task, TaskId, TaskStatus, TaskTitle, UpdateTaskRequest},
    };

    fn task(id: &str) -> Task {
        serde_json::from_value(serde_json::json!({ "id": id, "title": "Test" })).unwrap()
    }

    fn create(id: &str, temp: &str) -> Command {
        Command::Create {
            id: id.to_owned(),
            created_at: 1_750_000_000_000,
            temp_id: TaskId::parse(temp).unwrap(),
            payload: CreateTaskRequest::new(TaskTitle::parse("Written offline").unwrap()),
        }
    }

    #[test]
    fn commands_round_trip_through_the_shared_queue_format() {
        let command = create("c1", "tmp-1-1");
        let json = serde_json::to_value(&command).unwrap();
        assert_eq!(json["type"], "create");
        assert_eq!(json["createdAt"], 1_750_000_000_000_i64);
        assert_eq!(json["tempId"], "tmp-1-1");
        assert_eq!(serde_json::from_value::<Command>(json).unwrap(), command);
    }

    #[test]
    fn a_delete_serializes_with_the_task_id_key_typescript_writes() {
        let command = Command::Delete {
            id: "c2".to_owned(),
            created_at: 7,
            task_id: TaskId::parse("Tasks/a.md").unwrap(),
        };
        assert_eq!(
            serde_json::to_value(&command).unwrap(),
            serde_json::json!({
                "type": "delete",
                "id": "c2",
                "createdAt": 7,
                "taskId": "Tasks/a.md",
            })
        );
    }

    #[test]
    fn a_create_materializes_an_optimistic_task() {
        let command = create("c1", "tmp-1-1");
        let mut view = IndexMap::new();
        apply_command(&command, &mut view);
        let optimistic = view.get(&TaskId::parse("tmp-1-1").unwrap()).unwrap();
        assert_eq!(optimistic.title, "Written offline");
        assert_eq!(optimistic.path, "");
        assert_eq!(optimistic.status, TaskStatus::Open);
        assert_eq!(
            optimistic.date_created.as_deref(),
            Some("2025-06-15T15:06:40.000Z")
        );
    }

    #[test]
    fn applying_a_command_twice_changes_nothing() {
        let base: IndexMap<TaskId, Task> =
            IndexMap::from([(TaskId::parse("Tasks/a.md").unwrap(), task("Tasks/a.md"))]);
        for command in [
            create("c1", "tmp-1-1"),
            Command::SetStatus {
                id: "c2".to_owned(),
                created_at: 1,
                task_id: TaskId::parse("Tasks/a.md").unwrap(),
                status: TaskStatus::Done,
            },
            Command::SetInstanceComplete {
                id: "c3".to_owned(),
                created_at: 1,
                task_id: TaskId::parse("Tasks/a.md").unwrap(),
                date: "2026-07-01".to_owned(),
                completed: true,
                restore: None,
            },
            Command::Delete {
                id: "c4".to_owned(),
                created_at: 1,
                task_id: TaskId::parse("Tasks/a.md").unwrap(),
            },
        ] {
            let once = rebase(&base, [&command]);
            let twice = rebase(&base, [&command, &command]);
            assert_eq!(once, twice, "{command:?} is not idempotent");
        }
    }

    #[test]
    fn an_update_honours_all_three_states_of_a_clearable_field() {
        let mut view: IndexMap<TaskId, Task> = IndexMap::new();
        let id = TaskId::parse("Tasks/a.md").unwrap();
        let mut seeded = task("Tasks/a.md");
        seeded.due = Some("2026-08-08".to_owned());
        seeded.scheduled = Some("2026-08-07".to_owned());
        view.insert(id.clone(), seeded);

        let payload: UpdateTaskRequest =
            serde_json::from_value(serde_json::json!({ "due": null, "title": "Renamed" })).unwrap();
        apply_command(
            &Command::Update {
                id: "c1".to_owned(),
                created_at: 1,
                task_id: id.clone(),
                payload,
            },
            &mut view,
        );

        let updated = view.get(&id).unwrap();
        assert_eq!(updated.due, None, "null must clear");
        assert_eq!(
            updated.scheduled.as_deref(),
            Some("2026-08-07"),
            "absent must not clear"
        );
        assert_eq!(updated.title, "Renamed");
    }

    #[test]
    fn a_command_against_a_missing_task_is_a_no_op() {
        let mut view: IndexMap<TaskId, Task> = IndexMap::new();
        apply_command(
            &Command::SetStatus {
                id: "c1".to_owned(),
                created_at: 1,
                task_id: TaskId::parse("Tasks/gone.md").unwrap(),
                status: TaskStatus::Done,
            },
            &mut view,
        );
        assert!(view.is_empty());
    }

    #[test]
    fn remapping_rewrites_only_the_matching_target() {
        let from = TaskId::parse("tmp-1-1").unwrap();
        let to = TaskId::parse("Tasks/real.md").unwrap();
        let created = create("c1", "tmp-1-1");
        assert_eq!(
            remap_task_id(&created, &from, &to).unwrap().target(),
            &to,
            "a create's temp id is its target"
        );
        let other = Command::Delete {
            id: "c2".to_owned(),
            created_at: 1,
            task_id: TaskId::parse("Tasks/other.md").unwrap(),
        };
        assert_eq!(remap_task_id(&other, &from, &to), None);
    }

    #[test]
    fn the_classification_table_matches_the_typescript_one() {
        assert_eq!(
            classify(&Error::connection()),
            FailureClass::Transient,
            "connection"
        );
        assert_eq!(classify(&Error::network("x")), FailureClass::Transient);
        assert_eq!(
            classify(&Error::not_found("Task", "a.md")),
            FailureClass::NotFound
        );
        assert_eq!(classify(&Error::validation("x")), FailureClass::Permanent);
        assert_eq!(classify(&Error::invariant("x")), FailureClass::Permanent);
        for status in [401_u16, 403] {
            assert_eq!(classify(&Error::api("x", status)), FailureClass::Auth);
        }
        assert_eq!(classify(&Error::api("x", 404)), FailureClass::NotFound);
        for status in [429_u16, 500, 503, 599] {
            assert_eq!(
                classify(&Error::api("x", status)),
                FailureClass::Transient,
                "status {status}"
            );
        }
        for status in [400_u16, 409, 418, 422, 0] {
            assert_eq!(
                classify(&Error::api("x", status)),
                FailureClass::Permanent,
                "status {status}"
            );
        }
    }

    #[test]
    fn base36_matches_the_javascript_spelling() {
        assert_eq!(base36(0), "0");
        assert_eq!(base36(35), "z");
        assert_eq!(base36(36), "10");
        assert_eq!(base36(0x00ff_ffff), "9zldr");
    }

    #[test]
    fn a_command_id_carries_the_clock_the_counter_and_a_suffix() {
        let id = command_id(1_750_000_000_000, 3, 500_000);
        assert!(id.starts_with("1750000000000-3-"), "unexpected id {id}");
        assert_ne!(
            command_id(1_750_000_000_000, 3, 0),
            id,
            "the suffix must depend on the injected randomness"
        );
    }
}
