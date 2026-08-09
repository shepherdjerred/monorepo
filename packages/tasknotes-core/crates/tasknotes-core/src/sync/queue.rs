//! The durable FIFO command queue and its dead-letter list.
//!
//! **Persistence only, no execution.** Separating storage from execution — the
//! drain lives in [`SyncEngine`](super::engine::SyncEngine) — is what makes
//! single-flight replay possible at all: the queue this replaced owned both, so
//! two callers could replay the same snapshot concurrently and double-execute
//! every command in it.
//!
//! Two behaviours here are easy to get wrong and are pinned by the scenario
//! corpus:
//!
//! * **Squash on enqueue.** A delete targeting a task whose `create` is still
//!   pending means the task was born and destroyed before the server ever heard
//!   of it. The create *and every command targeting it* are dropped, and the
//!   delete is never enqueued at all — there is nothing on the server to delete.
//! * **[`CommandQueue::remap_task_id`] rewrites the dead-letter list too.** If a
//!   create and a following command both dead-letter, and the create is later
//!   retried and acked under a real path, a dead-lettered follower left pinned
//!   to the dead temp id fails every retry forever.

use std::sync::Arc;

use serde_json::Value;

use super::{
    commands::{Command, remap_task_id},
    host::{Clock, QueueStorage},
};
use crate::{Error, Result, domain::TaskId};

/// A command that failed permanently, parked for the user to review.
///
/// Persisted, so the JSON shape is a storage format shared with the TypeScript
/// client.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeadLetterEntry {
    /// The command that failed.
    pub command: Command,
    /// Why it failed, in the persisted shape.
    pub error: DeadLetterError,
    /// When it was parked, in epoch milliseconds.
    pub failed_at: i64,
}

/// The persisted rendering of the failure that parked a command.
///
/// Note the field is **`name`**, not `kind`: the on-disk format predates the
/// tagged error union and stores the TypeScript `Error.name` string
/// (`"ApiError"`, `"NotFoundError"`, …). Writing `kind` here would produce a
/// dead-letter list the TypeScript client cannot read, so
/// [`Error::name`](crate::Error::name) exists precisely to keep these bytes
/// compatible. Nothing branches on it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DeadLetterError {
    /// The failing error's class name.
    pub name: String,
    /// The human-readable message.
    pub message: String,
    /// The HTTP status, present only for the two variants that carry one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

impl From<&Error> for DeadLetterError {
    fn from(error: &Error) -> Self {
        Self {
            name: error.name().to_owned(),
            message: error.message().to_owned(),
            status: error.status(),
        }
    }
}

/// The durable command queue.
///
/// Owned by [`TaskStore`](crate::store::TaskStore), which is the only thing
/// allowed to mutate it — the engine reaches the queue through the store so
/// that every mutation recomputes the visible view exactly once.
pub struct CommandQueue {
    storage: Arc<dyn QueueStorage>,
    clock: Arc<dyn Clock>,
    queue: Vec<Command>,
    dead: Vec<DeadLetterEntry>,
}

impl core::fmt::Debug for CommandQueue {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter
            .debug_struct("CommandQueue")
            .field("queue", &self.queue)
            .field("dead", &self.dead)
            .finish_non_exhaustive()
    }
}

impl CommandQueue {
    /// Build an empty queue over host-supplied storage and clock.
    ///
    /// Nothing is read until [`CommandQueue::restore`] runs, so a pre-restore
    /// state is observable and testable.
    #[must_use]
    pub fn new(storage: Arc<dyn QueueStorage>, clock: Arc<dyn Clock>) -> Self {
        Self {
            storage,
            clock,
            queue: Vec::new(),
            dead: Vec::new(),
        }
    }

    /// Load the persisted queue and dead-letter list.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure. A *parse* failure is not an error:
    /// see [`salvage`].
    pub fn restore(&mut self) -> Result<()> {
        self.queue = salvage(self.storage.read_queue()?.as_deref());
        self.dead = salvage(self.storage.read_dead_letter()?.as_deref());
        Ok(())
    }

    /// The commands waiting to be sent, oldest first.
    #[must_use]
    pub fn pending(&self) -> &[Command] {
        &self.queue
    }

    /// The commands parked for review.
    #[must_use]
    pub fn dead_letters(&self) -> &[DeadLetterEntry] {
        &self.dead
    }

