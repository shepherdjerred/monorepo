//! The `@tasknotes/fixtures` sync scenario format, as Rust types.
//!
//! A direct transcription of `schema/scenario.schema.json`. Every struct is
//! `deny_unknown_fields`, matching the schema's `additionalProperties: false`:
//! a key this port does not understand is a drift signal, and silently ignoring
//! it would let the two implementations diverge under a green test run.

use serde_json::Value;
use tasknotes_core::{
    SerializedError,
    domain::{CreateTaskRequest, Priority, TaskStatus, UpdateTaskRequest},
    sync::InstanceCompletion,
};

use super::fake_server::MutationMethod;

/// One scenario file.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scenario {
    /// The scenario's id; also its file name.
    pub id: String,
    /// The TypeScript test file it was extracted from.
    pub source: String,
    /// The `describe` block it lived in.
    pub describe: String,
    /// The test name.
    pub name: String,
    /// Why the scenario is shaped the way it is.
    #[serde(default)]
    pub doc: Option<String>,
    /// The world's starting conditions.
    pub setup: Setup,
    /// What happens, in order.
    pub actions: Vec<Action>,
    /// What must be true afterwards.
    pub assertions: Vec<Assertion>,
}

/// The world's starting conditions.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Setup {
    /// Where the manual clock starts.
    #[serde(default)]
    pub clock: Option<FixtureTime>,
    /// Whether a dispatch also triggers a sync, as the real app wires it.
    #[serde(default)]
    pub auto_sync: Option<bool>,
}

/// An instant, either absolute or as device-local wall-clock time.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(deny_unknown_fields, tag = "kind", rename_all = "snake_case")]
pub enum FixtureTime {
    /// Milliseconds since the Unix epoch.
    EpochMs {
        /// The instant.
        value: i64,
    },
    /// A local wall-clock time, `YYYY-MM-DDTHH:MM:SS`.
    ///
    /// Exists because the legacy `completeRecurringInstance` branch derives
    /// "today" from device-local calendar getters, so those scenarios have to
    /// pin a wall-clock reading rather than an instant to reproduce in any
    /// timezone.
    LocalNaive {
        /// The wall-clock time.
        value: String,
    },
}

/// How a scenario names a task.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(deny_unknown_fields, tag = "by", rename_all = "snake_case")]
pub enum TaskRef {
    /// A literal task id.
    Id {
        /// The id.
        value: String,
    },
    /// The id bound by an earlier `dispatch { as }`.
    Ref {
        /// The binding's name.
        value: String,
    },
    /// The bound id, followed through the store's alias map.
    ResolvedRef {
        /// The binding's name.
        value: String,
    },
    /// The (unique) task with this title.
    Title {
        /// The title.
        value: String,
    },
}

/// Task fields a scenario can seed or patch. Everything is optional.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TaskFields {
    /// The task's id.
    #[serde(default)]
    pub id: Option<String>,
    /// The vault-relative path.
    #[serde(default)]
    pub path: Option<String>,
    /// The title.
    #[serde(default)]
    pub title: Option<String>,
    /// The status.
    #[serde(default)]
    pub status: Option<TaskStatus>,
    /// The priority.
    #[serde(default)]
    pub priority: Option<Priority>,
    /// The due date.
    #[serde(default)]
    pub due: Option<String>,
    /// The scheduled date.
    #[serde(default)]
    pub scheduled: Option<String>,
    /// The recurrence rule.
    #[serde(default)]
    pub recurrence: Option<String>,
    /// Completed occurrences.
    #[serde(default)]
    pub complete_instances: Option<Vec<String>>,
    /// Skipped occurrences.
    #[serde(default)]
    pub skipped_instances: Option<Vec<String>>,
    /// Contexts.
    #[serde(default)]
    pub contexts: Option<Vec<String>>,
    /// Projects.
    #[serde(default)]
    pub projects: Option<Vec<String>>,
    /// Tags.
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// Whether the task is archived.
    #[serde(default)]
    pub archived: Option<bool>,
    /// The note body.
    #[serde(default)]
    pub details: Option<String>,
}

