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

use std::{mem, sync::Arc};

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
        let previous = mem::replace(&mut self.dead, candidate);
        if let Err(failure) = self.persist_dead_letter() {
            // The queue still holds the command, in memory and on disk, so
            // undoing the half-made move is what keeps the two collections
            // agreeing with the bytes.
            self.dead = previous;
            return Err(failure);
        }
        self.queue.remove(position);
        self.persist_queue()
    }

    /// Move a parked command back onto the tail of the queue.
    ///
    /// The destination is written before the source, for the reason spelled out
    /// on [`Self::dead_letter`]: an interruption mid-move must cost a duplicate,
    /// never the command.
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
        self.queue.push(command);
        if let Err(failure) = self.persist_queue() {
            self.queue.pop();
            return Err(failure);
        }
        self.dead.remove(position);
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
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    };

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
