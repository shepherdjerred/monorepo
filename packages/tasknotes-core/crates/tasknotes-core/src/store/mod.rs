//! The single source of truth the UI reads, and the durable state under it.
//!
//! `base` is the last server snapshot. The visible task map is **always**
//! `rebase(base, queue.pending)`, recomputed on every change and never
//! persisted. That is the whole offline-first invariant in one sentence: the
//! only durable writes are the id counters and the command queue (on dispatch,
//! in that order) and the base cache (on server acks and pulls), so no crash
//! can capture a half-applied optimistic state.
//!
//! Both of those write pairs are ordered, in opposite directions, and each
//! order is chosen so that a crash between the two writes costs a *replay*
//! rather than a *loss*: a dispatch spends the id before enqueuing the command
//! that carries it, and an ack persists the accepted base before dequeuing the
//! command that produced it.
//!
//! The store never touches the network. Executing commands is
//! [`SyncEngine`](crate::sync::SyncEngine)'s job; it reports results back
//! through [`TaskStore::apply_server_ack`] and [`TaskStore::replace_base`].
//!
//! Sans-I/O: storage is a trait the host implements
//! ([`TaskCacheStorage`](crate::sync::TaskCacheStorage)), so this module owns
//! the *shape* of persisted state and none of the mechanism.

mod completion_restores;
pub mod migrations;

use std::sync::Arc;

use indexmap::{IndexMap, IndexSet};
use serde_json::Value;

use crate::{
    Error, Result,
    domain::{Task, TaskId},
    net::InstanceRestore,
    store::completion_restores::{CompletionRestores, StoredCompletionRestore},
    sync::{
        Clock, Command, CommandInput, CommandQueue, DeadLetterEntry, QueueStorage, Randomness,
        TaskCacheStorage, command_id, rebase,
    },
};

/// Everything the UI reads, frozen at one instant.
///
/// Rebuilt in full on every mutation rather than patched, because a patched
/// projection is exactly where an optimistic update and a server ack drift
/// apart.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TaskStoreSnapshot {
    /// The visible tasks: the base snapshot with every pending command
    /// applied.
    pub tasks: IndexMap<TaskId, Task>,
    /// How many commands are waiting to be sent.
    pub pending_count: usize,
    /// Tasks with at least one unsynced command — the quiet trust signal the
    /// list rows render.
    pub pending_task_ids: IndexSet<TaskId>,
    /// Commands parked for review.
    pub dead_letters: Vec<DeadLetterEntry>,
    /// When the last successful pull completed, in epoch milliseconds.
    pub last_sync_time: Option<i64>,
}

/// The rebasing task store.
pub struct TaskStore {
    queue: CommandQueue,
    storage: Arc<dyn TaskCacheStorage>,
    clock: Arc<dyn Clock>,
    random: Arc<dyn Randomness>,
    base: IndexMap<TaskId, Task>,
    aliases: IndexMap<TaskId, TaskId>,
    restores: CompletionRestores,
    last_sync_time: Option<i64>,
    snapshot: TaskStoreSnapshot,
    counters: IdCounters,
}

/// The two id counters, as they are persisted.
///
/// Field names are the storage format, shared with the TypeScript client's
/// `id_counters` key. `u64` rather than the JSON-native float the other side
/// uses: a counter that silently stops incrementing past 2^53 is the same bug
/// this type exists to prevent, and the values are small enough that the
/// representations never disagree in practice.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct IdCounters {
    /// How many command ids have ever been minted on this install.
    command: u64,
    /// How many temp task ids have ever been minted on this install.
    temp: u64,
}

impl core::fmt::Debug for TaskStore {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter
            .debug_struct("TaskStore")
            .field("queue", &self.queue)
            .field("base", &self.base.len())
            .field("aliases", &self.aliases)
            .field("last_sync_time", &self.last_sync_time)
            .finish_non_exhaustive()
    }
}

impl TaskStore {
    /// Build an empty store over host-supplied storage.
    ///
    /// Nothing is read until [`TaskStore::restore`] runs.
    #[must_use]
    pub fn new(
        queue_storage: Arc<dyn QueueStorage>,
        cache_storage: Arc<dyn TaskCacheStorage>,
        clock: Arc<dyn Clock>,
        random: Arc<dyn Randomness>,
    ) -> Self {
        Self {
            queue: CommandQueue::new(queue_storage, Arc::clone(&clock)),
            storage: cache_storage,
            clock,
            random,
            base: IndexMap::new(),
            aliases: IndexMap::new(),
            restores: CompletionRestores::new(),
            last_sync_time: None,
            snapshot: TaskStoreSnapshot::default(),
            counters: IdCounters::default(),
        }
    }

    /// Load the queue, the cached base, the alias map, the retained completion
    /// restores, the id counters and the last sync time.
    ///
    /// Call once at startup, **after** [`migrations::run_migrations`].
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure.
    pub fn restore(&mut self) -> Result<()> {
        self.queue.restore()?;
        self.base = self
            .storage
            .read_tasks()?
            .into_iter()
            .map(|task| (task.id.clone(), task))
            .collect();
        self.aliases = parse_aliases(self.storage.read_id_aliases()?.as_deref());
        self.restores =
            completion_restores::parse(self.storage.read_completion_restores()?.as_deref())?;
        // Launch is the one moment the day is guaranteed to be re-read, and an
        // install that sat closed over a weekend is exactly how the map would
        // otherwise grow without bound.
        let today = self.today();
        completion_restores::prune(&mut self.restores, &today, &self.base);
        self.persist_restores()?;
        self.counters = parse_id_counters(self.storage.read_id_counters()?.as_deref())?;
        self.last_sync_time = self.storage.read_last_sync_time()?;
        self.recompute();
        Ok(())
    }

    /// Everything the UI reads.
    #[must_use]
    pub const fn snapshot(&self) -> &TaskStoreSnapshot {
        &self.snapshot
    }

    /// The durable queue, for the engine's drain loop.
    #[must_use]
    pub const fn queue(&self) -> &CommandQueue {
        &self.queue
    }

    /// The last server snapshot, before any pending command is applied.
    #[must_use]
    pub const fn base(&self) -> &IndexMap<TaskId, Task> {
        &self.base
    }

    /// The recorded temp-id → server-path aliases.
    #[must_use]
    pub const fn aliases(&self) -> &IndexMap<TaskId, TaskId> {
        &self.aliases
    }

    /// Follow the temp → real alias, if one was recorded.
    ///
    /// A UI surface holding an id from before a create was acked — an open
    /// detail pane, a deep link, a restored window — stays valid across the
    /// remap because of this.
    #[must_use]
    pub fn resolve_task_id(&self, id: &TaskId) -> TaskId {
        self.aliases.get(id).cloned().unwrap_or_else(|| id.clone())
    }

    /// Record a mutation and return the optimistic result immediately.
    ///
    /// The enqueue is the only wait — never the network. Returns the task as
    /// the UI will now see it, or `None` after a delete.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure.
    pub fn dispatch(&mut self, input: CommandInput) -> Result<Option<Task>> {
        let command = self.build_command(input)?;
        let target = command.target().clone();
        let consumed = consumed_restore_key(&command);
        // Counters first, queue second, and never the other way round: the id
        // has to be durably spent before the command carrying it can reach the
        // wire. Crashing after this write only burns id values, which is free;
        // crashing between the enqueue and this write would hand the id back
        // out — and that id is the server's `X-Mutation-Id`.
        self.persist_id_counters()?;
        self.queue.enqueue(command)?;
        // The retained snapshot has moved onto the queued uncompletion, so this
        // drops the copy. Deliberately *after* the enqueue: dropping it first
        // and then failing to enqueue would leave the user an undo that no
        // longer knows what to put back.
        if let Some(key) = consumed
            && self.restores.shift_remove(&key).is_some()
        {
            self.persist_restores()?;
        }
        self.recompute();
        Ok(self.snapshot.tasks.get(&target).cloned())
    }