    /// Whether anything is waiting to be sent.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    /// The next command to send.
    #[must_use]
    pub fn head(&self) -> Option<&Command> {
        self.queue.first()
    }

    /// Whether any command — queued or parked — already carries this id.
    ///
    /// The id is the server's idempotency key, so a second command wearing one
    /// that is still durable would make the server answer it from the *first*
    /// command's stored response. [`TaskStore`](crate::store::TaskStore) checks
    /// this before minting.
    #[must_use]
    pub fn contains_command_id(&self, id: &str) -> bool {
        self.queue.iter().any(|queued| queued.id() == id)
            || self.dead.iter().any(|entry| entry.command.id() == id)
    }

    /// Whether any command — queued or parked — targets this task.
    ///
    /// Used to keep a freshly minted temp id from landing on one an unsent
    /// create already owns, which would merge two optimistic tasks into one.
    #[must_use]
    pub fn targets(&self, id: &TaskId) -> bool {
        self.queue.iter().any(|queued| queued.target() == id)
            || self.dead.iter().any(|entry| entry.command.target() == id)
    }

    /// Record a command, squashing a delete against a still-pending create.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure.
    pub fn enqueue(&mut self, command: Command) -> Result<()> {
        if command.is_delete() {
            let target = command.target().clone();
            let has_pending_create = self
                .queue
                .iter()
                .any(|queued| queued.is_create() && *queued.target() == target);
            if has_pending_create {
                // The task never reached the server, so there is nothing to
                // delete there and nothing downstream worth sending. Drop the
                // create, everything targeting it, and the delete itself.
                self.queue.retain(|queued| *queued.target() != target);
                return self.persist_queue();
            }
        }
        self.queue.push(command);
        self.persist_queue()
    }

    /// Drop an acknowledged command.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure.
    pub fn ack(&mut self, id: &str) -> Result<()> {
        self.queue.retain(|queued| queued.id() != id);
        self.persist_queue()
    }

    /// Rewrite every reference to `from` — in the queue **and** in the
    /// dead-letter list — to the server-assigned `to`.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure.
    pub fn remap_task_id(&mut self, from: &TaskId, to: &TaskId) -> Result<()> {
        for command in &mut self.queue {
            if let Some(remapped) = remap_task_id(command, from, to) {
                *command = remapped;
            }
        }
        self.persist_queue()?;

        let mut dead_changed = false;
        for entry in &mut self.dead {
            if let Some(remapped) = remap_task_id(&entry.command, from, to) {
                entry.command = remapped;
                dead_changed = true;
            }
        }
        if dead_changed {
            self.persist_dead_letter()?;
        }
        Ok(())
    }

    /// Park a queued command for review.
    ///
    /// A no-op when the id is not queued, which is what makes the drain safe to
    /// re-enter: two passes cannot dead-letter the same command twice.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure.
    pub fn dead_letter(&mut self, id: &str, error: &Error) -> Result<()> {
        let Some(position) = self.queue.iter().position(|queued| queued.id() == id) else {
            return Ok(());
        };
        let command = self.queue.remove(position);
        self.dead.push(DeadLetterEntry {
            command,
            error: DeadLetterError::from(error),
            failed_at: self.clock.now_millis(),
        });
        self.persist_queue()?;
        self.persist_dead_letter()
    }

    /// Move a parked command back onto the tail of the queue.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure.
    pub fn retry_dead_letter(&mut self, id: &str) -> Result<()> {
        let Some(position) = self.dead.iter().position(|entry| entry.command.id() == id) else {
            return Ok(());
        };
        let entry = self.dead.remove(position);
        self.queue.push(entry.command);
        self.persist_queue()?;
        self.persist_dead_letter()
    }

    /// Drop a parked command for good.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure.
    pub fn discard_dead_letter(&mut self, id: &str) -> Result<()> {
        self.dead.retain(|entry| entry.command.id() != id);
        self.persist_dead_letter()
    }

    fn persist_queue(&self) -> Result<()> {
        let data = serde_json::to_string(&self.queue).map_err(|error| {
            Error::invariant(format!("could not serialize the command queue: {error}"))
        })?;
        self.storage.write_queue(&data)
    }