/// A mutation as the UI expresses it.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(deny_unknown_fields, tag = "type", rename_all = "snake_case")]
pub enum DispatchInput {
    /// Create a task.
    Create {
        /// What to create.
        payload: CreateTaskRequest,
    },
    /// Update a task.
    Update {
        /// Which task.
        task: TaskRef,
        /// The three-state partial update.
        payload: UpdateTaskRequest,
    },
    /// Delete a task.
    Delete {
        /// Which task.
        task: TaskRef,
    },
    /// Set a task's status.
    SetStatus {
        /// Which task.
        task: TaskRef,
        /// The status to set.
        status: TaskStatus,
    },
    /// Set an occurrence's completion state.
    SetInstanceComplete {
        /// Which task.
        task: TaskRef,
        /// The occurrence's date.
        date: String,
        /// The state to set it to.
        completed: bool,
    },
}

/// A call made straight to the server, bypassing the store and the engine.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(
    deny_unknown_fields,
    tag = "method",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ClientCall {
    /// Pull every task.
    ListTasks,
    /// Create a task.
    CreateTask {
        /// The payload.
        request: CreateTaskRequest,
        /// The idempotency key.
        #[serde(default)]
        mutation_id: Option<String>,
    },
    /// Update a task.
    UpdateTask {
        /// Which task.
        task: TaskRef,
        /// The payload.
        request: UpdateTaskRequest,
        /// The idempotency key.
        #[serde(default)]
        mutation_id: Option<String>,
    },
    /// Delete a task.
    DeleteTask {
        /// Which task.
        task: TaskRef,
        /// The idempotency key.
        #[serde(default)]
        mutation_id: Option<String>,
    },
    /// Set a task's status.
    ToggleTaskStatus {
        /// Which task.
        task: TaskRef,
        /// The status to set.
        status: TaskStatus,
        /// The idempotency key.
        #[serde(default)]
        mutation_id: Option<String>,
    },
    /// Set an occurrence's completion state, or `null` for the legacy
    /// toggle-today branch.
    CompleteRecurringInstance {
        /// Which task.
        task: TaskRef,
        /// The absolute state, or `null`.
        instance: Option<InstanceCompletion>,
        /// The idempotency key.
        #[serde(default)]
        mutation_id: Option<String>,
    },
}

/// The seventeen scenario verbs.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(deny_unknown_fields, tag = "kind", rename_all = "snake_case")]
pub enum Action {
    /// Load the queue, cached base and id aliases.
    StoreRestore,
    /// Put tasks into the fake server.
    ServerSeed {
        /// The tasks to seed.
        tasks: Vec<TaskFields>,
    },
    /// A total outage begins.
    ServerOffline,
    /// The outage ends.
    ServerOnline,
    /// Inject a one-shot failure for one method.
    ServerFailNext {
        /// Which method.
        method: MutationMethod,
        /// The failure to inject.
        error: SerializedError,
    },
    /// A concurrent Obsidian edit lands server-side.
    ServerInjectEdit {
        /// Which task.
        task: TaskRef,
        /// What changed.
        patch: TaskFields,
    },
    /// Move the manual clock.
    ClockSet {
        /// Where to.
        at: FixtureTime,
    },
    /// A user mutation.
    Dispatch {
        /// What the user did.
        input: DispatchInput,
        /// Bind the optimistic task's id under this name.
        #[serde(default, rename = "as")]
        bind: Option<String>,
    },
    /// Drain and pull, and wait for it.
    SyncNow {
        /// Bind the result under this name.
        #[serde(default, rename = "as")]
        bind: Option<String>,
    },
    /// A fire-and-forget trigger.
    RequestSync,
    /// Fire the oldest armed retry timer.
    SchedulerFireNext,
    /// Retire the engine, as when the API client is swapped.
    EngineDispose,
    /// The user taps Retry on a parked command.
    RetryDeadLetter {
        /// Which parked command, by position.
        index: usize,
    },
    /// Call the server directly.
    ClientCall {
        /// The call.
        call: ClientCall,
        /// Bind the result under this name.
        #[serde(default, rename = "as")]
        bind: Option<String>,
    },
    /// Capture durable storage **and** the observable world at one instant.
    Snapshot {
        /// The snapshot's name.
        #[serde(rename = "as")]
        bind: String,
    },
    /// Rebuild the client from a snapshot's durable half.
    ///
    /// The clock and the fake server survive: the server is what remembers
    /// which mutation ids it already applied, which is the entire point of
    /// relaunching against a deliberately stale queue.
    Relaunch {
        /// Which snapshot's durable state to restore from.
        from: String,
    },
    /// Let already-triggered fire-and-forget work happen.
    Settle,
}

/// A count, either literal or read from a snapshot.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(deny_unknown_fields, tag = "kind", rename_all = "snake_case")]
pub enum CountExpr {
    /// A literal.
    Literal {
        /// The count.
        value: i64,
    },
    /// The same metric, measured at a named snapshot.
    Snapshot {
        /// The snapshot's name.
        name: String,
    },
}