    /// Merge a server-accepted command's result into the base and drop it from
    /// the queue.
    ///
    /// For a create this also records the temp → real alias and rewrites every
    /// queued *and dead-lettered* command that referenced the temp id.
    ///
    /// `server_task` is `None` for a delete, and for a delete that the server
    /// reports as already gone — both have reached the same goal state.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure.
    pub fn apply_server_ack(
        &mut self,
        command: &Command,
        server_task: Option<&Task>,
    ) -> Result<()> {
        // The schedule this command replaced, if it is a completion — read off
        // the command rather than from any local state, which is what makes a
        // replayed ack retain the same value the first attempt would have.
        let captured = acknowledged_restore(command);
        // Read before the base moves: this is a question about the state the
        // command was applied to, and the next few lines destroy it.
        let edited_occurrence = matches!(
            *command,
            Command::Update { ref task_id, ref payload, .. }
                if completion_restores::is_occurrence_edit(payload, self.base.get(task_id))
        );
        // Invalidation first, base second — the ordering `replace_base` uses,
        // for the same reason: the write that *invalidates* a snapshot has to
        // be durable before the write that makes it stale. Here the argument is
        // sharper, because a replay cannot repair the miss. `edited_occurrence`
        // is decided by comparing the payload against the *durable* base, so a
        // crash after that base learned the edit leaves a resent command
        // reading as no edit at all: the stale snapshot survives, and the next
        // uncompletion asks the server to rewind to a schedule the user already
        // replaced. Its own write costs a replay at worst.
        if edited_occurrence {
            completion_restores::invalidate_task(&mut self.restores, command.target());
            self.persist_restores()?;
        }
        if let Some(server_task) = server_task
            && let Command::Create { temp_id, .. } = command
        {
            self.aliases.insert(temp_id.clone(), server_task.id.clone());
            // The alias is written *before* anything is rewritten to the real
            // id, because it is the only durable record of what the temp id
            // meant. Rewriting first and crashing before this leaves commands
            // pointing at a task id whose origin nothing can reconstruct — an
            // open inspector or a deep link holding the temp id resolves to
            // nothing, and a parked follower still on it can never be repaired.
            // Writing it early costs nothing if the remap then fails: the ack
            // is proof the server task exists, so the alias is true either way,
            // and the command stays queued for the next drain to replay.
            self.persist_aliases()?;
            self.queue.remap_task_id(temp_id, &server_task.id)?;
        }
        if command.is_delete() {
            self.base.shift_remove(command.target());
        } else if let Some(server_task) = server_task {
            self.base
                .insert(server_task.id.clone(), server_task.clone());
        }
        // Base first, dequeue second, and never the other way round — the same
        // shape of argument as `dispatch`, with the writes in the opposite
        // order because the risk is opposite. Crashing between these two leaves
        // the accepted result durable *and* the command still queued, so the
        // next drain resends it and the server answers from its idempotency
        // store: the command id is the `X-Mutation-Id`, so a replay costs one
        // request. Acking first inverts that into data loss — `queue.json` no
        // longer holds the mutation and `tasks.json` never learned its result,
        // so an accepted create or update silently disappears (or an accepted
        // delete comes back) until some later successful pull happens to
        // repair the cache. The TypeScript `applyServerAck` orders these the
        // same way, and says so in a comment for the same reason.
        self.persist_base()?;
        // Safe to write *after* the base only because `captured` came off the
        // command. The replay this ordering deliberately allows re-enters here
        // with a base that already holds the advanced schedule, and anything
        // derived from that base would hand back the schedule the completion
        // produced as the one it replaced — silently leaving the occurrence
        // skipped after a later undo. The command still carries the real one.
        let today = self.today();
        completion_restores::prune(&mut self.restores, &today, &self.base);
        if let Some((key, restore)) = captured {
            self.restores
                .insert(key, StoredCompletionRestore { restore });
        }
        self.persist_restores()?;
        self.queue.ack(command.id())?;
        self.recompute();
        Ok(())
    }

    /// Park a command for review and roll back its optimistic effect.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure.
    pub fn dead_letter_command(&mut self, id: &str, error: &Error) -> Result<()> {
        self.queue.dead_letter(id, error)?;
        self.recompute();
        Ok(())
    }

    /// Move a parked command back onto the queue.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure.
    pub fn retry_dead_letter(&mut self, id: &str) -> Result<()> {
        self.queue.retry_dead_letter(id)?;
        self.recompute();
        Ok(())
    }

    /// Drop a parked command for good.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure.
    pub fn discard_dead_letter(&mut self, id: &str) -> Result<()> {
        self.queue.discard_dead_letter(id)?;
        self.recompute();
        Ok(())
    }

    /// Replace the base with a fresh full pull and prune stale aliases.
    ///
    /// An alias whose real task is no longer on the server is dropped: the
    /// note was deleted or renamed in Obsidian, and keeping the alias would
    /// silently redirect a future mutation at a path that does not exist.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure.
    pub fn replace_base(&mut self, tasks: Vec<Task>, synced_at: i64) -> Result<()> {
        let previous = core::mem::replace(
            &mut self.base,
            tasks
                .into_iter()
                .map(|task| (task.id.clone(), task))
                .collect(),
        );
        let stale: Vec<TaskId> = self
            .aliases
            .iter()
            .filter(|&(_, real)| !self.base.contains_key(real))
            .map(|(temp, _)| temp.clone())
            .collect();
        for temp in stale {
            self.aliases.shift_remove(&temp);
        }
        let today = self.today();
        completion_restores::prune(&mut self.restores, &today, &self.base);
        completion_restores::invalidate_changed(&mut self.restores, &previous, &self.base);
        self.last_sync_time = Some(synced_at);
        // Restores first, base second. A pull is the only place another client's
        // schedule edit becomes visible, and the write that *invalidates* a
        // snapshot has to be durable before the write that makes it stale. The
        // other order costs the user a wrong rewind after a crash: the relaunch
        // reads the pulled schedule alongside a retained snapshot that predates
        // it, and the next undo asks the server to go back to a schedule
        // somebody already replaced.
        self.persist_restores()?;
        self.persist_base()?;
        self.persist_aliases()?;
        self.storage.write_last_sync_time(synced_at)?;
        self.recompute();
        Ok(())
    }

    /// Mint the ids a [`CommandInput`] does not carry.
    ///
    /// The only place in the stack a command id or a temp id is created, so
    /// the two counters cannot drift.
    fn build_command(&mut self, input: CommandInput) -> Result<Command> {
        let created_at = self.clock.now_millis();
        let id = self.next_command_id(created_at)?;
        Ok(match input {
            CommandInput::Create { payload } => Command::Create {
                id,
                created_at,
                temp_id: self.next_temp_id(created_at)?,
                payload,
            },
            CommandInput::Update { task_id, payload } => Command::Update {
                id,
                created_at,
                task_id: self.resolve_task_id(&task_id),
                payload,
            },
            CommandInput::Delete { task_id } => Command::Delete {
                id,
                created_at,
                task_id: self.resolve_task_id(&task_id),
            },
            CommandInput::SetStatus { task_id, status } => Command::SetStatus {
                id,
                created_at,
                task_id: self.resolve_task_id(&task_id),
                status,
            },
            CommandInput::SetInstanceComplete {
                task_id,
                date,
                completed,
            } => {
                let task_id = self.resolve_task_id(&task_id);
                let restore = if completed {
                    self.completion_restore(&task_id, &date)
                } else {
                    self.instance_restore(&task_id, &date)
                };
                Command::SetInstanceComplete {
                    id,
                    created_at,
                    task_id,
                    date,
                    completed,
                    restore,
                }
            }
        })
    }

    /// The schedule a completion is about to replace, read from the view the
    /// user tapped.
    ///
    /// This is the *only* moment it is readable. The instant the command is
    /// enqueued the visible task is the rebased one, and the instant the ack
    /// lands the base holds the server's advanced schedule; neither is
    /// invertible. So it is captured here and carried on the command, which is
    /// what lets an ack replayed after a crash still retain the right value —
    /// see [`Command::SetInstanceComplete`]'s `restore`.
    ///
    /// `None` for a task with no rule, which has no series to advance and so
    /// nothing an undo could put back.
    fn completion_restore(&self, task_id: &TaskId, date: &str) -> Option<InstanceRestore> {
        completion_restores::snapshot(self.snapshot.tasks.get(task_id)?, date)
    }

