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
    /// Propagates a storage-layer failure, and refuses bytes it cannot read in
    /// full: see [`parse_durable`].
    pub fn restore(&mut self) -> Result<()> {
        self.queue = parse_durable(self.storage.read_queue()?.as_deref(), "command queue")?;
        self.dead = parse_durable(
            self.storage.read_dead_letter()?.as_deref(),
            "dead-letter list",
        )?;
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
    /// The proposed queue is written before it is adopted, so a refused write
    /// leaves nothing behind in memory. See [`Self::commit_queue`] for what a
    /// leftover would cost.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure.
    pub fn enqueue(&mut self, command: Command) -> Result<()> {
        let mut candidate = self.queue.clone();
        if command.is_delete() {
            let target = command.target().clone();
            let has_pending_create = candidate
                .iter()
                .any(|queued| queued.is_create() && *queued.target() == target);
            if has_pending_create {
                // The task never reached the server, so there is nothing to
                // delete there and nothing downstream worth sending. Drop the
                // create, everything targeting it, and the delete itself.
                candidate.retain(|queued| *queued.target() != target);
                return self.commit_queue(candidate);
            }
        }
        candidate.push(command);
        self.commit_queue(candidate)
    }

    /// Drop an acknowledged command — from the queue, and from the parked list
    /// if an interrupted retry left a copy there.
    ///
    /// ## Why the parked copy has to go with it
    ///
    /// [`Self::retry_dead_letter`] is a move across two files, ordered so that
    /// an interruption leaves the command in *both* rather than in neither. A
    /// duplicate is only tolerable while something still resolves it:
    /// [`Self::dead_letter`] resolves it by replacing the entry, and this is
    /// the other direction. Without it, the requeued copy succeeds and is
    /// dequeued while the parked one stays — a mutation the server has already
    /// applied, reported by Settings as waiting for review for good. Retrying
    /// that ghost is worse than cosmetic: the server's idempotency records
    /// expire after seven days, so a retry past that window genuinely
    /// re-executes the command, and for a create that is a second task.
    ///
    /// ## Why the parked copy goes *first*
    ///
    /// Same rule as the moves themselves: an interruption between the two
    /// writes must not lose the mutation. Dropping the parked copy while the
    /// queue still holds the command costs, at worst, a resend the server
    /// answers from its idempotency store. The other order is what creates the
    /// ghost this exists to prevent, and nothing later would look for it.
    ///
    /// ## Why the dequeue is committed rather than adopted
    ///
    /// The server has already applied the command by the time this is called,
    /// so the only remaining job is to stop sending it — and dropping it from
    /// memory before the write lands is how that job silently fails. The retry
    /// pass reads the in-memory queue, finds nothing left, and reports the
    /// engine idle while `queue.json` still holds the command. Nothing looks at
    /// it again until the next launch, and a relaunch past the server's
    /// seven-day idempotency window re-executes it for real: a second task for
    /// a create, a second edit for anything else. Leaving the command in memory
    /// when the write is refused keeps memory and disk saying the same thing,
    /// which is what lets the next pass retry the dequeue.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure, having changed neither collection in
    /// memory past the last write that landed.
    pub fn ack(&mut self, id: &str) -> Result<()> {
        if self.dead.iter().any(|entry| entry.command.id() == id) {
            let candidate = self
                .dead
                .iter()
                .filter(|entry| entry.command.id() != id)
                .cloned()
                .collect();
            self.commit_dead_letter(candidate)?;
        }
        let candidate = self
            .queue
            .iter()
            .filter(|queued| queued.id() != id)
            .cloned()
            .collect();
        self.commit_queue(candidate)
    }

    /// Rewrite every reference to `from` — in the queue **and** in the
    /// dead-letter list — to the server-assigned `to`.
    ///
    /// ## The dead-letter list is rewritten first, and that ordering is the
    /// crash safety
    ///
    /// This is two durable writes no host can make atomic, so the question is
    /// what the next launch reads when only the first one landed. Rewriting the
    /// queue first is the order that loses: the ack's alias is persisted by
    /// [`TaskStore::apply_server_ack`](crate::store::TaskStore::apply_server_ack)
    /// only after this call returns, so an interruption in the middle leaves a
    /// create durably rewritten to the real id with **no** record that the temp
    /// id ever meant it. The relaunch replays that create, remaps real → real,
    /// and the parked follower stays aimed at a temp id nothing can resolve —
    /// it fails every retry, for good.
    ///
    /// Rewriting the parked commands first cannot strand anything. The ack is
    /// proof the server task exists, so a follower pointing at it is already
    /// correct, and the queue still holding the temp id is exactly what makes
    /// the replayed create re-derive the alias and finish the move.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure, having changed neither collection in
    /// memory past the last write that landed.
    pub fn remap_task_id(&mut self, from: &TaskId, to: &TaskId) -> Result<()> {
        let mut dead_candidate = self.dead.clone();
        let mut dead_changed = false;
        for entry in &mut dead_candidate {
            if let Some(remapped) = remap_task_id(&entry.command, from, to) {
                entry.command = remapped;
                dead_changed = true;
            }
        }
        if dead_changed {
            self.commit_dead_letter(dead_candidate)?;
        }

        let mut candidate = self.queue.clone();
        let mut queue_changed = false;
        for command in &mut candidate {
            if let Some(remapped) = remap_task_id(command, from, to) {
                *command = remapped;
                queue_changed = true;
            }
        }
        if queue_changed {
            self.commit_queue(candidate)?;
        }
        Ok(())
    }

    /// Park a queued command for review.
    ///
    /// A no-op when the id is not queued, which is what makes the drain safe to
    /// re-enter: two passes cannot dead-letter the same command twice.
    ///
    /// ## The write order is the crash safety
    ///
    /// Parking a command is a move between two durable files, and no host
    /// storage can write both at once. The order is therefore chosen so that an
    /// interruption between them — a crash, a power loss, a failing second
    /// write — leaves the command in *both* files rather than in neither:
    /// the dead-letter list gains it first, and only then does the queue lose
    /// it. The user sees a parked command that is also still queued, and the
    /// next launch re-sends it.
    ///
    /// That re-send is **not** guaranteed to be a no-op. The server's
    /// idempotency middleware only replays stored *2xx* responses, so a command
    /// parked for a `400`/`422` re-executes on the server and fails again — and
    /// then arrives back here for an id that is already parked. Completing the
    /// interrupted move therefore means *replacing* that entry rather than
    /// appending beside it.
    ///
    /// Writing the queue first would make the same interruption erase the
    /// command from both collections, which is a lost offline mutation with
    /// nowhere left to inspect or retry it. [`Self::retry_dead_letter`] is the
    /// same move in the other direction and follows the same rule.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure. A failure to record the parked
    /// command leaves the queue untouched, so nothing is lost and the drain can
    /// try again.
    pub fn dead_letter(&mut self, id: &str, error: &Error) -> Result<()> {
        let Some((position, command)) = self
            .queue
            .iter()
            .enumerate()
            .find(|&(_, queued)| queued.id() == id)
            .map(|(position, queued)| (position, queued.clone()))
        else {
            return Ok(());
        };
        let entry = DeadLetterEntry {
            command,
            error: DeadLetterError::from(error),
            failed_at: self.clock.now_millis(),
        };
        // An interrupted earlier move already parked this id, and the command
        // is queued again only because the queue write never landed. Finishing
        // that move means replacing the entry, not appending a second one with
        // the same id: two entries would be two rows in the parked list for one
        // command, and discarding or retrying either would leave the other
        // behind.
        let mut candidate = self.dead.clone();
        match candidate
            .iter_mut()
            .find(|parked| parked.command.id() == id)
        {
            Some(parked) => *parked = entry,
            None => candidate.push(entry),
        }
        // The queue still holds the command, in memory and on disk, so a
        // refused write must leave the parked list exactly as it was — which is
        // what committing before adopting gives.
        self.commit_dead_letter(candidate)?;
        self.queue.remove(position);
        self.persist_queue()
    }

    /// Move a parked command back onto the tail of the queue.
    ///
    /// The destination is written before the source, for the reason spelled out
    /// on [`Self::dead_letter`]: an interruption mid-move must cost a duplicate,
    /// never the command. [`Self::ack`] is what retires the duplicate when the
    /// requeued copy succeeds.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure. A failure to record the requeued
    /// command leaves the dead-letter list untouched.
    pub fn retry_dead_letter(&mut self, id: &str) -> Result<()> {
        let Some((position, command)) = self
            .dead
            .iter()
            .enumerate()
            .find(|&(_, entry)| entry.command.id() == id)
            .map(|(position, entry)| (position, entry.command.clone()))
        else {
            return Ok(());
        };
        // An interrupted earlier retry already requeued this id, and the parked
        // entry survives only because the second write never landed. Finishing
        // that move means dropping the entry, not queueing a second copy: two
        // copies replay onto the visible view twice — a create would show as
        // two tasks — and only one of them is the mutation the user made.
        if !self.queue.iter().any(|queued| queued.id() == id) {
            self.queue.push(command);
            if let Err(failure) = self.persist_queue() {
                self.queue.pop();
                return Err(failure);
            }
        }
        let mut candidate = self.dead.clone();
        candidate.remove(position);
        self.commit_dead_letter(candidate)
    }

    /// Drop a parked command for good.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure, having changed nothing. Dropping the
    /// entry from memory first would make a refused write silently effective:
    /// the row is still on disk and still on the published snapshot, so the
    /// user's Retry would find nothing to requeue and report success, and the
    /// next dead-letter write of any kind would make the deletion durable.
    pub fn discard_dead_letter(&mut self, id: &str) -> Result<()> {
        let mut candidate = self.dead.clone();
        candidate.retain(|entry| entry.command.id() != id);
        self.commit_dead_letter(candidate)
    }

    /// Write a proposed queue, and adopt it only once the bytes are down.
    ///
    /// ## Why an addition may not touch `self.queue` first
    ///
    /// A refused write is reported to the caller, so the dispatch that asked
    /// for it fails and the shell tells the user their change was not recorded.
    /// If the command had already been pushed into the in-memory queue it would
    /// still be sitting there — invisible, unreported, and *not* on disk. The
    /// next successful write of any kind then persists it alongside whatever it
    /// was actually for, and the mutation the user was told had failed is
    /// suddenly queued as well.
    ///
    /// The concrete case is the quick-add panel, which now deliberately keeps a
    /// refused line in the field so it can be retried: retrying would mint a
    /// second command, and both would reach the server as distinct ids that the
    /// idempotency key cannot collapse.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure, having changed nothing.
    fn commit_queue(&mut self, candidate: Vec<Command>) -> Result<()> {
        let data = serde_json::to_string(&candidate).map_err(|error| {
            Error::invariant(format!("could not serialize the command queue: {error}"))
        })?;
        self.storage.write_queue(&data)?;
        self.queue = candidate;
        Ok(())
    }

    /// Write a proposed dead-letter list, and adopt it only once the bytes are
    /// down.
    ///
    /// The counterpart of [`Self::commit_queue`], for the same reason: a
    /// refused write is reported to the caller, and an entry left behind in
    /// memory would ride along on the next successful write of any kind.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure, having changed nothing.
    fn commit_dead_letter(&mut self, candidate: Vec<DeadLetterEntry>) -> Result<()> {
        let data = serde_json::to_string(&candidate).map_err(|error| {
            Error::invariant(format!("could not serialize the dead-letter list: {error}"))
        })?;
        self.storage.write_dead_letter(&data)?;
        self.dead = candidate;
        Ok(())
    }

    fn persist_queue(&self) -> Result<()> {
        let data = serde_json::to_string(&self.queue).map_err(|error| {
            Error::invariant(format!("could not serialize the command queue: {error}"))
        })?;
        self.storage.write_queue(&data)
    }
}