    fn persist_dead_letter(&self) -> Result<()> {
        let data = serde_json::to_string(&self.dead).map_err(|error| {
            Error::invariant(format!("could not serialize the dead-letter list: {error}"))
        })?;
        self.storage.write_dead_letter(&data)
    }
}

/// Parse a persisted list, keeping every element that still parses.
///
/// Deliberately lossy, and deliberately not an error. This is the one place the
/// core reads bytes an *older release of a different implementation* wrote: a
/// queue entry whose shape has since changed cannot be executed, and refusing
/// to start the app because of it would strand every other queued mutation the
/// user is waiting on. Per-element salvage is what the TypeScript
/// `safeParse`-per-item loop does, and the two must agree or a shared fixture
/// means nothing.
fn salvage<T: serde::de::DeserializeOwned>(raw: Option<&str>) -> Vec<T> {
    let Some(raw) = raw.filter(|value| !value.is_empty()) else {
        return Vec::new();
    };
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(raw) else {
        return Vec::new();
    };
    items
        .into_iter()
        .filter_map(|item| serde_json::from_value(item).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::{CommandQueue, DeadLetterEntry, salvage};
    use crate::{
        Error, Result,
        domain::{CreateTaskRequest, TaskId, TaskTitle},
        sync::{
            commands::Command,
            host::{Clock, QueueStorage},
        },
    };

    #[derive(Default)]
    struct MemoryStorage {
        queue: Mutex<Option<String>>,
        dead: Mutex<Option<String>>,
    }

    impl QueueStorage for MemoryStorage {
        fn read_queue(&self) -> Result<Option<String>> {
            Ok(self.queue.lock().unwrap().clone())
        }
        fn write_queue(&self, data: &str) -> Result<()> {
            *self.queue.lock().unwrap() = Some(data.to_owned());
            Ok(())
        }
        fn read_dead_letter(&self) -> Result<Option<String>> {
            Ok(self.dead.lock().unwrap().clone())
        }
        fn write_dead_letter(&self, data: &str) -> Result<()> {
            *self.dead.lock().unwrap() = Some(data.to_owned());
            Ok(())
        }
    }

    struct FixedClock;

    impl Clock for FixedClock {
        fn now_millis(&self) -> i64 {
            1_750_000_000_000
        }
        fn local_ymd(&self, _millis: i64) -> String {
            "2025-06-15".to_owned()
        }
    }

    fn queue() -> (CommandQueue, Arc<MemoryStorage>) {
        let storage = Arc::new(MemoryStorage::default());
        (
            CommandQueue::new(storage.clone(), Arc::new(FixedClock)),
            storage,
        )
    }

    fn temp(suffix: &str) -> TaskId {
        TaskId::parse(format!("tmp-{suffix}")).unwrap()
    }

    fn create(id: &str, target: &TaskId) -> Command {
        Command::Create {
            id: id.to_owned(),
            created_at: 1,
            temp_id: target.clone(),
            payload: CreateTaskRequest::new(TaskTitle::parse("Offline").unwrap()),
        }
    }

    fn set_status(id: &str, target: &TaskId) -> Command {
        Command::SetStatus {
            id: id.to_owned(),
            created_at: 1,
            task_id: target.clone(),
            status: crate::domain::TaskStatus::Done,
        }
    }

    fn delete(id: &str, target: &TaskId) -> Command {
        Command::Delete {
            id: id.to_owned(),
            created_at: 1,
            task_id: target.clone(),
        }
    }

    #[test]
    fn deleting_a_still_pending_create_squashes_the_whole_chain() {
        let (mut queue, _) = queue();
        let target = temp("1-1");
        queue.enqueue(create("c1", &target)).unwrap();
        queue.enqueue(set_status("c2", &target)).unwrap();
        queue
            .enqueue(create("c3", &temp("1-2")))
            .expect("unrelated create");
        queue.enqueue(delete("c4", &target)).unwrap();

        let ids: Vec<&str> = queue.pending().iter().map(Command::id).collect();
        assert_eq!(ids, ["c3"], "the delete must not be enqueued either");
    }

    #[test]
    fn deleting_a_server_side_task_is_enqueued_normally() {
        let (mut queue, _) = queue();
        let real = TaskId::parse("Tasks/a.md").unwrap();
        queue.enqueue(delete("c1", &real)).unwrap();
        assert_eq!(queue.pending().len(), 1);
    }

    #[test]
    fn remapping_rewrites_the_dead_letter_list_too() {
        let (mut queue, _) = queue();
        let from = temp("1-1");
        let to = TaskId::parse("Tasks/real.md").unwrap();
        queue.enqueue(set_status("c2", &from)).unwrap();
        queue
            .dead_letter("c2", &Error::api("nope", 422))
            .expect("park it");
        assert_eq!(queue.dead_letters().len(), 1);

        queue.enqueue(set_status("c3", &from)).unwrap();
        queue.remap_task_id(&from, &to).unwrap();

        assert_eq!(queue.pending().first().map(Command::target), Some(&to));
        assert_eq!(
            queue
                .dead_letters()
                .first()
                .map(|entry| entry.command.target().clone()),
            Some(to),
            "a parked command left on a dead temp id fails every retry forever"
        );
    }

    #[test]
    fn a_dead_letter_persists_the_error_name_not_its_kind() {
        let (mut queue, storage) = queue();
        let target = TaskId::parse("Tasks/a.md").unwrap();
        queue.enqueue(set_status("c1", &target)).unwrap();
        queue
            .dead_letter("c1", &Error::api("invalid", 422))
            .unwrap();

        let raw = storage.dead.lock().unwrap().clone().unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed[0]["error"]["name"], "ApiError");
        assert_eq!(parsed[0]["error"]["status"], 422);
        assert_eq!(parsed[0]["failedAt"], 1_750_000_000_000_i64);
        assert!(parsed[0]["error"].get("kind").is_none());
    }

    #[test]
    fn a_not_found_dead_letter_keeps_its_implied_status() {
        let (mut queue, _) = queue();
        let target = TaskId::parse("Tasks/a.md").unwrap();
        queue.enqueue(set_status("c1", &target)).unwrap();
        queue
            .dead_letter("c1", &Error::not_found("Task", "Tasks/a.md"))
            .unwrap();
        assert_eq!(
            queue
                .dead_letters()
                .first()
                .and_then(|entry| entry.error.status),
            Some(404)
        );
    }

    #[test]
    fn dead_lettering_an_unqueued_id_is_a_no_op() {
        let (mut queue, _) = queue();
        queue.dead_letter("nope", &Error::api("x", 400)).unwrap();
        assert!(queue.dead_letters().is_empty());
    }

    #[test]
    fn retry_moves_a_parked_command_back_onto_the_tail() {
        let (mut queue, _) = queue();
        let target = TaskId::parse("Tasks/a.md").unwrap();
        queue.enqueue(set_status("c1", &target)).unwrap();
        queue.dead_letter("c1", &Error::api("x", 422)).unwrap();
        queue.retry_dead_letter("c1").unwrap();
        assert_eq!(queue.pending().len(), 1);
        assert!(queue.dead_letters().is_empty());
    }

    #[test]
    fn restore_reads_back_exactly_what_was_persisted() {
        let (mut queue, storage) = queue();
        let target = TaskId::parse("Tasks/a.md").unwrap();
        queue.enqueue(set_status("c1", &target)).unwrap();
        queue.enqueue(delete("c2", &target)).unwrap();
        let persisted = queue.pending().to_vec();

        let mut rebuilt = CommandQueue::new(storage, Arc::new(FixedClock));
        rebuilt.restore().unwrap();
        assert_eq!(rebuilt.pending(), persisted.as_slice());
    }

    #[test]
    fn salvage_keeps_the_entries_that_still_parse() {
        let raw = r#"[{"type":"delete","id":"c1","createdAt":1,"taskId":"Tasks/a.md"},
                      {"type":"delete","id":"c2","createdAt":1,"taskId":"not-a-note"},
                      {"nonsense":true}]"#;
        let salvaged: Vec<Command> = salvage(Some(raw));
        assert_eq!(salvaged.len(), 1);
        assert_eq!(salvaged.first().map(Command::id), Some("c1"));
    }

    #[test]
    fn salvage_treats_junk_as_an_empty_list() {
        assert!(salvage::<Command>(None).is_empty());
        assert!(salvage::<Command>(Some("")).is_empty());
        assert!(salvage::<Command>(Some("not json")).is_empty());
        assert!(salvage::<DeadLetterEntry>(Some("{}")).is_empty());
    }
}