    /// The schedule an uncompletion has to put back, if this install is the one
    /// that moved it.
    ///
    /// ## The two windows, and why there have to be two
    ///
    /// Completing an occurrence makes the *server* advance the series;
    /// [`apply_command`](crate::sync::apply_command) deliberately does not, so
    /// while the completion is still queued the visible task still carries the
    /// pre-completion `scheduled`, `due`, and rule. **That is the first
    /// window**, and it covers complete-then-undo before the queue drains: the
    /// two commands are sent back to back, the first advancing a schedule the
    /// second must restore.
    ///
    /// The moment the completion is acknowledged that window shuts — the
    /// command is gone and the base holds the *advanced* schedule, which is not
    /// invertible. But undo is not a five-second affordance: unticking
    /// yesterday's habit an hour later is the ordinary case, and a bare
    /// uncompletion makes the server keep its advanced schedule, so the
    /// occurrence reads as undone while the series has silently skipped a
    /// period. **The second window is therefore durable**: the ack moves the
    /// snapshot into [`completion_restores`], and this reads it back. The
    /// TypeScript client retains acknowledged restores the same way and for the
    /// same reason.
    ///
    /// With neither window there is nothing to undo that this install caused —
    /// the occurrence was completed on another client, or the snapshot was
    /// invalidated because something moved the schedule since. Sending a
    /// snapshot in either case would ask the server to rewind past an edit it
    /// already has, so the uncompletion goes bare and the server keeps its own
    /// schedule, which is the documented compatibility behaviour.
    fn instance_restore(&self, task_id: &TaskId, date: &str) -> Option<InstanceRestore> {
        let pending = self.queue.pending();
        let advancing = pending
            .iter()
            .enumerate()
            .rev()
            .find_map(|(position, command)| match *command {
                Command::SetInstanceComplete {
                    task_id: ref queued,
                    date: ref day,
                    completed: true,
                    restore: Some(ref carried),
                    ..
                } if queued == task_id && day == date => Some((position, carried.clone())),
                _ => None,
            });
        if let Some((position, carried)) = advancing {
            // Read off the completion itself, never recomputed from the current
            // view: the completion captured what it replaced when it was
            // dispatched, and every later reading — a rebased snapshot carrying
            // commands queued after it, or a base a pull has moved on — answers
            // a different question.
            //
            // The state the completion found is still needed, but only to judge
            // what came after it.
            let at_completion = self.task_through(position, task_id)?;
            // A later queued edit is disqualifying in its own right. It has not
            // reached the server, so the snapshot still describes what the
            // server holds — but sending it would rewind the unsent edit along
            // with the completion.
            if pending.iter().skip(position + 1).any(|command| {
                matches!(
                    command,
                    Command::Update { task_id: queued, payload, .. }
                        if queued == task_id
                            && completion_restores::is_occurrence_edit(
                                payload,
                                Some(&at_completion),
                            )
                )
            }) {
                return None;
            }
            return Some(carried);
        }
        // A queued edit to the rule or either date has not reached the server
        // yet, so a retained snapshot still describes what the server holds —
        // but it no longer describes what the user is looking at, and sending it
        // would rewind their unsent edit as well as the completion.
        let edited = self.queue.pending().iter().any(|command| {
            matches!(
                command,
                Command::Update { task_id: queued, payload, .. }
                    if queued == task_id
                        && completion_restores::is_occurrence_edit(payload, self.base.get(task_id))
            )
        });
        if edited || date < self.today().as_str() {
            return None;
        }
        self.restores
            .get(&completion_restores::key(task_id, date))
            .map(|stored| stored.restore.clone())
    }

    /// The task as the command at `position` found it: the base with every
    /// *earlier* pending command replayed onto it, and nothing queued after it.
    fn task_through(&self, position: usize, task_id: &TaskId) -> Option<Task> {
        rebase(&self.base, self.queue.pending().iter().take(position))
            .get(task_id)
            .cloned()
    }

    /// The host's local day, as `YYYY-MM-DD`.
    fn today(&self) -> String {
        self.clock.local_ymd(self.clock.now_millis())
    }

    /// Mint a command id that has never been minted on this install.
    ///
    /// ## The counter is the fix; the check is the backstop
    ///
    /// The id is the server's `X-Mutation-Id`, so re-minting a live one does
    /// not merely duplicate work — the server answers the *second* command from
    /// the *first* one's stored response, and the second mutation is silently
    /// never applied. Generated-sequence testing found this in three
    /// transitions: create, relaunch, create.
    ///
    /// **The persisted counter is what removes the collision class.** It is
    /// written before the enqueue and never restarts, so the same
    /// `(millis, counter)` pair is never offered twice on this install.
    ///
    /// **The durable-set check cannot do that job**, which is why it is no
    /// longer the primary mechanism: it only sees ids the client *still holds*.
    /// An id that has already been acked and dequeued is gone locally while the
    /// server's idempotency store still remembers it, so a re-mint of that id is
    /// invisible here. The check remains for the one state a counter cannot
    /// describe: the first launch after upgrading from a build that never wrote
    /// the counters. It deliberately does **not** cover a counter blob that
    /// failed to parse — see [`parse_id_counters`], which now refuses to
    /// restore rather than handing this check a job it cannot do.
    ///
    /// The loop terminates: the counter strictly increases, the id is injective
    /// in the counter at a fixed instant, and the durable set is finite.
    fn next_command_id(&mut self, created_at: i64) -> Result<String> {
        loop {
            self.counters.command = self.counters.command.checked_add(1).ok_or_else(|| {
                Error::invariant("the command counter overflowed; the queue cannot mint an id")
            })?;
            let candidate = command_id(
                created_at,
                self.counters.command,
                self.random.next_unit_ppm(),
            );
            if !self.queue.contains_command_id(&candidate) {
                return Ok(candidate);
            }
        }
    }

    /// Mint a temp id that has never been minted on this install.
    ///
    /// The same persisted-counter-plus-backstop structure as
    /// [`TaskStore::next_command_id`], with a different consequence for a
    /// collision: a temp id that lands on an unsent create's would merge two
    /// optimistic tasks into one, and acking either would remap both.
    fn next_temp_id(&mut self, created_at: i64) -> Result<TaskId> {
        loop {
            self.counters.temp = self.counters.temp.checked_add(1).ok_or_else(|| {
                Error::invariant("the temp-id counter overflowed; the store cannot mint an id")
            })?;
            let candidate = TaskId::temp(created_at, self.counters.temp);
            if !self.base.contains_key(&candidate) && !self.queue.targets(&candidate) {
                return Ok(candidate);
            }
        }
    }

    fn recompute(&mut self) {
        self.snapshot = TaskStoreSnapshot {
            tasks: rebase(&self.base, self.queue.pending()),
            pending_count: self.queue.pending().len(),
            pending_task_ids: self
                .queue
                .pending()
                .iter()
                .map(|command| command.target().clone())
                .collect(),
            dead_letters: self.queue.dead_letters().to_vec(),
            last_sync_time: self.last_sync_time,
        };
    }

    fn persist_base(&self) -> Result<()> {
        let tasks: Vec<Task> = self.base.values().cloned().collect();
        self.storage.write_tasks(&tasks)
    }

    fn persist_aliases(&self) -> Result<()> {
        let record: IndexMap<&str, &str> = self
            .aliases
            .iter()
            .map(|(temp, real)| (temp.as_str(), real.as_str()))
            .collect();
        let data = serde_json::to_string(&record).map_err(|error| {
            Error::invariant(format!("could not serialize the id aliases: {error}"))
        })?;
        self.storage.write_id_aliases(&data)
    }

    fn persist_id_counters(&self) -> Result<()> {
        let data = serde_json::to_string(&self.counters).map_err(|error| {
            Error::invariant(format!("could not serialize the id counters: {error}"))
        })?;
        self.storage.write_id_counters(&data)
    }

    fn persist_restores(&self) -> Result<()> {
        self.storage
            .write_completion_restores(&completion_restores::serialize(&self.restores)?)
    }
}