/// Parse a persisted list, refusing anything it cannot read in full.
///
/// ⚠️ **An entry that no longer parses is a refusal, not an absence.** This
/// read used to salvage per element, on the reasoning that the skipped bytes
/// were still on disk and so nothing was lost. They are not: the very next
/// write of that file — an ack, an enqueue, a parking — rewrites it in full
/// from what was salvaged, and the dropped entry is gone for good. What it
/// dropped is an offline mutation the user made or a parked change they were
/// about to decide on, and it went without a word.
///
/// Refusing keeps the bytes where they are, which is the only state from which
/// anything can still be done about them — a later release that can read the
/// shape, or a user deleting one file. Losing a launch to a loud error over a
/// file that still exists is recoverable; a silent deletion is not. This is the
/// same argument [`migrate_v1_queue`](crate::store::migrations::migrate_v1_queue)
/// makes, and the same one the store's `parse_id_counters` makes.
///
/// An absent or empty file is not bad data — it is a fresh install, and reads
/// as an empty list.
///
/// # Errors
///
/// [`Error::Invariant`] when a non-empty file is not a JSON array, or when any
/// element is not one this release can read.
fn parse_durable<T: serde::de::DeserializeOwned>(raw: Option<&str>, label: &str) -> Result<Vec<T>> {
    let Some(raw) = raw.filter(|value| !value.is_empty()) else {
        return Ok(Vec::new());
    };
    let unreadable = |detail: String| {
        Error::invariant(format!(
            "the persisted {label} exists but is unreadable, so the mutations it \
             holds cannot be replayed or reviewed: {detail}"
        ))
    };
    let parsed = serde_json::from_str::<Value>(raw)
        .map_err(|error| unreadable(format!("it is not valid JSON: {error}")))?;
    let Value::Array(items) = parsed else {
        return Err(unreadable("it is not a JSON array".to_owned()));
    };
    items
        .into_iter()
        .enumerate()
        .map(|(index, item)| {
            serde_json::from_value(item).map_err(|error| {
                unreadable(format!(
                    "entry {index} is not one this release can read: {error}"
                ))
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    };

    use super::{CommandQueue, DeadLetterEntry, parse_durable};
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
        /// Which of the two files were written, in order. A move between them
        /// is two writes no host can make atomic, so the order *is* the
        /// crash-safety argument and is worth asserting on directly.
        writes: Mutex<Vec<&'static str>>,
    }

    impl MemoryStorage {
        fn write_log(&self) -> Vec<&'static str> {
            self.writes.lock().unwrap().clone()
        }

        /// Forget the writes so far, so an ordering assertion can be about one
        /// operation rather than everything since construction.
        fn clear_write_log(&self) {
            self.writes.lock().unwrap().clear();
        }
    }

    impl QueueStorage for MemoryStorage {
        fn read_queue(&self) -> Result<Option<String>> {
            Ok(self.queue.lock().unwrap().clone())
        }
        fn write_queue(&self, data: &str) -> Result<()> {
            self.writes.lock().unwrap().push("queue");
            *self.queue.lock().unwrap() = Some(data.to_owned());
            Ok(())
        }
        fn read_dead_letter(&self) -> Result<Option<String>> {
            Ok(self.dead.lock().unwrap().clone())
        }
        fn write_dead_letter(&self, data: &str) -> Result<()> {
            self.writes.lock().unwrap().push("dead");
            *self.dead.lock().unwrap() = Some(data.to_owned());
            Ok(())
        }
    }

    /// Storage that refuses one of the two writes a move between the queue and
    /// the dead-letter list performs.
    ///
    /// The crash-safety cases need the *interruption*, not a storage outage:
    /// parking a command is two writes no host can make atomic, and the whole
    /// question is what the next launch reads when only the first one landed.
    #[derive(Default)]
    struct HalfWritingStorage {
        inner: MemoryStorage,
        refuse_queue: AtomicBool,
        refuse_dead: AtomicBool,
    }

    impl QueueStorage for HalfWritingStorage {
        fn read_queue(&self) -> Result<Option<String>> {
            self.inner.read_queue()
        }
        fn write_queue(&self, data: &str) -> Result<()> {
            if self.refuse_queue.load(Ordering::SeqCst) {
                return Err(Error::invariant("the queue file is not writable"));
            }
            self.inner.write_queue(data)
        }
        fn read_dead_letter(&self) -> Result<Option<String>> {
            self.inner.read_dead_letter()
        }
        fn write_dead_letter(&self, data: &str) -> Result<()> {
            if self.refuse_dead.load(Ordering::SeqCst) {
                return Err(Error::invariant("the dead-letter file is not writable"));
            }
            self.inner.write_dead_letter(data)
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

    /// ⚠️ **The invariant is "never in neither file", not "never twice".**
    ///
    /// Parking is a move across two files. Interrupt it after the first write
    /// and the next launch must still be able to see the mutation somewhere —
    /// with the writes in the other order it saw the command in neither, and an
    /// offline edit the user made simply stopped existing.
    #[test]
    fn an_interrupted_parking_costs_a_duplicate_rather_than_the_command() {
        let storage = Arc::new(HalfWritingStorage::default());
        let mut queue = CommandQueue::new(storage.clone(), Arc::new(FixedClock));
        queue.enqueue(create("c1", &temp("1-1"))).unwrap();

        // The parking write lands, the dequeue does not: the crash window.
        storage.refuse_queue.store(true, Ordering::SeqCst);
        queue
            .dead_letter("c1", &Error::api("nope", 422))
            .expect_err("the dequeue write failed");

        storage.refuse_queue.store(false, Ordering::SeqCst);
        let mut relaunched = CommandQueue::new(storage, Arc::new(FixedClock));
        relaunched.restore().unwrap();
        assert!(
            relaunched.contains_command_id("c1"),
            "the mutation survived the interruption"
        );
        assert_eq!(relaunched.dead_letters().len(), 1);
        assert_eq!(
            relaunched.pending().len(),
            1,
            "and it survived as a replayable duplicate, which the next park resolves"
        );
    }

    /// The other half of the interruption above: resolving the duplicate.
    ///
    /// The server's idempotency middleware only replays stored 2xx responses,
    /// so the replayed command genuinely re-executes and can fail permanently
    /// again. Parking it a second time must finish the interrupted move, not
    /// leave the user two parked rows for one command.
    #[test]
    fn re_parking_a_half_moved_command_replaces_its_entry() {
        let storage = Arc::new(HalfWritingStorage::default());
        let mut queue = CommandQueue::new(storage.clone(), Arc::new(FixedClock));
        queue.enqueue(create("c1", &temp("1-1"))).unwrap();

        storage.refuse_queue.store(true, Ordering::SeqCst);
        queue
            .dead_letter("c1", &Error::api("nope", 422))
            .expect_err("the dequeue write failed");
        storage.refuse_queue.store(false, Ordering::SeqCst);

        let mut relaunched = CommandQueue::new(storage, Arc::new(FixedClock));
        relaunched.restore().unwrap();
        relaunched
            .dead_letter("c1", &Error::api("still nope", 400))
            .unwrap();

        assert_eq!(
            relaunched.dead_letters().len(),
            1,
            "the move completed in place rather than appending a second row"
        );
        assert_eq!(
            relaunched
                .dead_letters()
                .first()
                .map(|entry| entry.error.message.as_str()),
            Some("still nope"),
            "and it carries the failure that actually parked it"
        );
        assert!(
            relaunched.pending().is_empty(),
            "the queue finally lost the command"
        );
    }

    /// ⚠️ A refused enqueue must leave *nothing* behind in memory.
    ///
    /// The leftover is invisible until the next successful write commits it for
    /// free, so the assertion that matters is the second one: a caller told its
    /// command was not recorded, retrying it, must not end up with two.
    #[test]
    fn a_refused_enqueue_keeps_the_command_out_of_memory() {
        let storage = Arc::new(HalfWritingStorage::default());
        let mut queue = CommandQueue::new(storage.clone(), Arc::new(FixedClock));

        storage.refuse_queue.store(true, Ordering::SeqCst);
        queue
            .enqueue(create("c1", &temp("1-1")))
            .expect_err("the enqueue write failed");
        assert!(queue.pending().is_empty(), "nothing was recorded");

        // The retry the caller is now entitled to make, against storage that
        // has recovered.
        storage.refuse_queue.store(false, Ordering::SeqCst);
        queue.enqueue(create("c2", &temp("1-2"))).unwrap();
        assert_eq!(
            queue.pending().len(),
            1,
            "the refused command must not ride along on the next successful write"
        );

        let mut relaunched = CommandQueue::new(storage, Arc::new(FixedClock));
        relaunched.restore().unwrap();
        assert_eq!(
            relaunched
                .pending()
                .iter()
                .map(Command::id)
                .collect::<Vec<_>>(),
            vec!["c2"],
            "and the bytes agree with memory"
        );
    }

    #[test]
    fn a_refused_parking_write_leaves_the_command_queued() {
        let storage = Arc::new(HalfWritingStorage::default());
        let mut queue = CommandQueue::new(storage.clone(), Arc::new(FixedClock));
        queue.enqueue(create("c1", &temp("1-1"))).unwrap();

        storage.refuse_dead.store(true, Ordering::SeqCst);
        queue
            .dead_letter("c1", &Error::api("nope", 422))
            .expect_err("the parking write failed");

        assert!(queue.dead_letters().is_empty(), "nothing was parked");
        assert_eq!(
            queue.pending().len(),
            1,
            "so the command is still queued, in memory as well as on disk"
        );
    }

    #[test]
    fn a_refused_retry_write_leaves_the_command_parked() {
        let storage = Arc::new(HalfWritingStorage::default());
        let mut queue = CommandQueue::new(storage.clone(), Arc::new(FixedClock));
        queue.enqueue(create("c1", &temp("1-1"))).unwrap();
        queue.dead_letter("c1", &Error::api("nope", 422)).unwrap();

        storage.refuse_queue.store(true, Ordering::SeqCst);
        queue
            .retry_dead_letter("c1")
            .expect_err("the requeue write failed");

        assert!(queue.pending().is_empty());
        assert_eq!(queue.dead_letters().len(), 1, "still inspectable");
    }

    /// ⚠️ A refused discard must leave the entry retryable.
    ///
    /// Dropping it from memory before the write would publish a snapshot that
    /// still shows the row while `retry_dead_letter` could no longer find it:
    /// the user's Retry would report success without requeueing anything, and
    /// the next successful dead-letter write would make the deletion durable.
    #[test]
    fn a_refused_discard_write_leaves_the_command_parked_and_retryable() {
        let storage = Arc::new(HalfWritingStorage::default());
        let mut queue = CommandQueue::new(storage.clone(), Arc::new(FixedClock));
        queue.enqueue(create("c1", &temp("1-1"))).unwrap();
        queue.dead_letter("c1", &Error::api("nope", 422)).unwrap();

        storage.refuse_dead.store(true, Ordering::SeqCst);
        queue
            .discard_dead_letter("c1")
            .expect_err("the discard write failed");
        storage.refuse_dead.store(false, Ordering::SeqCst);

        assert_eq!(queue.dead_letters().len(), 1, "still parked in memory");

        queue.retry_dead_letter("c1").unwrap();
        assert_eq!(
            queue.pending().iter().map(Command::id).collect::<Vec<_>>(),
            vec!["c1"],
            "so Retry requeues the command instead of silently doing nothing"
        );

        let mut relaunched = CommandQueue::new(storage, Arc::new(FixedClock));
        relaunched.restore().unwrap();
        assert_eq!(relaunched.pending().len(), 1);
        assert!(
            relaunched.dead_letters().is_empty(),
            "and the bytes agree with memory"
        );
    }

    /// Drive a retry to the point where only its first write landed, and hand
    /// back a relaunch that reads the command out of *both* files.
    fn interrupted_retry() -> (CommandQueue, Arc<HalfWritingStorage>) {
        let storage = Arc::new(HalfWritingStorage::default());
        let mut queue = CommandQueue::new(storage.clone(), Arc::new(FixedClock));
        queue.enqueue(create("c1", &temp("1-1"))).unwrap();
        queue.dead_letter("c1", &Error::api("nope", 422)).unwrap();

        // The requeue write lands, the un-parking does not: the crash window.
        storage.refuse_dead.store(true, Ordering::SeqCst);
        queue
            .retry_dead_letter("c1")
            .expect_err("the un-parking write failed");
        storage.refuse_dead.store(false, Ordering::SeqCst);

        let mut relaunched = CommandQueue::new(storage.clone(), Arc::new(FixedClock));
        relaunched.restore().unwrap();
        assert_eq!(
            relaunched.pending().len(),
            1,
            "the retry is durable, which is the half of the move that landed"
        );
        assert_eq!(
            relaunched.dead_letters().len(),
            1,
            "and so is the parked copy, which is the half that did not"
        );
        (relaunched, storage)
    }

    /// ⚠️ **A retry is a move too, and a succeeding retry has to finish it.**
    ///
    /// Interrupt one and the command is durable in both files. The queued copy
    /// is the live one; when the server accepts it, the parked copy must go as
    /// well. Left behind it is a mutation the server has already applied that
    /// Settings reports as waiting for review for good — and retrying it once
    /// the server's seven-day idempotency record has expired re-executes it,
    /// which for a create means a duplicate task.
    #[test]
    fn acking_a_retried_command_retires_the_parked_copy_it_was_moved_from() {
        let (mut queue, storage) = interrupted_retry();
        storage.inner.clear_write_log();

        queue.ack("c1").unwrap();

        assert!(queue.pending().is_empty(), "the accepted command is gone");
        assert!(
            queue.dead_letters().is_empty(),
            "and so is the copy the interrupted retry left parked"
        );
        assert_eq!(
            storage.inner.write_log(),
            vec!["dead", "queue"],
            "the parked copy goes first: an interruption here must cost a \
             resend the server deduplicates, never the ghost itself"
        );

        let mut relaunched = CommandQueue::new(storage, Arc::new(FixedClock));
        relaunched.restore().unwrap();
        assert!(!relaunched.contains_command_id("c1"), "on disk as well");
    }

    /// ⚠️ **A refused dequeue must stay retryable, or the server's idempotency
    /// window is the only thing standing between an ack and a duplicate.**
    ///
    /// Dropping the command from memory before the write lands leaves the drain
    /// with an empty queue and `queue.json` still holding it. The pass reports
    /// itself idle, nothing looks again until the next launch, and a relaunch
    /// past the seven-day idempotency record re-executes the command for real.
    #[test]
    fn a_refused_dequeue_leaves_the_acknowledged_command_queued() {
        let storage = Arc::new(HalfWritingStorage::default());
        let mut queue = CommandQueue::new(storage.clone(), Arc::new(FixedClock));
        queue.enqueue(create("c1", &temp("1-1"))).unwrap();
        queue.enqueue(set_status("c2", &temp("1-1"))).unwrap();

        storage.refuse_queue.store(true, Ordering::SeqCst);
        queue.ack("c1").expect_err("the dequeue write failed");
        storage.refuse_queue.store(false, Ordering::SeqCst);

        assert_eq!(
            queue.pending().iter().map(Command::id).collect::<Vec<_>>(),
            vec!["c1", "c2"],
            "memory still says what the disk says, so the pass can try again"
        );

        queue.ack("c1").unwrap();
        assert_eq!(
            queue.pending().iter().map(Command::id).collect::<Vec<_>>(),
            vec!["c2"]
        );

        let mut relaunched = CommandQueue::new(storage, Arc::new(FixedClock));
        relaunched.restore().unwrap();
        assert!(
            !relaunched.contains_command_id("c1"),
            "and the bytes agree, so no relaunch replays the acknowledged create"
        );
    }

    /// The other way the same duplicate is resolved: the user presses Retry on
    /// the row that is still showing. Finishing the interrupted move must not
    /// queue a *second* copy — two copies of one command replay onto the
    /// visible view twice, and a create would show as two tasks.
    #[test]
    fn retrying_a_half_moved_command_finishes_the_move_instead_of_duplicating_it() {
        let (mut queue, _) = interrupted_retry();

        queue.retry_dead_letter("c1").unwrap();

        assert_eq!(
            queue.pending().len(),
            1,
            "the command was already queued by the interrupted attempt"
        );
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

    /// ⚠️ **A durable entry this release cannot read is a refusal.**
    ///
    /// Skipping it and carrying on looks harmless — the bytes are still on
    /// disk — right up to the next ack or enqueue, which rewrites the whole
    /// file from what was salvaged. The mutation the user made offline is then
    /// gone, with nothing on screen having said so.
    #[test]
    fn an_entry_this_release_cannot_read_refuses_the_restore() {
        let raw = r#"[{"type":"delete","id":"c1","createdAt":1,"taskId":"Tasks/a.md"},
                      {"type":"delete","id":"c2","createdAt":1,"taskId":"not-a-note"}]"#;
        let refusal = parse_durable::<Command>(Some(raw), "command queue")
            .expect_err("entry 1 carries a task id this release cannot parse");
        assert!(
            refusal.message().contains("entry 1"),
            "the refusal has to say which entry: {}",
            refusal.message()
        );
    }

    #[test]
    fn a_queue_file_that_is_not_an_array_refuses_the_restore() {
        parse_durable::<Command>(Some("not json"), "command queue")
            .expect_err("a queue file that is not JSON at all");
        parse_durable::<Command>(Some("{}"), "command queue")
            .expect_err("a queue file that is not an array");
        parse_durable::<DeadLetterEntry>(Some("[{}]"), "dead-letter list")
            .expect_err("a parked entry with no command");
    }

    #[test]
    fn an_absent_or_empty_queue_file_is_a_fresh_install() {
        assert!(
            parse_durable::<Command>(None, "command queue")
                .unwrap()
                .is_empty()
        );
        assert!(
            parse_durable::<Command>(Some(""), "command queue")
                .unwrap()
                .is_empty()
        );
    }

    /// The refusal reaches the caller rather than presenting as an empty queue.
    #[test]
    fn restoring_over_an_unreadable_dead_letter_file_fails() {
        let storage = Arc::new(MemoryStorage::default());
        *storage.dead.lock().unwrap() = Some("[{\"nonsense\":true}]".to_owned());
        let mut queue = CommandQueue::new(storage, Arc::new(FixedClock));

        queue
            .restore()
            .expect_err("a parked change must not be silently dropped");
        assert!(
            queue.dead_letters().is_empty(),
            "and nothing half-read was adopted"
        );
    }

    /// ⚠️ **The remap is two files, and the parked half goes first.**
    ///
    /// `apply_server_ack` persists the temp → real alias before calling this,
    /// but an interruption between the two writes still has to leave the parked
    /// follower somewhere it can be retried. Rewriting the queue first is what
    /// stranded it: the create would be durably on the real id, the replay
    /// would remap real → real, and the follower would stay aimed at a temp id
    /// the server never knew.
    #[test]
    fn an_interrupted_remap_never_strands_a_parked_follower() {
        let storage = Arc::new(HalfWritingStorage::default());
        let mut queue = CommandQueue::new(storage.clone(), Arc::new(FixedClock));
        let temp_id = temp("1-1");
        let real = TaskId::parse("Tasks/real.md").unwrap();

        // A create still queued, and a follower that already dead-lettered.
        queue.enqueue(create("c1", &temp_id)).unwrap();
        queue.enqueue(set_status("c2", &temp_id)).unwrap();
        queue.dead_letter("c2", &Error::api("nope", 422)).unwrap();

        // The parked rewrite lands, the queue rewrite does not: the crash window.
        storage.refuse_queue.store(true, Ordering::SeqCst);
        queue
            .remap_task_id(&temp_id, &real)
            .expect_err("the queue write failed");
        storage.refuse_queue.store(false, Ordering::SeqCst);

        let mut relaunched = CommandQueue::new(storage, Arc::new(FixedClock));
        relaunched.restore().unwrap();
        assert_eq!(
            relaunched
                .dead_letters()
                .first()
                .map(|entry| entry.command.target().clone()),
            Some(real),
            "the parked follower points at the task the server actually made"
        );
        assert_eq!(
            relaunched.pending().first().map(Command::target),
            Some(&temp_id),
            "and the create still carries the temp id, so replaying it re-derives the alias"
        );
    }

    /// The in-memory half of the same rule.
    #[test]
    fn a_refused_remap_write_leaves_memory_agreeing_with_the_bytes() {
        let storage = Arc::new(HalfWritingStorage::default());
        let mut queue = CommandQueue::new(storage.clone(), Arc::new(FixedClock));
        let temp_id = temp("1-1");
        let real = TaskId::parse("Tasks/real.md").unwrap();
        queue.enqueue(create("c1", &temp_id)).unwrap();

        storage.refuse_queue.store(true, Ordering::SeqCst);
        queue
            .remap_task_id(&temp_id, &real)
            .expect_err("the queue write failed");

        assert_eq!(
            queue.pending().first().map(Command::target),
            Some(&temp_id),
            "a rewrite that was never persisted must not be visible in memory"
        );
    }
}
