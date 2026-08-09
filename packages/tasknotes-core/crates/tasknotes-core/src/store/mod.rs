//! The single source of truth the UI reads, and the durable state under it.
//!
//! `base` is the last server snapshot. The visible task map is **always**
//! `rebase(base, queue.pending)`, recomputed on every change and never
//! persisted. That is the whole offline-first invariant in one sentence: the
//! only durable writes are the id counters and the command queue (on dispatch,
//! in that order) and the base cache (on server acks and pulls), so no crash
//! can capture a half-applied optimistic state.
//!
//! The store never touches the network. Executing commands is
//! [`SyncEngine`](crate::sync::SyncEngine)'s job; it reports results back
//! through [`TaskStore::apply_server_ack`] and [`TaskStore::replace_base`].
//!
//! Sans-I/O: storage is a trait the host implements
//! ([`TaskCacheStorage`](crate::sync::TaskCacheStorage)), so this module owns
//! the *shape* of persisted state and none of the mechanism.

pub mod migrations;

use std::sync::Arc;

use indexmap::{IndexMap, IndexSet};
use serde_json::Value;

use crate::{
    Error, Result,
    domain::{Task, TaskId},
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
            last_sync_time: None,
            snapshot: TaskStoreSnapshot::default(),
            counters: IdCounters::default(),
        }
    }

    /// Load the queue, the cached base, the alias map, the id counters and the
    /// last sync time.
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
        self.counters = parse_id_counters(self.storage.read_id_counters()?.as_deref());
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
        // Counters first, queue second, and never the other way round: the id
        // has to be durably spent before the command carrying it can reach the
        // wire. Crashing after this write only burns id values, which is free;
        // crashing between the enqueue and this write would hand the id back
        // out — and that id is the server's `X-Mutation-Id`.
        self.persist_id_counters()?;
        self.queue.enqueue(command)?;
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
        if let Some(server_task) = server_task
            && let Command::Create { temp_id, .. } = command
        {
            self.aliases.insert(temp_id.clone(), server_task.id.clone());
            self.queue.remap_task_id(temp_id, &server_task.id)?;
            self.persist_aliases()?;
        }
        if command.is_delete() {
            self.base.shift_remove(command.target());
        } else if let Some(server_task) = server_task {
            self.base
                .insert(server_task.id.clone(), server_task.clone());
        }
        self.queue.ack(command.id())?;
        self.persist_base()?;
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
        self.base = tasks
            .into_iter()
            .map(|task| (task.id.clone(), task))
            .collect();
        let stale: Vec<TaskId> = self
            .aliases
            .iter()
            .filter(|&(_, real)| !self.base.contains_key(real))
            .map(|(temp, _)| temp.clone())
            .collect();
        for temp in stale {
            self.aliases.shift_remove(&temp);
        }
        self.last_sync_time = Some(synced_at);
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
            } => Command::SetInstanceComplete {
                id,
                created_at,
                task_id: self.resolve_task_id(&task_id),
                date,
                completed,
            },
        })
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
    /// invisible here. The check remains for the two states a counter cannot
    /// describe: the first launch after upgrading from a build that never wrote
    /// the counters, and a counter blob that failed to parse.
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
}

/// Parse the persisted id counters, treating anything unreadable as zero.
///
/// Absent **and** unreadable both mean "start at zero" — a fresh install, an
/// install carried over from a build that predates this key, and a truncated
/// blob all land here. None of the three needs a schema migration, because
/// there is no data to transform and because
/// [`TaskStore::next_command_id`] / [`TaskStore::next_temp_id`] still refuse to
/// hand back an id the restored queue already holds. Refusing to start over a
/// corrupt counter would strand every mutation the user is waiting on, which is
/// a strictly worse failure than burning a few id values.
fn parse_id_counters(raw: Option<&str>) -> IdCounters {
    raw.filter(|value| !value.is_empty())
        .and_then(|value| serde_json::from_str::<IdCounters>(value).ok())
        .unwrap_or_default()
}

/// Parse the persisted alias map, keeping every entry that still parses.
///
/// Lossy for the same reason [`CommandQueue::restore`] is: these bytes may have
/// been written by an older release, and one unreadable alias must not strand
/// the rest of the user's offline work.
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
    use std::sync::{Arc, Mutex};

    use super::{IdCounters, TaskStore, parse_aliases, parse_id_counters};
    use crate::{
        Error, Result,
        domain::{CreateTaskRequest, Task, TaskId, TaskStatus, TaskTitle, UpdateTaskRequest},
        sync::{Clock, Command, CommandInput, QueueStorage, Randomness, TaskCacheStorage},
    };

    #[derive(Default)]
    struct Memory {
        queue: Mutex<Option<String>>,
        dead: Mutex<Option<String>>,
        tasks: Mutex<Vec<Task>>,
        aliases: Mutex<Option<String>>,
        counters: Mutex<Option<String>>,
        last_sync: Mutex<Option<i64>>,
        /// Which durable slots were written, in order. The dispatch path's
        /// crash-safety argument is entirely about this order.
        writes: Mutex<Vec<&'static str>>,
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

        fn record(&self, slot: &'static str) {
            self.writes.lock().unwrap().push(slot);
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
    fn counters_survive_a_round_trip_and_junk_restarts_at_zero() {
        assert_eq!(
            parse_id_counters(Some(r#"{"command":7,"temp":3}"#)),
            IdCounters {
                command: 7,
                temp: 3
            }
        );
        // Absent, empty, unparseable and wrong-shaped all mean "start at zero",
        // which the backstop makes safe. Refusing to start would strand every
        // mutation the user is waiting on.
        for junk in [None, Some(""), Some("not json"), Some("[]"), Some("{}")] {
            assert_eq!(parse_id_counters(junk), IdCounters::default(), "{junk:?}");
        }
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