/// The snapshot an acknowledged completion replaced, keyed for storage.
///
/// Entirely a function of the command, deliberately: the ack persists the
/// accepted base *before* dequeuing the command, so an interrupted ack is
/// replayed against a base that already holds the advanced schedule. Deriving
/// the snapshot from local state would answer that replay with the schedule the
/// completion produced — a snapshot that looks valid, survives invalidation
/// because it matches the server, and makes a later undo ask for a rewind that
/// leaves the occurrence skipped. Reading the command instead makes the replay
/// idempotent, which is what the TypeScript client's `command.restore` does.
fn acknowledged_restore(command: &Command) -> Option<(String, InstanceRestore)> {
    match *command {
        Command::SetInstanceComplete {
            ref task_id,
            ref date,
            completed: true,
            restore: Some(ref restore),
            ..
        } => Some((completion_restores::key(task_id, date), restore.clone())),
        _ => None,
    }
}

/// The retained snapshot a freshly built command takes ownership of, if any.
///
/// Only an uncompletion that is actually carrying one: an uncompletion that
/// found no snapshot has nothing to consume, and dropping the entry anyway
/// would throw away an undo the *next* attempt could still have used.
fn consumed_restore_key(command: &Command) -> Option<String> {
    match *command {
        Command::SetInstanceComplete {
            ref task_id,
            ref date,
            completed: false,
            restore: Some(_),
            ..
        } => Some(completion_restores::key(task_id, date)),
        _ => None,
    }
}

/// Parse the persisted id counters. **Absent** means zero; present-and-invalid
/// is an error.
///
/// Absent is the ordinary case and needs no schema migration: a fresh install
/// and an install carried over from a build that predates this slot both have
/// no ids to describe, and
/// [`TaskStore::next_command_id`] / [`TaskStore::next_temp_id`] cover them by
/// refusing to mint an id the restored queue already holds.
///
/// ⚠️ **A file that exists but does not parse is a different fact, and it must
/// not be rounded down to zero.** That file is the only record of which ids
/// this install has already spent, and the mint-and-check backstop cannot
/// stand in for it: the backstop looks at the live queue and dead-letter list,
/// which by construction no longer contain anything that was acknowledged and
/// dequeued, and it never looks at the alias map at all. So restarting at zero
/// after the clock revisits a millisecond can mint a temp id equal to an
/// already-acked create's, and [`TaskStore::resolve_task_id`] will then follow
/// the stale alias and send the new optimistic task's edits to the *older*
/// server task. Losing a launch to a loud error the user can clear by deleting
/// one file is recoverable; silently editing the wrong note is not.
fn parse_id_counters(raw: Option<&str>) -> Result<IdCounters> {
    let Some(raw) = raw else {
        return Ok(IdCounters::default());
    };
    serde_json::from_str::<IdCounters>(raw).map_err(|error| {
        Error::invariant(format!(
            "the persisted id counters exist but are unreadable, so the ids this \
             install has already spent are unknown: {error}"
        ))
    })
}