/// Which collection an assertion inspects.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskSource {
    /// The client's visible task map.
    Store,
    /// The fake server's vault.
    Server,
}

/// Which call-log column an assertion reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CallLogField {
    /// The method.
    Method,
    /// The addressed task id.
    Id,
    /// The idempotency key.
    MutationId,
    /// Whether the idempotency store answered.
    Replayed,
    /// Whether server state actually changed.
    Applied,
}

/// The seventeen assertion kinds.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(
    deny_unknown_fields,
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Assertion {
    /// A bound result succeeded or failed, optionally with a given error kind.
    Result {
        /// The binding.
        #[serde(rename = "ref")]
        reference: String,
        /// Whether it succeeded.
        ok: bool,
        /// The expected error tag.
        #[serde(default)]
        error_kind: Option<String>,
    },
    /// A dotted path into a bound result.
    ResultField {
        /// The binding.
        #[serde(rename = "ref")]
        reference: String,
        /// The dotted path.
        path: String,
        /// The expected value.
        equals: Value,
    },
    /// Two bound results agree at a path.
    ResultsFieldEqual {
        /// The two bindings.
        refs: Vec<String>,
        /// The dotted path.
        path: String,
    },
    /// How many commands are queued.
    PendingCount {
        /// Which instant.
        #[serde(default)]
        at: Option<String>,
        /// The expected count.
        equals: CountExpr,
    },
    /// The live queue holds exactly what a snapshot's did.
    QueuePendingEquals {
        /// The snapshot to compare against.
        at: String,
    },
    /// How many tasks a collection holds.
    TaskCount {
        /// Which instant.
        #[serde(default)]
        at: Option<String>,
        /// Which collection.
        source: TaskSource,
        /// The expected count.
        equals: CountExpr,
    },
    /// A dotted path into one task.
    TaskField {
        /// Which instant.
        #[serde(default)]
        at: Option<String>,
        /// Which collection.
        source: TaskSource,
        /// Which task.
        task: TaskRef,
        /// The dotted path.
        path: String,
        /// The expected value.
        equals: Value,
    },
    /// Whether a task is present.
    TaskExists {
        /// Which instant.
        #[serde(default)]
        at: Option<String>,
        /// Which collection.
        source: TaskSource,
        /// Which task.
        task: TaskRef,
        /// Whether it should be there.
        exists: bool,
    },
    /// How many commands are parked.
    DeadLetterCount {
        /// Which instant.
        #[serde(default)]
        at: Option<String>,
        /// The expected count.
        equals: usize,
    },
    /// A dotted path into one parked command.
    DeadLetterField {
        /// Which instant.
        #[serde(default)]
        at: Option<String>,
        /// Which parked command.
        index: usize,
        /// The dotted path.
        path: String,
        /// The expected value.
        equals: Value,
    },
    /// When the last successful pull completed.
    LastSyncTime {
        /// Which instant.
        #[serde(default)]
        at: Option<String>,
        /// The expected instant, or `null`.
        equals: Option<FixtureTime>,
    },
    /// What the engine is doing.
    EngineState {
        /// Which instant.
        #[serde(default)]
        at: Option<String>,
        /// The expected state.
        equals: String,
    },
    /// Which retry timers are armed.
    SchedulerPending {
        /// Which instant.
        #[serde(default)]
        at: Option<String>,
        /// How many.
        #[serde(default)]
        count: Option<usize>,
        /// Their exact delays.
        #[serde(default)]
        delays: Option<Vec<i64>>,
    },
    /// How many times a method was called.
    CallCount {
        /// Which instant.
        #[serde(default)]
        at: Option<String>,
        /// Which method.
        method: MutationMethod,
        /// Count only the calls that mutated state.
        #[serde(default)]
        applied: Option<bool>,
        /// The expected count.
        equals: usize,
    },
    /// A column of the call log, at one index or in full.
    CallLog {
        /// Which instant.
        #[serde(default)]
        at: Option<String>,
        /// Which call, or every call when absent.
        #[serde(default)]
        index: Option<usize>,
        /// Which column.
        field: CallLogField,
        /// The expected value.
        equals: Value,
    },
    /// Whether an id is still a client-minted temp id.
    TaskIdIsTemp {
        /// Which task.
        task: TaskRef,
        /// Whether it should still be temporary.
        equals: bool,
    },
    /// Re-running the scenario converges to the identical end state.
    DeterministicEndState,
}