/// Parse the persisted alias map, keeping every entry that still parses.
///
/// Lossy, deliberately unlike [`CommandQueue::restore`], because what it can
/// drop is a different kind of thing. A queued or parked command is a mutation
/// only that file holds, so losing one loses the user's work — hence the
/// refusal there. An alias is a pointer to a create the server already
/// accepted, and the commands that followed it were rewritten to the real id at
/// ack time; a dropped entry therefore costs a temp id that no longer resolves
/// for a window still holding one, never a mutation nobody can replay.
fn parse_aliases(raw: Option<&str>) -> IndexMap<TaskId, TaskId> {
    let Some(raw) = raw.filter(|value| !value.is_empty()) else {
        return IndexMap::new();
    };
    let Ok(Value::Object(entries)) = serde_json::from_str::<Value>(raw) else {
        return IndexMap::new();
    };
    entries
        .into_iter()
        .filter_map(|(temp, real)| {
            let real = real.as_str()?;
            Some((TaskId::parse(temp).ok()?, TaskId::parse(real).ok()?))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    };

    use super::{IdCounters, TaskStore, parse_aliases, parse_id_counters};
    use crate::{
        Error, Result,
        domain::{CreateTaskRequest, Task, TaskId, TaskStatus, TaskTitle, UpdateTaskRequest},
        net::InstanceRestore,
        sync::{Clock, Command, CommandInput, QueueStorage, Randomness, TaskCacheStorage},
    };

    #[derive(Default)]
    struct Memory {
        queue: Mutex<Option<String>>,
        dead: Mutex<Option<String>>,
        tasks: Mutex<Vec<Task>>,
        aliases: Mutex<Option<String>>,
        counters: Mutex<Option<String>>,
        restores: Mutex<Option<String>>,
        last_sync: Mutex<Option<i64>>,
        /// Which durable slots were written, in order. The dispatch path's
        /// crash-safety argument is entirely about this order.
        writes: Mutex<Vec<&'static str>>,
        /// Refuse any restore write that follows a base write, so a test can
        /// interrupt an operation at exactly the point its ordering argument is
        /// about. Judged against [`Memory::writes`], so a test arms it after
        /// [`Memory::clear_write_log`] and the "follows" is about this
        /// operation rather than the whole session.
        refuse_restores_after_base: AtomicBool,
    }

    impl Memory {
        /// Forget the id counters while keeping every other durable byte.
        ///
        /// This is the upgrade path, exactly: a queue carried over from a build
        /// that never wrote the counters.
        fn forget_id_counters(&self) {
            *self.counters.lock().unwrap() = None;
        }

        fn write_log(&self) -> Vec<&'static str> {
            self.writes.lock().unwrap().clone()
        }

        /// Forget the writes so far, so an ordering assertion can be about one
        /// operation rather than about everything since construction.
        fn clear_write_log(&self) {
            self.writes.lock().unwrap().clear();
        }

        fn record(&self, slot: &'static str) {
            self.writes.lock().unwrap().push(slot);
        }

        /// Stop writing restores once the base has been written, and start
        /// again.
        fn refuse_restores_after_base(&self, refuse: bool) {
            self.refuse_restores_after_base
                .store(refuse, Ordering::SeqCst);
        }

        /// Whether this write is the one a test armed the refusal for.
        fn refusing_restores(&self) -> bool {
            self.refuse_restores_after_base.load(Ordering::SeqCst)
                && self.writes.lock().unwrap().contains(&"tasks")
        }
    }

    impl QueueStorage for Memory {
        fn read_queue(&self) -> Result<Option<String>> {
            Ok(self.queue.lock().unwrap().clone())
        }
        fn write_queue(&self, data: &str) -> Result<()> {
            self.record("queue");
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

    impl TaskCacheStorage for Memory {
        fn read_tasks(&self) -> Result<Vec<Task>> {
            Ok(self.tasks.lock().unwrap().clone())
        }
        fn write_tasks(&self, tasks: &[Task]) -> Result<()> {
            self.record("tasks");
            *self.tasks.lock().unwrap() = tasks.to_vec();
            Ok(())
        }
        fn read_id_aliases(&self) -> Result<Option<String>> {
            Ok(self.aliases.lock().unwrap().clone())
        }
        fn write_id_aliases(&self, data: &str) -> Result<()> {
            *self.aliases.lock().unwrap() = Some(data.to_owned());
            Ok(())
        }
        fn read_id_counters(&self) -> Result<Option<String>> {
            Ok(self.counters.lock().unwrap().clone())
        }
        fn write_id_counters(&self, data: &str) -> Result<()> {
            self.record("id_counters");
            *self.counters.lock().unwrap() = Some(data.to_owned());
            Ok(())
        }
        fn read_completion_restores(&self) -> Result<Option<String>> {
            Ok(self.restores.lock().unwrap().clone())
        }
        fn write_completion_restores(&self, data: &str) -> Result<()> {
            if self.refusing_restores() {
                return Err(Error::invariant("the completion restores are not writable"));
            }
            self.record("completion_restores");
            *self.restores.lock().unwrap() = Some(data.to_owned());
            Ok(())
        }
        fn read_last_sync_time(&self) -> Result<Option<i64>> {
            Ok(*self.last_sync.lock().unwrap())
        }
        fn write_last_sync_time(&self, millis: i64) -> Result<()> {
            *self.last_sync.lock().unwrap() = Some(millis);
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

    struct HalfUnit;
    impl Randomness for HalfUnit {
        fn next_unit_ppm(&self) -> u32 {
            500_000
        }
    }

    fn store() -> (TaskStore, Arc<Memory>) {
        let memory = Arc::new(Memory::default());
        (
            TaskStore::new(
                memory.clone(),
                memory.clone(),
                Arc::new(FixedClock),
                Arc::new(HalfUnit),
            ),
            memory,
        )
    }

    fn task(id: &str) -> Task {
        serde_json::from_value(serde_json::json!({
            "id": id, "path": id, "title": "Test",
        }))
        .unwrap()
    }

    #[test]
    fn the_visible_view_is_the_base_plus_the_queue_and_is_never_persisted() {
        let (mut store, memory) = store();
        store.replace_base(vec![task("Tasks/a.md")], 1).unwrap();
        store
            .dispatch(CommandInput::SetStatus {
                task_id: TaskId::parse("Tasks/a.md").unwrap(),
                status: TaskStatus::Done,
            })
            .unwrap();

        let visible = store
            .snapshot()
            .tasks
            .get(&TaskId::parse("Tasks/a.md").unwrap())
            .unwrap();
        assert_eq!(visible.status, TaskStatus::Done, "the view is rebased");

        let persisted = memory.tasks.lock().unwrap().clone();
        assert_eq!(
            persisted.first().map(|entry| entry.status),
            Some(TaskStatus::Open),
            "only the base is durable — the optimistic status must not be"
        );
    }

    fn recurring(id: &str) -> Task {
        serde_json::from_value(serde_json::json!({
            "id": id, "path": id, "title": "Water the plants",
            "recurrence": "FREQ=WEEKLY;BYDAY=SA",
            "scheduled": "2026-07-04",
            "due": "2026-07-05",
        }))
        .unwrap()
    }

    fn restore_of(command: &Command) -> Option<InstanceRestore> {
        match *command {
            Command::SetInstanceComplete { ref restore, .. } => restore.clone(),
            _ => None,
        }
    }

    /// ⚠️ **The reported bug, as two taps.** Complete an occurrence and undo it
    /// before the queue drains — a double-click, or a mis-tap on a phone that is
    /// offline. Both commands are queued, and they are sent back to back: the
    /// first makes the server advance the series, and the second has to put the
    /// old schedule back. A bare `completed: false` cannot, because the server
    /// deliberately keeps its advanced schedule for a client that never
    /// advanced one — so the occurrence reads as undone while the series has
    /// silently skipped a week.
    #[test]
    fn an_undo_before_the_queue_drains_carries_the_schedule_it_has_to_put_back() {
        let (mut store, _) = store();
        let id = TaskId::parse("Tasks/plants.md").unwrap();
        store
            .replace_base(vec![recurring("Tasks/plants.md")], 1)
            .unwrap();

        store
            .dispatch(CommandInput::SetInstanceComplete {
                task_id: id.clone(),
                date: "2026-07-04".to_owned(),
                completed: true,
            })
            .unwrap();
        store
            .dispatch(CommandInput::SetInstanceComplete {
                task_id: id.clone(),
                date: "2026-07-04".to_owned(),
                completed: false,
            })
            .unwrap();

        let pending = store.queue().pending();
        assert_eq!(
            restore_of(pending.first().unwrap()),
            Some(pre_completion_schedule()),
            "the completion records what it is about to replace, so an ack \
             replayed against an already-advanced base still knows it"
        );
        assert_eq!(
            restore_of(pending.get(1).unwrap()),
            Some(pre_completion_schedule())
        );
        assert_eq!(
            pending
                .first()
                .unwrap()
                .instance_completion()
                .and_then(|instance| instance.restore),
            None,
            "but it stays local — the server rejects a restore beside a \
             completion outright"
        );

        let visible = store.snapshot().tasks.get(&id).unwrap();
        assert!(visible.complete_instances.is_empty());
        assert_eq!(
            visible.scheduled.as_deref(),
            Some("2026-07-04"),
            "and the optimistic view shows what the server will end up with"
        );
    }

    /// With no completion of this occurrence still queued there is nothing this
    /// install is about to advance: the occurrence was completed elsewhere, or
    /// the completion is already acked and the local schedule is the *advanced*
    /// one. Sending that as a restore would ask the server to rewind to a
    /// schedule it never left.
    #[test]
    fn an_undo_with_no_completion_in_flight_carries_no_snapshot() {
        let (mut store, _) = store();
        let id = TaskId::parse("Tasks/plants.md").unwrap();
        let mut seeded = recurring("Tasks/plants.md");
        seeded.complete_instances.push("2026-07-04".to_owned());
        store.replace_base(vec![seeded], 1).unwrap();

        store
            .dispatch(CommandInput::SetInstanceComplete {
                task_id: id,
                date: "2026-07-04".to_owned(),
                completed: false,
            })
            .unwrap();

        assert_eq!(restore_of(store.queue().head().unwrap()), None);
    }

    /// Complete an occurrence, let the ack land, and drive the store to the
    /// state a later undo starts from.
    fn completed_and_acked() -> (TaskStore, Arc<Memory>) {
        let (mut store, memory) = store();
        let id = TaskId::parse("Tasks/plants.md").unwrap();
        store
            .replace_base(vec![recurring("Tasks/plants.md")], 1)
            .unwrap();
        store
            .dispatch(CommandInput::SetInstanceComplete {
                task_id: id,
                date: "2026-07-04".to_owned(),
                completed: true,
            })
            .unwrap();

        let command = store.queue().head().unwrap().clone();
        store.apply_server_ack(&command, Some(&advanced())).unwrap();
        (store, memory)
    }

    /// What the server does to a completed occurrence: the series moves on a
    /// week, and the pre-completion dates are gone from everything durable.
    fn advanced() -> Task {
        let mut advanced = recurring("Tasks/plants.md");
        advanced.complete_instances.push("2026-07-04".to_owned());
        advanced.scheduled = Some("2026-07-11".to_owned());
        advanced.due = Some("2026-07-12".to_owned());
        advanced
    }

    fn pre_completion_schedule() -> InstanceRestore {
        InstanceRestore {
            scheduled: Some("2026-07-04".to_owned()),
            due: Some("2026-07-05".to_owned()),
            recurrence: "FREQ=WEEKLY;BYDAY=SA".to_owned(),
            skipped: false,
        }
    }

    fn undo(store: &mut TaskStore) -> Option<InstanceRestore> {
        store
            .dispatch(CommandInput::SetInstanceComplete {
                task_id: TaskId::parse("Tasks/plants.md").unwrap(),
                date: "2026-07-04".to_owned(),
                completed: false,
            })
            .unwrap();
        restore_of(store.queue().pending().last().unwrap())
    }

    /// ⚠️ **The same bug, one sync later.** Unticking yesterday's habit is not a
    /// double-click; it happens long after the queue drained. By then the
    /// completion is off the queue and the base holds the *advanced* schedule,
    /// so nothing readable describes what the completion replaced. A bare
    /// uncompletion makes the server keep its advanced schedule, and the
    /// occurrence reads as undone while the series has skipped a week — so the
    /// ack has to have retained the snapshot.
    #[test]
    fn an_undo_after_the_completion_synced_still_carries_the_schedule() {
        let (mut store, _) = completed_and_acked();
        assert_eq!(undo(&mut store), Some(pre_completion_schedule()));
    }

    /// ⚠️ **The window this store deliberately leaves open.** The accepted base
    /// is made durable *before* the command is dequeued, so a crash in between
    /// leaves the advanced schedule on disk with the completion still queued,
    /// and the next drain resends it. That replay is the whole point — the
    /// server answers it from its idempotency store and nothing is lost — but
    /// it re-enters `apply_server_ack` against a base that has already moved.
    ///
    /// Deriving the retained snapshot there would read the *advanced* schedule
    /// and store it as the one the completion replaced. Nothing would ever
    /// catch it: it matches what the server holds, so no invalidation rule
    /// fires, and the undo an hour later asks the server to rewind to where it
    /// already is — the occurrence reads as undone while the series keeps the
    /// week it skipped. The command carrying its own snapshot is what makes the
    /// replay idempotent instead.
    #[test]
    fn a_completion_replayed_after_its_base_advanced_retains_what_it_replaced() {
        let (mut store, memory) = store();
        store
            .replace_base(vec![recurring("Tasks/plants.md")], 1)
            .unwrap();
        store
            .dispatch(CommandInput::SetInstanceComplete {
                task_id: TaskId::parse("Tasks/plants.md").unwrap(),
                date: "2026-07-04".to_owned(),
                completed: true,
            })
            .unwrap();
        let completion = store.queue().head().unwrap().clone();

        // Interrupt the ack after the base write, which is exactly the window
        // the base-before-dequeue ordering creates.
        memory.clear_write_log();
        memory.refuse_restores_after_base(true);
        assert!(
            store
                .apply_server_ack(&completion, Some(&advanced()))
                .is_err(),
            "the interruption has to land after the base write, or this test \
             is about nothing"
        );
        memory.refuse_restores_after_base(false);
        drop(store);

        let mut relaunched = relaunch(&memory);
        assert_eq!(
            relaunched
                .base()
                .get(&TaskId::parse("Tasks/plants.md").unwrap()),
            Some(&advanced()),
            "the relaunch reads the advanced schedule, and nothing local still \
             knows what preceded it"
        );
        let replayed = relaunched.queue().head().unwrap().clone();
        relaunched
            .apply_server_ack(&replayed, Some(&advanced()))
            .unwrap();

        assert_eq!(undo(&mut relaunched), Some(pre_completion_schedule()));
    }

    #[test]
    fn a_retained_snapshot_survives_relaunch_and_is_spent_only_once() {
        let (store, memory) = completed_and_acked();
        drop(store);

        let mut relaunched = TaskStore::new(
            memory.clone(),
            memory.clone(),
            Arc::new(FixedClock),
            Arc::new(HalfUnit),
        );
        relaunched.restore().unwrap();
        assert_eq!(undo(&mut relaunched), Some(pre_completion_schedule()));

        // The queued uncompletion now owns the snapshot. A second undo of the
        // same occurrence must not send it again: the first one already asked
        // the server to rewind, and re-sending would rewind past whatever
        // happened since.
        assert_eq!(undo(&mut relaunched), None);
    }

    /// An acked edit to the rule or either date means the server no longer holds
    /// the schedule the snapshot claims to put back, so sending it would rewind
    /// the user's own edit.
    #[test]
    fn an_acknowledged_occurrence_edit_drops_the_retained_snapshot() {
        let (mut store, _) = completed_and_acked();
        let id = TaskId::parse("Tasks/plants.md").unwrap();
        store
            .dispatch(CommandInput::Update {
                task_id: id.clone(),
                payload: UpdateTaskRequest {
                    recurrence: crate::domain::FieldUpdate::Set("FREQ=MONTHLY".to_owned()),
                    ..UpdateTaskRequest::default()
                },
            })
            .unwrap();
        assert_eq!(
            undo(&mut store),
            None,
            "an unsent edit already contradicts the snapshot"
        );
    }

    /// ⚠️ **The one window a replay cannot close.** Every other pair of writes
    /// in `apply_server_ack` survives a crash between them because the command
    /// is still queued and the resend repairs it. This pair does not: whether
    /// the ack invalidates is decided by comparing its payload against the
    /// *durable* base, so once that base holds the edit the resent command
    /// reads as touching nothing, and the snapshot the edit made false lives on
    /// to rewind a schedule the user already replaced.
    ///
    /// So the interruption is the test. The restore write that follows the base
    /// write is refused, the store is thrown away, and the relaunch is asked
    /// what an undo would now send.
    #[test]
    fn an_acknowledged_occurrence_edit_invalidates_before_the_base_makes_it_stale() {
        let (mut store, memory) = completed_and_acked();
        store
            .dispatch(CommandInput::Update {
                task_id: TaskId::parse("Tasks/plants.md").unwrap(),
                payload: UpdateTaskRequest {
                    scheduled: crate::domain::FieldUpdate::Set("2026-07-18".to_owned()),
                    ..UpdateTaskRequest::default()
                },
            })
            .unwrap();
        let edit = store.queue().head().unwrap().clone();
        let mut moved = recurring("Tasks/plants.md");
        moved.complete_instances.push("2026-07-04".to_owned());
        moved.scheduled = Some("2026-07-18".to_owned());
        moved.due = Some("2026-07-12".to_owned());

        memory.clear_write_log();
        memory.refuse_restores_after_base(true);
        assert!(
            store.apply_server_ack(&edit, Some(&moved)).is_err(),
            "the interruption has to land after the base write, or this test \
             is about nothing"
        );
        let log = memory.write_log();
        let restores = log.iter().position(|slot| *slot == "completion_restores");
        let tasks = log.iter().position(|slot| *slot == "tasks");
        assert!(
            restores.is_some() && tasks.is_some() && restores < tasks,
            "the invalidation must be durable before the base that makes it \
             stale, got {log:?}"
        );

        memory.refuse_restores_after_base(false);
        drop(store);
        assert_eq!(
            undo(&mut relaunch(&memory)),
            None,
            "the relaunch reads a base that already holds the edit, so nothing \
             left can work out that the snapshot is stale"
        );
    }

    /// A rename touches nothing the restore describes, so the undo has to
    /// survive it — otherwise every routine save from the detail pane quietly
    /// disarms the undo.
    #[test]
    fn an_unrelated_acknowledged_edit_keeps_the_retained_snapshot() {
        let (mut store, _) = completed_and_acked();
        let id = TaskId::parse("Tasks/plants.md").unwrap();
        store
            .dispatch(CommandInput::Update {
                task_id: id.clone(),
                payload: UpdateTaskRequest {
                    title: Some(TaskTitle::parse("Water every plant").unwrap()),
                    ..UpdateTaskRequest::default()
                },
            })
            .unwrap();
        let edit = store.queue().head().unwrap().clone();
        let mut renamed = recurring("Tasks/plants.md");
        renamed.title = "Water every plant".to_owned();
        renamed.complete_instances.push("2026-07-04".to_owned());
        renamed.scheduled = Some("2026-07-11".to_owned());
        renamed.due = Some("2026-07-12".to_owned());
        store.apply_server_ack(&edit, Some(&renamed)).unwrap();

        assert_eq!(undo(&mut store), Some(pre_completion_schedule()));
    }

    /// Another client moved the series. The snapshot describes a schedule the
    /// server has already replaced, so an undo carrying it would rewind that
    /// other client's edit.
    #[test]
    fn a_pull_that_moves_the_series_drops_the_retained_snapshot() {
        let (mut store, memory) = completed_and_acked();
        let mut elsewhere = recurring("Tasks/plants.md");
        elsewhere.recurrence = Some("FREQ=MONTHLY".to_owned());
        elsewhere.complete_instances.push("2026-07-04".to_owned());

        memory.clear_write_log();
        store.replace_base(vec![elsewhere], 2).unwrap();

        let log = memory.write_log();
        let restores = log.iter().position(|slot| *slot == "completion_restores");
        let tasks = log.iter().position(|slot| *slot == "tasks");
        assert!(
            restores.is_some() && tasks.is_some() && restores < tasks,
            "the invalidation must be durable before the base that makes it \
             stale, got {log:?}"
        );
        assert_eq!(undo(&mut store), None);
    }

    /// ⚠️ **The rebased view is not the state the completion advanced.** An
    /// edit queued *after* the completion is already folded into the visible
    /// task, so reading the snapshot would hand the undo the edit's schedule as
    /// the one the server replaced.
    #[test]
    fn an_undo_ignores_a_schedule_edit_queued_after_the_completion() {
        let (mut store, _) = store();
        let id = TaskId::parse("Tasks/plants.md").unwrap();
        store
            .replace_base(vec![recurring("Tasks/plants.md")], 1)
            .unwrap();
        store
            .dispatch(CommandInput::SetInstanceComplete {
                task_id: id.clone(),
                date: "2026-07-04".to_owned(),
                completed: true,
            })
            .unwrap();
        store
            .dispatch(CommandInput::Update {
                task_id: id,
                payload: UpdateTaskRequest {
                    scheduled: crate::domain::FieldUpdate::Set("2026-07-25".to_owned()),
                    ..UpdateTaskRequest::default()
                },
            })
            .unwrap();

        assert_eq!(
            undo(&mut store),
            None,
            "the unsent edit contradicts any snapshot the undo could send"
        );
    }

    /// A rename queued after the completion moves nothing the restore
    /// describes, so rebuilding through the completion's position must still
    /// produce the pre-completion schedule.
    #[test]
    fn an_undo_survives_an_unrelated_edit_queued_after_the_completion() {
        let (mut store, _) = store();
        let id = TaskId::parse("Tasks/plants.md").unwrap();
        store
            .replace_base(vec![recurring("Tasks/plants.md")], 1)
            .unwrap();
        store
            .dispatch(CommandInput::SetInstanceComplete {
                task_id: id.clone(),
                date: "2026-07-04".to_owned(),
                completed: true,
            })
            .unwrap();
        store
            .dispatch(CommandInput::Update {
                task_id: id,
                payload: UpdateTaskRequest {
                    title: Some(TaskTitle::parse("Water every plant").unwrap()),
                    ..UpdateTaskRequest::default()
                },
            })
            .unwrap();

        assert_eq!(undo(&mut store), Some(pre_completion_schedule()));
    }

    /// ⚠️ **The same read, one layer down.** The ack retains the snapshot for
    /// the durable window, and it runs while the later edit is still queued.
    /// This edit lands on exactly the value the server is advancing to, so it
    /// never invalidates anything, and it is then parked — nothing later can
    /// correct a snapshot captured from the rebased view, and the undo would
    /// ask the server to rewind to a schedule it never held.
    #[test]
    fn an_ack_retains_the_schedule_the_completion_replaced_not_a_later_edits() {
        let (mut store, _) = store();
        let id = TaskId::parse("Tasks/plants.md").unwrap();
        store
            .replace_base(vec![recurring("Tasks/plants.md")], 1)
            .unwrap();
        store
            .dispatch(CommandInput::SetInstanceComplete {
                task_id: id.clone(),
                date: "2026-07-04".to_owned(),
                completed: true,
            })
            .unwrap();
        store
            .dispatch(CommandInput::Update {
                task_id: id,
                payload: UpdateTaskRequest {
                    scheduled: crate::domain::FieldUpdate::Set("2026-07-11".to_owned()),
                    due: crate::domain::FieldUpdate::Set("2026-07-12".to_owned()),
                    ..UpdateTaskRequest::default()
                },
            })
            .unwrap();

        let completion = store.queue().head().unwrap().clone();
        let mut advanced = recurring("Tasks/plants.md");
        advanced.complete_instances.push("2026-07-04".to_owned());
        advanced.scheduled = Some("2026-07-11".to_owned());
        advanced.due = Some("2026-07-12".to_owned());
        store
            .apply_server_ack(&completion, Some(&advanced))
            .unwrap();

        let edit = store.queue().head().unwrap().id().to_owned();
        store
            .dead_letter_command(&edit, &Error::invariant("parked for review"))
            .unwrap();

        assert_eq!(undo(&mut store), Some(pre_completion_schedule()));
    }

    #[test]
    fn a_pull_that_leaves_the_series_alone_keeps_the_retained_snapshot() {
        let (mut store, _) = completed_and_acked();
        let mut same = recurring("Tasks/plants.md");
        same.title = "Water every plant".to_owned();
        same.complete_instances.push("2026-07-04".to_owned());
        same.scheduled = Some("2026-07-11".to_owned());
        same.due = Some("2026-07-12".to_owned());
        store.replace_base(vec![same], 2).unwrap();

        assert_eq!(undo(&mut store), Some(pre_completion_schedule()));
    }

    /// A file that exists but does not parse is the one record of what this
    /// install's completions replaced. Rounding it down to "no restores" turns
    /// every pending undo into a silent no-op against the server.
    #[test]
    fn an_unreadable_restore_file_fails_the_launch_rather_than_reading_as_empty() {
        let (_, memory) = store();
        *memory.restores.lock().unwrap() = Some("not-json".to_owned());
        let mut store = TaskStore::new(
            memory.clone(),
            memory.clone(),
            Arc::new(FixedClock),
            Arc::new(HalfUnit),
        );
        assert!(store.restore().is_err());
    }

    #[test]
    fn an_optimistic_create_is_visible_immediately_under_a_temp_id() {
        let (mut store, _) = store();
        let optimistic = store
            .dispatch(CommandInput::Create {
                payload: CreateTaskRequest::new(TaskTitle::parse("Underground").unwrap()),
            })
            .unwrap()
            .unwrap();
        assert!(optimistic.id.is_temp());
        assert_eq!(optimistic.title, "Underground");
        assert_eq!(store.snapshot().pending_count, 1);
    }

    #[test]
    fn acking_a_create_aliases_the_temp_id_and_rewrites_the_queue() {
        let (mut store, _) = store();
        let optimistic = store
            .dispatch(CommandInput::Create {
                payload: CreateTaskRequest::new(TaskTitle::parse("Chained").unwrap()),
            })
            .unwrap()
            .unwrap();
        store
            .dispatch(CommandInput::SetStatus {
                task_id: optimistic.id.clone(),
                status: TaskStatus::Done,
            })
            .unwrap();

        let create = store.queue().head().cloned().unwrap();
        let real = task("Tasks/Chained-1.md");
        store.apply_server_ack(&create, Some(&real)).unwrap();

        assert_eq!(store.resolve_task_id(&optimistic.id), real.id);
        assert_eq!(
            store.queue().pending().first().map(Command::target),
            Some(&real.id),
            "the follower must have been rewritten onto the real path"
        );
        assert_eq!(
            store
                .snapshot()
                .tasks
                .get(&real.id)
                .map(|entry| entry.status),
            Some(TaskStatus::Done)
        );
    }

    #[test]
    fn dispatch_resolves_a_stale_temp_id_through_the_alias_map() {
        let (mut store, _) = store();
        let optimistic = store
            .dispatch(CommandInput::Create {
                payload: CreateTaskRequest::new(TaskTitle::parse("Chained").unwrap()),
            })
            .unwrap()
            .unwrap();
        let create = store.queue().head().cloned().unwrap();
        let real = task("Tasks/Chained-1.md");
        store.apply_server_ack(&create, Some(&real)).unwrap();

        store
            .dispatch(CommandInput::Update {
                task_id: optimistic.id,
                payload: UpdateTaskRequest::default(),
            })
            .unwrap();
        assert_eq!(
            store.queue().pending().first().map(Command::target),
            Some(&real.id)
        );
    }

    #[test]
    fn a_pull_prunes_an_alias_whose_task_is_gone() {
        let (mut store, _) = store();
        let optimistic = store
            .dispatch(CommandInput::Create {
                payload: CreateTaskRequest::new(TaskTitle::parse("Chained").unwrap()),
            })
            .unwrap()
            .unwrap();
        let create = store.queue().head().cloned().unwrap();
        let real = task("Tasks/Chained-1.md");
        store.apply_server_ack(&create, Some(&real)).unwrap();
        assert_eq!(store.aliases().len(), 1);

        store.replace_base(vec![], 5).unwrap();
        assert!(store.aliases().is_empty());
        assert_eq!(store.resolve_task_id(&optimistic.id), optimistic.id);
        assert_eq!(store.snapshot().last_sync_time, Some(5));
    }

    #[test]
    fn restore_rebuilds_the_whole_client_from_durable_state_only() {
        let (mut store, memory) = store();
        store.replace_base(vec![task("Tasks/a.md")], 9).unwrap();
        store
            .dispatch(CommandInput::SetStatus {
                task_id: TaskId::parse("Tasks/a.md").unwrap(),
                status: TaskStatus::Done,
            })
            .unwrap();

        let mut rebuilt = TaskStore::new(
            memory.clone(),
            memory,
            Arc::new(FixedClock),
            Arc::new(HalfUnit),
        );
        rebuilt.restore().unwrap();
        assert_eq!(rebuilt.snapshot().pending_count, 1);
        assert_eq!(rebuilt.snapshot().last_sync_time, Some(9));
        assert_eq!(
            rebuilt
                .snapshot()
                .tasks
                .get(&TaskId::parse("Tasks/a.md").unwrap())
                .map(|entry| entry.status),
            Some(TaskStatus::Done),
            "the rebase is recomputed, not restored"
        );
    }

    #[test]
    fn aliases_survive_a_round_trip_and_junk_is_dropped() {
        let parsed = parse_aliases(Some(r#"{"tmp-1-1":"Tasks/a.md","tmp-2-2":"not-a-note"}"#));
        assert_eq!(parsed.len(), 1);
        assert_eq!(
            parsed.get(&TaskId::parse("tmp-1-1").unwrap()),
            Some(&TaskId::parse("Tasks/a.md").unwrap())
        );
        assert!(parse_aliases(Some("[]")).is_empty());
        assert!(parse_aliases(None).is_empty());
    }

    /// Rebuild the whole client from durable state alone, at the same instant.
    ///
    /// No clock advance anywhere: a relaunch inside one clock millisecond is
    /// precisely the condition that made the counter's reset observable.
    fn relaunch(memory: &Arc<Memory>) -> TaskStore {
        let mut reborn = TaskStore::new(
            memory.clone(),
            memory.clone(),
            Arc::new(FixedClock),
            Arc::new(HalfUnit),
        );
        reborn.restore().expect("durable state must reload");
        reborn
    }

    #[test]
    fn an_acked_commands_id_is_never_re_minted_after_a_relaunch() {
        // The case the durable-set check structurally cannot see, and therefore
        // the case that makes persistence load-bearing rather than redundant.
        // The command is acked and dequeued, so the client no longer holds its
        // id — but the server's idempotency store still remembers it, and that
        // id is `X-Mutation-Id`. Re-minting it makes the server answer the new
        // mutation from the old one's stored response: silent data loss.
        let (mut store, memory) = store();
        store.restore().unwrap();
        store
            .dispatch(CommandInput::Create {
                payload: CreateTaskRequest::new(TaskTitle::parse("Before").unwrap()),
            })
            .unwrap();
        let acked = store.queue().head().cloned().unwrap();
        store
            .apply_server_ack(&acked, Some(&task("Tasks/Before.md")))
            .unwrap();
        assert!(
            store.queue().pending().is_empty(),
            "the id is now gone from every durable set the check can consult"
        );

        let mut reborn = relaunch(&memory);
        reborn
            .dispatch(CommandInput::Create {
                payload: CreateTaskRequest::new(TaskTitle::parse("After").unwrap()),
            })
            .unwrap();

        let fresh = reborn.queue().head().cloned().unwrap();
        assert_ne!(
            fresh.id(),
            acked.id(),
            "the persisted counter is the only thing standing between this \
             command and the acked command's live idempotency key"
        );
        assert_ne!(
            fresh.target(),
            acked.target(),
            "the same argument applies to the temp id, where a collision would \
             instead merge two optimistic tasks into one"
        );
    }

    #[test]
    fn the_id_counters_are_durably_spent_before_the_command_that_carries_them() {
        // Ordering is the whole crash-safety argument: a crash between the two
        // writes must lose the command, never resurrect its id.
        let (mut store, memory) = store();
        store.restore().unwrap();
        store
            .dispatch(CommandInput::Delete {
                task_id: TaskId::parse("Tasks/a.md").unwrap(),
            })
            .unwrap();

        let log = memory.write_log();
        let counters = log.iter().position(|slot| *slot == "id_counters");
        let queue = log.iter().position(|slot| *slot == "queue");
        assert!(
            counters < queue,
            "the counters must be written before the queue, got {log:?}"
        );
        assert_eq!(
            memory.counters.lock().unwrap().clone(),
            Some(r#"{"command":1,"temp":0}"#.to_owned()),
            "a delete spends a command id and no temp id"
        );
    }

    #[test]
    fn an_install_with_no_persisted_counters_still_cannot_re_mint_a_queued_id() {
        // The upgrade path: a durable queue carried over from a build that
        // never wrote the counters, so they restore as zero. No schema
        // migration covers this — the mint-and-check backstop does.
        let (mut store, memory) = store();
        store.restore().unwrap();
        store
            .dispatch(CommandInput::Create {
                payload: CreateTaskRequest::new(TaskTitle::parse("Carried over").unwrap()),
            })
            .unwrap();
        let carried = store.queue().head().cloned().unwrap();
        memory.forget_id_counters();

        let mut reborn = relaunch(&memory);
        reborn
            .dispatch(CommandInput::Create {
                payload: CreateTaskRequest::new(TaskTitle::parse("Fresh").unwrap()),
            })
            .unwrap();

        let ids: Vec<&str> = reborn.queue().pending().iter().map(Command::id).collect();
        assert_eq!(ids.len(), 2);
        assert_ne!(
            ids.first(),
            ids.get(1),
            "the backstop must cover the launch the counter cannot describe"
        );
        assert_ne!(
            reborn.queue().pending().get(1).map(Command::target),
            Some(carried.target()),
            "and the temp id too"
        );
    }

    #[test]
    fn a_dead_lettered_command_still_reserves_its_id() {
        // A parked command can still be retried, so its id is still live
        // server-side. With the counters wiped, the dead-letter half of the
        // durable-set check is the only thing left holding the line.
        let (mut store, memory) = store();
        store.restore().unwrap();
        store
            .dispatch(CommandInput::Create {
                payload: CreateTaskRequest::new(TaskTitle::parse("Parked").unwrap()),
            })
            .unwrap();
        let parked = store.queue().head().cloned().unwrap();
        store
            .dead_letter_command(parked.id(), &Error::api("bad request", 422))
            .unwrap();
        assert_eq!(store.snapshot().dead_letters.len(), 1);
        memory.forget_id_counters();

        let mut reborn = relaunch(&memory);
        reborn
            .dispatch(CommandInput::Create {
                payload: CreateTaskRequest::new(TaskTitle::parse("Fresh").unwrap()),
            })
            .unwrap();

        let fresh = reborn.queue().head().cloned().unwrap();
        assert_ne!(fresh.id(), parked.id());
        assert_ne!(fresh.target(), parked.target());
    }

    #[test]
    fn counters_round_trip_and_only_an_absent_file_means_zero() {
        assert_eq!(
            parse_id_counters(Some(r#"{"command":7,"temp":3}"#)).unwrap(),
            IdCounters {
                command: 7,
                temp: 3
            }
        );
        // Absent is the fresh install and the pre-counters upgrade, and it is
        // the only shape that may restart at zero.
        assert_eq!(parse_id_counters(None).unwrap(), IdCounters::default());
        // Everything else is a file that exists and cannot be read, which means
        // the ids this install has already spent are unknown. Zeroing it can
        // re-mint an acked create's temp id, and the alias map then misdirects
        // the new task's edits — so restoration fails loudly instead. An empty
        // blob is in this list on purpose: writes are atomic, so a zero-byte
        // file is not a torn write of a good one.
        for corrupt in ["", "not json", "[]", "{}", r#"{"command":7}"#] {
            let error = parse_id_counters(Some(corrupt)).unwrap_err();
            assert!(
                error.to_string().contains("already spent are unknown"),
                "expected a refusal for {corrupt:?}, got {error}"
            );
        }
    }

    /// The counterpart of
    /// [`the_id_counters_are_durably_spent_before_the_command_that_carries_them`]:
    /// an ack writes its two durable slots in the *opposite* order, because the
    /// risk is the opposite one.
    ///
    /// Dequeuing first and crashing would leave `queue.json` without the
    /// mutation and `tasks.json` without its result, silently dropping an
    /// accepted change. Persisting first and crashing only costs a replay,
    /// which the server answers from its idempotency store.
    #[test]
    fn the_accepted_base_is_durable_before_the_command_is_dequeued() {
        let (mut store, memory) = store();
        store.restore().unwrap();
        store
            .dispatch(CommandInput::Delete {
                task_id: TaskId::parse("Tasks/a.md").unwrap(),
            })
            .unwrap();
        let command = store.queue().head().cloned().unwrap();

        memory.clear_write_log();
        store.apply_server_ack(&command, None).unwrap();

        let log = memory.write_log();
        let tasks = log.iter().position(|slot| *slot == "tasks");
        let queue = log.iter().position(|slot| *slot == "queue");
        assert!(
            tasks.is_some() && queue.is_some() && tasks < queue,
            "the base must be written before the queue is dequeued, got {log:?}"
        );
    }

    #[test]
    fn every_dispatch_mints_a_distinct_command_id() {
        let (mut store, _) = store();
        for _ in 0_u8..3 {
            store
                .dispatch(CommandInput::Delete {
                    task_id: TaskId::parse("Tasks/a.md").unwrap(),
                })
                .unwrap();
        }
        let mut ids: Vec<&str> = store.queue().pending().iter().map(Command::id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 3);
    }
}
